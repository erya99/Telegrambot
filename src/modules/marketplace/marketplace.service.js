// src/modules/marketplace/marketplace.service.js
// TON ile kart pazar yeri — listeleme, satın alma, %5 komisyon

const { query, withTransaction } = require('../../database/db');
const { updateTaskProgress } = require('../gp/gp.service');

const FEE_PERCENT = parseInt(process.env.MARKETPLACE_FEE_PERCENT || '5');
const MIN_PRICE_NANO = 100_000_000n;   // 0.1 TON minimum fiyat
const MAX_PRICE_NANO = 10_000_000_000_000n; // 10.000 TON maximum
const LISTING_DAYS   = 7;              // Listeleme süresi

// ── KART LİSTELE ────────────────────────────────────────────

async function listCard(userId, userCardId, priceNanoTon) {
  const price = BigInt(priceNanoTon);

  if (price < MIN_PRICE_NANO) {
    throw new Error(`Minimum fiyat 0.1 TON (${MIN_PRICE_NANO} nano)`);
  }
  if (price > MAX_PRICE_NANO) {
    throw new Error('Maksimum fiyat 10.000 TON');
  }

  return withTransaction(async (client) => {
    // Kartın bu kullanıcıya ait olduğunu doğrula
    const { rows: [card] } = await client.query(
      `SELECT uc.*, ct.name, ct.overall, ct.rarity, ct.image_url, ct.nationality, ct.position
       FROM user_cards uc
       JOIN card_templates ct ON ct.id = uc.template_id
       WHERE uc.id = $1 AND uc.user_id = $2`,
      [userCardId, userId]
    );

    if (!card) throw new Error('Kart bulunamadı veya size ait değil');
    if (card.is_listed) throw new Error('Bu kart zaten pazarda listelendi');
    if (card.is_active_slot) throw new Error('Aktif slottaki kartı listeleyemezsiniz. Önce slottan çıkarın');

    // Aynı kart zaten aktif listede mi?
    const { rows: [existing] } = await client.query(
      `SELECT id FROM marketplace_listings
       WHERE user_card_id = $1 AND status = 'active'`,
      [userCardId]
    );
    if (existing) throw new Error('Bu kart zaten listede');

    const feeNano    = (price * BigInt(FEE_PERCENT)) / 100n;
    const sellerGets = price - feeNano;
    const expiresAt  = new Date(Date.now() + LISTING_DAYS * 24 * 60 * 60 * 1000);

    // Listeyi oluştur
    const { rows: [listing] } = await client.query(
      `INSERT INTO marketplace_listings
         (seller_id, user_card_id, template_id, price_nano_ton,
          platform_fee, seller_receives, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [userId, userCardId, card.template_id, price.toString(),
       feeNano.toString(), sellerGets.toString(), expiresAt]
    );

    // Kartı kilitli işaretle
    await client.query(
      `UPDATE user_cards SET is_listed = TRUE WHERE id = $1`,
      [userCardId]
    );

    return {
      listingId: listing.id,
      card: {
        name: card.name,
        overall: card.overall,
        rarity: card.rarity,
        nationality: card.nationality,
        position: card.position,
      },
      priceNanoTon:   price.toString(),
      priceTon:       nanoToTon(price),
      platformFee:    nanoToTon(feeNano),
      sellerReceives: nanoToTon(sellerGets),
      expiresAt,
    };
  });
}

// ── LİSTEYİ İPTAL ET ────────────────────────────────────────

async function cancelListing(userId, listingId) {
  return withTransaction(async (client) => {
    const { rows: [listing] } = await client.query(
      `SELECT * FROM marketplace_listings
       WHERE id = $1 AND seller_id = $2 AND status = 'active'`,
      [listingId, userId]
    );

    if (!listing) throw new Error('Liste bulunamadı veya size ait değil');

    await client.query(
      `UPDATE marketplace_listings SET status = 'cancelled' WHERE id = $1`,
      [listingId]
    );

    await client.query(
      `UPDATE user_cards SET is_listed = FALSE WHERE id = $1`,
      [listing.user_card_id]
    );

    return { success: true };
  });
}

// ── KART SATIN AL ────────────────────────────────────────────
// TON ödemesi ton.service tarafından doğrulandıktan SONRA çağrılır

async function completePurchase(buyerId, listingId, tonTxHash) {
  return withTransaction(async (client) => {
    // Listeyi kilitle
    const { rows: [listing] } = await client.query(
      `SELECT ml.*, ct.name, ct.overall, ct.rarity, ct.nationality, ct.position
       FROM marketplace_listings ml
       JOIN card_templates ct ON ct.id = ml.template_id
       WHERE ml.id = $1 AND ml.status = 'active'
       FOR UPDATE`,
      [listingId]
    );

    if (!listing) throw new Error('Liste bulunamadı veya artık aktif değil');
    if (listing.seller_id === buyerId) throw new Error('Kendi kartınızı satın alamazsınız');

    // TX hash daha önce kullanılmış mı?
    const { rows: [usedTx] } = await client.query(
      `SELECT id FROM ton_transactions WHERE tx_hash = $1`,
      [tonTxHash]
    );
    if (usedTx) throw new Error('Bu işlem daha önce kullanılmış');

    // TON işlem kaydı
    await client.query(
      `INSERT INTO ton_transactions
         (user_id, type, amount_nano, tx_hash,
          to_address, confirmed, reference_id, confirmed_at)
       VALUES ($1, 'ton_marketplace_sale', $2, $3, $4, TRUE, $5, NOW())`,
      [buyerId, listing.price_nano_ton, tonTxHash,
       process.env.PLATFORM_WALLET_ADDRESS, listingId]
    );

    // Listeyi güncelle
    await client.query(
      `UPDATE marketplace_listings SET
         status    = 'sold',
         buyer_id  = $1,
         sale_tx_hash = $2,
         sold_at   = NOW()
       WHERE id = $3`,
      [buyerId, tonTxHash, listingId]
    );

    // Kartı alıcıya ver
    await client.query(
      `UPDATE user_cards SET
         user_id    = $1,
         is_listed  = FALSE,
         source     = 'marketplace',
         obtained_at = NOW()
       WHERE id = $2`,
      [buyerId, listing.user_card_id]
    );

    // Görev ilerlemesi (alıcı)
    await updateTaskProgress(client, buyerId, 'marketplace_buy', 1);

    // Satıcıya bildirim için bilgiyi döndür
    return {
      success: true,
      card: {
        name:        listing.name,
        overall:     listing.overall,
        rarity:      listing.rarity,
        nationality: listing.nationality,
        position:    listing.position,
      },
      priceTon:       nanoToTon(BigInt(listing.price_nano_ton)),
      sellerReceives: nanoToTon(BigInt(listing.seller_receives)),
      platformFee:    nanoToTon(BigInt(listing.platform_fee)),
      sellerId:       listing.seller_id,
      userCardId:     listing.user_card_id,
    };
  });
}

// ── LİSTELERI GETİR ─────────────────────────────────────────

async function getListings({ rarity, position, sortBy = 'price_asc', page = 1, limit = 20 } = {}) {
  const offset = (page - 1) * limit;
  const conditions = [`ml.status = 'active'`, `ml.expires_at > NOW()`];
  const params = [];
  let i = 1;

  if (rarity) {
    conditions.push(`ct.rarity = $${i++}`);
    params.push(rarity);
  }
  if (position) {
    conditions.push(`ct.position = $${i++}`);
    params.push(position);
  }

  const orderMap = {
    price_asc:   'ml.price_nano_ton ASC',
    price_desc:  'ml.price_nano_ton DESC',
    overall_desc:'ct.overall DESC',
    newest:      'ml.listed_at DESC',
  };
  const orderBy = orderMap[sortBy] || 'ml.price_nano_ton ASC';

  params.push(limit, offset);

  const { rows } = await query(
    `SELECT
       ml.id, ml.price_nano_ton, ml.listed_at, ml.expires_at,
       ct.name, ct.nationality, ct.position, ct.overall, ct.rarity, ct.image_url,
       u.username as seller_username
     FROM marketplace_listings ml
     JOIN card_templates ct ON ct.id = ml.template_id
     JOIN users u ON u.id = ml.seller_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY ${orderBy}
     LIMIT $${i++} OFFSET $${i}`,
    params
  );

  const { rows: [{ count }] } = await query(
    `SELECT COUNT(*) FROM marketplace_listings ml
     JOIN card_templates ct ON ct.id = ml.template_id
     WHERE ${conditions.join(' AND ')}`,
    params.slice(0, -2)
  );

  return {
    listings: rows.map(r => ({
      ...r,
      priceTon: nanoToTon(BigInt(r.price_nano_ton)),
    })),
    total: parseInt(count),
    page,
    limit,
  };
}

// Tek liste detayı
async function getListing(listingId) {
  const { rows: [listing] } = await query(
    `SELECT
       ml.*,
       ct.name, ct.nationality, ct.position, ct.overall, ct.rarity,
       ct.image_url, ct.gp_per_hour,
       ct.pace, ct.shooting, ct.passing, ct.dribbling, ct.defending, ct.physical,
       u.username as seller_username
     FROM marketplace_listings ml
     JOIN card_templates ct ON ct.id = ml.template_id
     JOIN users u ON u.id = ml.seller_id
     WHERE ml.id = $1`,
    [listingId]
  );

  if (!listing) return null;

  return {
    ...listing,
    priceTon:       nanoToTon(BigInt(listing.price_nano_ton)),
    sellerReceives: nanoToTon(BigInt(listing.seller_receives)),
    platformFee:    nanoToTon(BigInt(listing.platform_fee)),
  };
}

// Kullanıcının aktif listeleri
async function getUserListings(userId) {
  const { rows } = await query(
    `SELECT ml.id, ml.price_nano_ton, ml.listed_at, ml.expires_at,
            ct.name, ct.overall, ct.rarity, ct.nationality, ct.position
     FROM marketplace_listings ml
     JOIN card_templates ct ON ct.id = ml.template_id
     WHERE ml.seller_id = $1 AND ml.status = 'active'
     ORDER BY ml.listed_at DESC`,
    [userId]
  );

  return rows.map(r => ({
    ...r,
    priceTon: nanoToTon(BigInt(r.price_nano_ton)),
  }));
}

// ── YARDIMCI ────────────────────────────────────────────────

function nanoToTon(nano) {
  return (Number(nano) / 1_000_000_000).toFixed(2);
}

function tonToNano(ton) {
  return BigInt(Math.floor(parseFloat(ton) * 1_000_000_000));
}

module.exports = {
  listCard,
  cancelListing,
  completePurchase,
  getListings,
  getListing,
  getUserListings,
  nanoToTon,
  tonToNano,
};
