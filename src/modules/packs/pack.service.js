// src/modules/packs/pack.service.js
// Paket açma motoru — RNG, GP/TON ödeme, kart dağıtımı

const { createHash } = require('crypto');
const { query, withTransaction } = require('../../database/db');
const { updateTaskProgress } = require('../gp/gp.service');

const PACK_GP_COSTS = {
  bronze: parseInt(process.env.GP_PRICE_BRONZE || '2400'),
  silver: parseInt(process.env.GP_PRICE_SILVER || '8000'),
  gold:   parseInt(process.env.GP_PRICE_GOLD   || '25000'),
  elite:  parseInt(process.env.GP_PRICE_ELITE  || '70000'),
};

const PACK_TON_COSTS = {
  bronze: BigInt(process.env.TON_PRICE_BRONZE || '300000000'),
  silver: BigInt(process.env.TON_PRICE_SILVER || '1000000000'),
  gold:   BigInt(process.env.TON_PRICE_GOLD   || '3000000000'),
  elite:  BigInt(process.env.TON_PRICE_ELITE  || '8000000000'),
};

// Paketin garantili içeriği
const PACK_GUARANTEES = {
  bronze: { min_rarity: 'common',    guaranteed: null },
  silver: { min_rarity: 'rare',      guaranteed: 'rare' },
  gold:   { min_rarity: 'rare',      guaranteed: 'epic' },
  elite:  { min_rarity: 'epic',      guaranteed: null, legendary_chance: 0.20 },
};

const CARDS_PER_PACK = 5;

// ── ANA PAKET AÇMA ───────────────────────────────────────────

async function openPack(userId, tier, paymentMethod, tonTxHash = null) {
  return withTransaction(async (client) => {

    // Kullanıcıyı kilitle
    const { rows: [user] } = await client.query(
      `SELECT * FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    if (!user || user.is_banned) throw new Error('Erişim engellendi');

    let gpSpent = 0;
    let tonSpent = 0n;

    // ── ÖDEME KONTROLÜ ──
    if (paymentMethod === 'gp') {
      const cost = PACK_GP_COSTS[tier];
      if (user.gp_balance < cost) {
        throw new Error(`Yetersiz GP. Gerekli: ${cost.toLocaleString()}, Mevcut: ${user.gp_balance.toLocaleString()}`);
      }
      // GP düş
      await client.query(
        `SELECT update_gp($1, $2, 'gp_pack_purchase', NULL, $3)`,
        [userId, -cost, `${tier} paket satın alma`]
      );
      gpSpent = cost;

    } else if (paymentMethod === 'ton') {
      // TON ödeme doğrulaması (ton.service'te yapılır, buraya hash gelir)
      if (!tonTxHash) throw new Error('TON işlem hash gerekli');
      const tonCost = PACK_TON_COSTS[tier];
      tonSpent = tonCost;

    } else if (paymentMethod === 'free') {
      // Streak veya görev ödülü — bedava
    } else {
      throw new Error('Geçersiz ödeme yöntemi');
    }

    // ── KART SEÇİMİ ──
    const seed = generateSeed(userId, tier, Date.now());
    const selectedCards = await selectCards(client, tier, CARDS_PER_PACK, seed);

    // ── PAKET KAYDI ──
    const { rows: [packOpen] } = await client.query(
      `INSERT INTO pack_opens (user_id, tier, paid_with, gp_spent, ton_spent, ton_tx_hash, card_count, rng_seed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [userId, tier, paymentMethod, gpSpent, tonSpent.toString(), tonTxHash, CARDS_PER_PACK, seed]
    );

    // ── KARTLARI VER ──
    const newCards = [];
    for (const template of selectedCards) {
      const { rows: [card] } = await client.query(
        `INSERT INTO user_cards (user_id, template_id, source, pack_open_id)
         VALUES ($1, $2, 'pack', $3) RETURNING id`,
        [userId, template.id, packOpen.id]
      );

      newCards.push({
        userCardId: card.id,
        templateId: template.id,
        name: template.name,
        nationality: template.nationality,
        position: template.position,
        overall: template.overall,
        rarity: template.rarity,
        imageUrl: template.image_url,
        gpPerHour: template.gp_per_hour,
      });
    }

    // XP ekle
    const xpGain = newCards.reduce((sum, c) => {
      const xp = { common: 5, rare: 15, epic: 40, legendary: 100 };
      return sum + (xp[c.rarity] || 5);
    }, 0);

    await client.query(
      `UPDATE users SET
        xp = xp + $1,
        level = calc_level(xp + $1),
        updated_at = NOW()
       WHERE id = $2`,
      [xpGain, userId]
    );

    // Görev güncellemesi
    await updateTaskProgress(client, userId, 'open_pack', 1);

    // Güncellenmiş kullanıcı bilgisi
    const { rows: [updatedUser] } = await client.query(
      `SELECT gp_balance, level, xp FROM users WHERE id = $1`,
      [userId]
    );

    return {
      packOpenId: packOpen.id,
      tier,
      cards: newCards,
      xpGained: xpGain,
      newLevel: updatedUser.level,
      gpBalance: updatedUser.gp_balance,
    };
  });
}

// ── KART SEÇİMİ ─────────────────────────────────────────────

async function selectCards(client, tier, count, seed) {
  const guarantee = PACK_GUARANTEES[tier];
  const cards = [];

  // Garantili kart varsa önce onu seç
  if (guarantee.guaranteed) {
    const guaranteed = await getRandomCardByRarity(client, guarantee.guaranteed, tier, seededRandom(seed, 0));
    if (guaranteed) cards.push(guaranteed);
  }

  // Kalan slotları doldur
  for (let i = cards.length; i < count; i++) {
    const rng1 = seededRandom(seed, i * 2 + 1);
    const rng2 = seededRandom(seed, i * 2 + 2);

    let rarity;

    if (tier === 'elite' && rng1 < guarantee.legendary_chance) {
      rarity = 'legendary';
    } else {
      rarity = weightedRarity(tier, rng1);
    }

    const card = await getRandomCardByRarity(client, rarity, tier, rng2);
    if (card) cards.push(card);
  }

  return cards;
}

async function getRandomCardByRarity(client, rarity, tier, rng) {
  const rateCol = `drop_rate_${tier}`;
  const { rows } = await client.query(
    `SELECT * FROM card_templates
     WHERE rarity = $1
       AND ${rateCol} > 0
       AND is_active = TRUE
     ORDER BY id`,
    [rarity]
  );

  if (rows.length === 0) {
    // Fallback: herhangi bir aktif kart
    const { rows: fallback } = await client.query(
      `SELECT * FROM card_templates WHERE is_active = TRUE LIMIT 1`
    );
    return fallback[0] || null;
  }

  return rows[Math.floor(rng * rows.length)];
}

// Drop rate ağırlıkları (tier bazlı)
const DROP_WEIGHTS = {
  bronze: { common: 0.75, rare: 0.20, epic: 0.045, legendary: 0.005 },
  silver: { common: 0.55, rare: 0.32, epic: 0.11,  legendary: 0.02  },
  gold:   { common: 0.35, rare: 0.35, epic: 0.22,  legendary: 0.08  },
  elite:  { common: 0.15, rare: 0.30, epic: 0.35,  legendary: 0.20  },
};

function weightedRarity(tier, rng) {
  const weights = DROP_WEIGHTS[tier];
  let cumulative = 0;
  for (const [rarity, weight] of Object.entries(weights)) {
    cumulative += weight;
    if (rng <= cumulative) return rarity;
  }
  return 'common';
}

// ── SEED & RNG ───────────────────────────────────────────────

function generateSeed(userId, tier, timestamp) {
  const data = `${userId}:${tier}:${timestamp}:${process.env.JWT_SECRET}`;
  return createHash('sha256').update(data).digest('hex');
}

function seededRandom(seed, index) {
  const hash = createHash('sha256').update(`${seed}:${index}`).digest('hex');
  return parseInt(hash.substring(0, 8), 16) / 0xffffffff;
}

// ── AKTİF SLOT YÖNETİMİ ─────────────────────────────────────

async function setActiveSlot(userId, userCardId, slotPosition) {
  return withTransaction(async (client) => {
    const { rows: [user] } = await client.query(
      `SELECT active_slots FROM users WHERE id = $1`, [userId]
    );

    if (slotPosition > user.active_slots) {
      throw new Error(`Slot ${slotPosition} henüz açık değil. Mevcut max: ${user.active_slots}`);
    }

    // O slotta başka kart varsa çıkar
    await client.query(
      `UPDATE user_cards SET is_active_slot = FALSE, slot_position = NULL
       WHERE user_id = $1 AND slot_position = $2`,
      [userId, slotPosition]
    );

    // Yeni kartı slota koy
    await client.query(
      `UPDATE user_cards SET is_active_slot = TRUE, slot_position = $1
       WHERE id = $2 AND user_id = $3`,
      [slotPosition, userCardId, userId]
    );

    return { success: true, slot: slotPosition };
  });
}

async function getInventory(userId, page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  const { rows } = await query(
    `SELECT uc.id, uc.is_active_slot, uc.slot_position, uc.is_in_album, uc.is_listed,
            ct.name, ct.nationality, ct.position, ct.overall, ct.rarity,
            ct.image_url, ct.gp_per_hour
     FROM user_cards uc
     JOIN card_templates ct ON ct.id = uc.template_id
     WHERE uc.user_id = $1
     ORDER BY ct.overall DESC, ct.rarity DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  const { rows: [{ count }] } = await query(
    `SELECT COUNT(*) FROM user_cards WHERE user_id = $1`, [userId]
  );

  return { cards: rows, total: parseInt(count), page, limit };
}

module.exports = { openPack, setActiveSlot, getInventory };
