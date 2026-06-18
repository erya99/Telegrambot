// src/modules/collections/collection.service.js
// Koleksiyon ve albüm sistemi — kart yapıştırma, tamamlama ödülleri

const { query, withTransaction } = require('../../database/db');

// ── TÜM KOLEKSİYONLAR ───────────────────────────────────────

async function getCollections(userId) {
  const { rows } = await query(
    `SELECT
       c.id, c.name, c.description, c.image_url, c.total_cards,
       c.reward_gp, c.reward_pack_tier,
       COALESCE(cp.owned_count, 0) as owned_count,
       COALESCE(cp.is_completed, FALSE) as is_completed,
       COALESCE(cp.reward_claimed, FALSE) as reward_claimed
     FROM collections c
     LEFT JOIN collection_progress cp
       ON cp.collection_id = c.id AND cp.user_id = $1
     WHERE c.is_active = TRUE
     ORDER BY cp.is_completed ASC, c.name ASC`,
    [userId]
  );

  return rows.map(c => ({
    ...c,
    percent: c.total_cards > 0
      ? Math.floor((c.owned_count / c.total_cards) * 100)
      : 0,
    progressBar: makeProgressBar(c.owned_count, c.total_cards),
  }));
}

// ── KOLEKSİYON DETAYI ───────────────────────────────────────

async function getCollectionDetail(userId, collectionId) {
  const { rows: [collection] } = await query(
    `SELECT c.*,
       COALESCE(cp.owned_count, 0) as owned_count,
       COALESCE(cp.is_completed, FALSE) as is_completed,
       COALESCE(cp.reward_claimed, FALSE) as reward_claimed
     FROM collections c
     LEFT JOIN collection_progress cp
       ON cp.collection_id = c.id AND cp.user_id = $1
     WHERE c.id = $2`,
    [userId, collectionId]
  );

  if (!collection) return null;

  // Bu koleksiyondaki tüm kartlar ve kullanıcının sahip olduğu
  const { rows: cards } = await query(
    `SELECT
       ct.id as template_id, ct.name, ct.nationality, ct.position,
       ct.overall, ct.rarity, ct.image_url,
       uc.id as user_card_id,
       uc.is_in_album
     FROM card_templates ct
     LEFT JOIN user_cards uc
       ON uc.template_id = ct.id
       AND uc.user_id = $1
       AND uc.is_in_album = TRUE
     WHERE ct.collection_id = $2
     ORDER BY ct.overall DESC`,
    [userId, collectionId]
  );

  return {
    ...collection,
    percent: collection.total_cards > 0
      ? Math.floor((collection.owned_count / collection.total_cards) * 100)
      : 0,
    progressBar: makeProgressBar(collection.owned_count, collection.total_cards),
    cards,
  };
}

// ── KART ALBÜME YAPIŞTIR ─────────────────────────────────────

async function stickCard(userId, userCardId) {
  return withTransaction(async (client) => {
    // Kartı doğrula
    const { rows: [card] } = await client.query(
      `SELECT uc.*, ct.name, ct.overall, ct.rarity, ct.collection_id,
              ct.nationality, ct.position, ct.gp_per_hour
       FROM user_cards uc
       JOIN card_templates ct ON ct.id = uc.template_id
       WHERE uc.id = $1 AND uc.user_id = $2`,
      [userCardId, userId]
    );

    if (!card) throw new Error('Kart bulunamadı');
    if (card.is_in_album) throw new Error('Bu kart zaten albümde');
    if (card.is_listed) throw new Error('Listedeki kartı albüme ekleyemezsiniz');
    if (!card.collection_id) throw new Error('Bu kartın ait olduğu bir koleksiyon yok');

    // Bu koleksiyonda aynı template zaten yapıştırılmış mı?
    const { rows: [duplicate] } = await client.query(
      `SELECT uc.id FROM user_cards uc
       JOIN card_templates ct ON ct.id = uc.template_id
       WHERE uc.user_id = $1
         AND ct.id = $2
         AND uc.is_in_album = TRUE
         AND uc.id != $3`,
      [userId, card.template_id, userCardId]
    );

    if (duplicate) {
      throw new Error('Bu kartın bir kopyası zaten albümünüzde var');
    }

    // Kartı albüme yapıştır
    await client.query(
      `UPDATE user_cards SET is_in_album = TRUE, stuck_at = NOW() WHERE id = $1`,
      [userCardId]
    );

    // Koleksiyon ilerlemesini güncelle (upsert)
    await client.query(
      `INSERT INTO collection_progress (user_id, collection_id, owned_count)
       VALUES ($1, $2, 1)
       ON CONFLICT (user_id, collection_id) DO UPDATE
         SET owned_count = collection_progress.owned_count + 1`,
      [userId, card.collection_id]
    );

    // Koleksiyon tamamlandı mı?
    const { rows: [progress] } = await client.query(
      `SELECT cp.owned_count, c.total_cards
       FROM collection_progress cp
       JOIN collections c ON c.id = cp.collection_id
       WHERE cp.user_id = $1 AND cp.collection_id = $2`,
      [userId, card.collection_id]
    );

    let collectionCompleted = false;
    if (progress && progress.owned_count >= progress.total_cards) {
      await client.query(
        `UPDATE collection_progress
         SET is_completed = TRUE, completed_at = NOW()
         WHERE user_id = $1 AND collection_id = $2 AND is_completed = FALSE`,
        [userId, card.collection_id]
      );
      collectionCompleted = true;
    }

    // XP ekle (kart yapıştırma için)
    const xpGain = { common: 10, rare: 25, epic: 60, legendary: 150 }[card.rarity] || 10;
    await client.query(
      `UPDATE users SET
         xp = xp + $1,
         level = calc_level(xp + $1),
         updated_at = NOW()
       WHERE id = $2`,
      [xpGain, userId]
    );

    return {
      success: true,
      card: {
        name: card.name,
        overall: card.overall,
        rarity: card.rarity,
        nationality: card.nationality,
        position: card.position,
        gpPerHour: card.gp_per_hour,
      },
      collectionId: card.collection_id,
      collectionCompleted,
      xpGained: xpGain,
      owned: progress?.owned_count || 1,
      total: progress?.total_cards || 0,
    };
  });
}

// ── TAMAMLAMA ÖDÜLÜ AL ───────────────────────────────────────

async function claimCollectionReward(userId, collectionId) {
  return withTransaction(async (client) => {
    const { rows: [progress] } = await client.query(
      `SELECT cp.*, c.reward_gp, c.reward_pack_tier, c.name as collection_name
       FROM collection_progress cp
       JOIN collections c ON c.id = cp.collection_id
       WHERE cp.user_id = $1 AND cp.collection_id = $2
       FOR UPDATE`,
      [userId, collectionId]
    );

    if (!progress) throw new Error('Koleksiyon bulunamadı');
    if (!progress.is_completed) throw new Error('Koleksiyon henüz tamamlanmadı');
    if (progress.reward_claimed) throw new Error('Ödül zaten alındı');

    // GP ödülü
    if (progress.reward_gp > 0) {
      await client.query(
        `SELECT update_gp($1, $2, 'gp_collection_reward', $3, $4)`,
        [userId, progress.reward_gp, collectionId,
         `${progress.collection_name} koleksiyon ödülü`]
      );
    }

    // Paket ödülü
    if (progress.reward_pack_tier) {
      await client.query(
        `INSERT INTO pack_opens (user_id, tier, paid_with, card_count)
         VALUES ($1, $2, 'free', 5)`,
        [userId, progress.reward_pack_tier]
      );
    }

    // Ödül alındı işaretle
    await client.query(
      `UPDATE collection_progress SET reward_claimed = TRUE, reward_claimed_at = NOW()
       WHERE user_id = $1 AND collection_id = $2`,
      [userId, collectionId]
    );

    // XP bonus
    await client.query(
      `UPDATE users SET xp = xp + 500, level = calc_level(xp + 500) WHERE id = $1`,
      [userId]
    );

    return {
      success: true,
      collectionName: progress.collection_name,
      gpRewarded:   progress.reward_gp,
      packRewarded: progress.reward_pack_tier,
      xpBonus:      500,
    };
  });
}

// ── AKTİF SLOT YÖNETİMİ (GP üretimi) ───────────────────────

async function getActiveSlots(userId) {
  const { rows } = await query(
    `SELECT uc.id, uc.slot_position,
            ct.name, ct.overall, ct.rarity, ct.nationality,
            ct.position, ct.gp_per_hour, ct.image_url
     FROM user_cards uc
     JOIN card_templates ct ON ct.id = uc.template_id
     WHERE uc.user_id = $1 AND uc.is_active_slot = TRUE
     ORDER BY uc.slot_position ASC`,
    [userId]
  );

  const { rows: [user] } = await query(
    `SELECT active_slots FROM users WHERE id = $1`, [userId]
  );

  const totalGpPerHour = rows.reduce((s, c) => s + c.gp_per_hour, 0);

  return {
    slots: rows,
    usedSlots: rows.length,
    maxSlots: user?.active_slots || 10,
    totalGpPerHour,
    dailyEstimate: totalGpPerHour * 24,
  };
}

// ── YARDIMCI ────────────────────────────────────────────────

function makeProgressBar(owned, total) {
  if (!total) return '░░░░░░░░░░ 0%';
  const percent = Math.floor((owned / total) * 100);
  const filled  = Math.floor(percent / 10);
  const empty   = 10 - filled;
  return `${'█'.repeat(filled)}${'░'.repeat(empty)} ${percent}%`;
}

module.exports = {
  getCollections,
  getCollectionDetail,
  stickCard,
  claimCollectionReward,
  getActiveSlots,
};
