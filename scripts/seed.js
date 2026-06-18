// scripts/seed.js
// Örnek veri — koleksiyonlar ve kurgusal futbolcu kartları

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// ── KOLEKSİYONLAR ───────────────────────────────────────────

const collections = [
  {
    name: 'South American Stars',
    description: 'The best players from South America',
    total_cards: 10,
    reward_gp: 15000,
    reward_pack_tier: 'silver',
  },
  {
    name: 'European Legends',
    description: 'Elite players from European leagues',
    total_cards: 12,
    reward_gp: 25000,
    reward_pack_tier: 'gold',
  },
  {
    name: 'Rising Stars',
    description: 'Young talents under 23',
    total_cards: 8,
    reward_gp: 10000,
    reward_pack_tier: 'silver',
  },
  {
    name: 'World Cup Heroes',
    description: 'Icons of the global championship',
    total_cards: 15,
    reward_gp: 50000,
    reward_pack_tier: 'elite',
  },
];

// ── KURGUSAL KARTLAR ─────────────────────────────────────────
// İsimler tamamen kurgusal, milliyetler gerçek

const cards = [

  // ── LEGENDARY (overall 88-99) ──
  { name: 'Mateo Reyes',    nationality: 'ARG', position: 'FWD', overall: 99, rarity: 'legendary',
    pace: 92, shooting: 98, passing: 90, dribbling: 99, defending: 45, physical: 78,
    collection: 'South American Stars',
    drop_rate_elite: 0.03000, drop_rate_gold: 0.00500, drop_rate_silver: 0, drop_rate_bronze: 0 },

  { name: 'Cris Fernandez', nationality: 'PRT', position: 'FWD', overall: 98, rarity: 'legendary',
    pace: 90, shooting: 97, passing: 82, dribbling: 95, defending: 40, physical: 89,
    collection: 'European Legends',
    drop_rate_elite: 0.03000, drop_rate_gold: 0.00500, drop_rate_silver: 0, drop_rate_bronze: 0 },

  { name: 'Neyv Santos',    nationality: 'BRA', position: 'FWD', overall: 95, rarity: 'legendary',
    pace: 95, shooting: 88, passing: 86, dribbling: 98, defending: 35, physical: 70,
    collection: 'South American Stars',
    drop_rate_elite: 0.04000, drop_rate_gold: 0.01000, drop_rate_silver: 0, drop_rate_bronze: 0 },

  { name: 'Kyl Morel',      nationality: 'FRA', position: 'FWD', overall: 95, rarity: 'legendary',
    pace: 99, shooting: 92, passing: 82, dribbling: 94, defending: 38, physical: 80,
    collection: 'European Legends',
    drop_rate_elite: 0.04000, drop_rate_gold: 0.01000, drop_rate_silver: 0, drop_rate_bronze: 0 },

  { name: 'Erling Solberg', nationality: 'NOR', position: 'FWD', overall: 94, rarity: 'legendary',
    pace: 89, shooting: 96, passing: 65, dribbling: 80, defending: 45, physical: 95,
    collection: 'World Cup Heroes',
    drop_rate_elite: 0.05000, drop_rate_gold: 0.01500, drop_rate_silver: 0, drop_rate_bronze: 0 },

  { name: 'Vini Torres',    nationality: 'BRA', position: 'FWD', overall: 92, rarity: 'legendary',
    pace: 97, shooting: 88, passing: 80, dribbling: 96, defending: 32, physical: 72,
    collection: 'South American Stars',
    drop_rate_elite: 0.05000, drop_rate_gold: 0.01500, drop_rate_silver: 0, drop_rate_bronze: 0 },

  // ── EPIC (overall 78-87) ──
  { name: 'Luka Pavic',     nationality: 'HRV', position: 'MID', overall: 87, rarity: 'epic',
    pace: 75, shooting: 75, passing: 94, dribbling: 90, defending: 78, physical: 76,
    collection: 'World Cup Heroes',
    drop_rate_elite: 0.06000, drop_rate_gold: 0.03000, drop_rate_silver: 0.01000, drop_rate_bronze: 0 },

  { name: 'Toni Kovac',     nationality: 'DEU', position: 'MID', overall: 86, rarity: 'epic',
    pace: 72, shooting: 78, passing: 92, dribbling: 85, defending: 80, physical: 82,
    collection: 'European Legends',
    drop_rate_elite: 0.06000, drop_rate_gold: 0.03000, drop_rate_silver: 0.01000, drop_rate_bronze: 0 },

  { name: 'Son Minho',      nationality: 'KOR', position: 'FWD', overall: 85, rarity: 'epic',
    pace: 93, shooting: 87, passing: 82, dribbling: 88, defending: 42, physical: 75,
    collection: 'World Cup Heroes',
    drop_rate_elite: 0.07000, drop_rate_gold: 0.04000, drop_rate_silver: 0.01500, drop_rate_bronze: 0 },

  { name: 'Jan Ruiz',       nationality: 'ESP', position: 'GK',  overall: 84, rarity: 'epic',
    pace: 55, shooting: 20, passing: 65, dribbling: 40, defending: 90, physical: 82,
    collection: 'European Legends',
    drop_rate_elite: 0.07000, drop_rate_gold: 0.04000, drop_rate_silver: 0.01500, drop_rate_bronze: 0 },

  { name: 'Rafa Silva',     nationality: 'BRA', position: 'MID', overall: 83, rarity: 'epic',
    pace: 80, shooting: 72, passing: 88, dribbling: 87, defending: 70, physical: 74,
    collection: 'South American Stars',
    drop_rate_elite: 0.07000, drop_rate_gold: 0.04000, drop_rate_silver: 0.02000, drop_rate_bronze: 0 },

  { name: 'Marco Diaz',     nationality: 'ARG', position: 'DEF', overall: 82, rarity: 'epic',
    pace: 76, shooting: 45, passing: 72, dribbling: 68, defending: 88, physical: 85,
    collection: 'South American Stars',
    drop_rate_elite: 0.08000, drop_rate_gold: 0.04000, drop_rate_silver: 0.02000, drop_rate_bronze: 0 },

  { name: 'Phil Stone',     nationality: 'ENG', position: 'MID', overall: 81, rarity: 'epic',
    pace: 82, shooting: 80, passing: 85, dribbling: 84, defending: 62, physical: 78,
    collection: 'Rising Stars',
    drop_rate_elite: 0.08000, drop_rate_gold: 0.05000, drop_rate_silver: 0.02000, drop_rate_bronze: 0 },

  { name: 'Gavi Romero',    nationality: 'ESP', position: 'MID', overall: 80, rarity: 'epic',
    pace: 79, shooting: 70, passing: 88, dribbling: 90, defending: 68, physical: 68,
    collection: 'Rising Stars',
    drop_rate_elite: 0.08000, drop_rate_gold: 0.05000, drop_rate_silver: 0.02000, drop_rate_bronze: 0 },

  // ── RARE (overall 65-77) ──
  { name: 'Leon Muller',    nationality: 'DEU', position: 'FWD', overall: 77, rarity: 'rare',
    pace: 88, shooting: 80, passing: 72, dribbling: 78, defending: 38, physical: 82,
    collection: 'European Legends',
    drop_rate_elite: 0.05000, drop_rate_gold: 0.05000, drop_rate_silver: 0.04000, drop_rate_bronze: 0.01000 },

  { name: 'Theo Laurent',   nationality: 'FRA', position: 'DEF', overall: 76, rarity: 'rare',
    pace: 80, shooting: 40, passing: 68, dribbling: 65, defending: 84, physical: 80,
    collection: 'World Cup Heroes',
    drop_rate_elite: 0.05000, drop_rate_gold: 0.05000, drop_rate_silver: 0.04000, drop_rate_bronze: 0.01000 },

  { name: 'Davi Oliveira',  nationality: 'BRA', position: 'MID', overall: 75, rarity: 'rare',
    pace: 78, shooting: 72, passing: 82, dribbling: 80, defending: 65, physical: 70,
    collection: 'Rising Stars',
    drop_rate_elite: 0.05000, drop_rate_gold: 0.05000, drop_rate_silver: 0.05000, drop_rate_bronze: 0.01500 },

  { name: 'Arda Yilmaz',    nationality: 'TUR', position: 'MID', overall: 74, rarity: 'rare',
    pace: 82, shooting: 68, passing: 78, dribbling: 82, defending: 58, physical: 72,
    collection: 'Rising Stars',
    drop_rate_elite: 0.05000, drop_rate_gold: 0.05000, drop_rate_silver: 0.05000, drop_rate_bronze: 0.01500 },

  { name: 'Carlos Mendez',  nationality: 'COL', position: 'FWD', overall: 73, rarity: 'rare',
    pace: 86, shooting: 75, passing: 65, dribbling: 80, defending: 32, physical: 70,
    collection: 'South American Stars',
    drop_rate_elite: 0.05000, drop_rate_gold: 0.06000, drop_rate_silver: 0.05000, drop_rate_bronze: 0.02000 },

  { name: 'Ivan Petrovic',  nationality: 'SRB', position: 'GK',  overall: 72, rarity: 'rare',
    pace: 52, shooting: 15, passing: 60, dribbling: 42, defending: 82, physical: 80,
    collection: 'World Cup Heroes',
    drop_rate_elite: 0.05000, drop_rate_gold: 0.06000, drop_rate_silver: 0.05000, drop_rate_bronze: 0.02000 },

  { name: 'Ali Hassan',     nationality: 'MAR', position: 'DEF', overall: 71, rarity: 'rare',
    pace: 78, shooting: 38, passing: 62, dribbling: 60, defending: 80, physical: 82,
    collection: 'World Cup Heroes',
    drop_rate_elite: 0.05000, drop_rate_gold: 0.06000, drop_rate_silver: 0.06000, drop_rate_bronze: 0.02000 },

  { name: 'Kim Jae-won',    nationality: 'KOR', position: 'MID', overall: 70, rarity: 'rare',
    pace: 80, shooting: 65, passing: 78, dribbling: 75, defending: 62, physical: 70,
    collection: 'Rising Stars',
    drop_rate_elite: 0.05000, drop_rate_gold: 0.06000, drop_rate_silver: 0.06000, drop_rate_bronze: 0.02000 },

  // ── COMMON (overall 40-64) ──
  { name: 'Tom Walker',     nationality: 'ENG', position: 'DEF', overall: 64, rarity: 'common',
    pace: 72, shooting: 30, passing: 58, dribbling: 52, defending: 70, physical: 74,
    collection: null,
    drop_rate_elite: 0, drop_rate_gold: 0.02000, drop_rate_silver: 0.06000, drop_rate_bronze: 0.08000 },

  { name: 'Lucas Petit',    nationality: 'FRA', position: 'MID', overall: 62, rarity: 'common',
    pace: 70, shooting: 58, passing: 68, dribbling: 65, defending: 50, physical: 62,
    collection: null,
    drop_rate_elite: 0, drop_rate_gold: 0.02000, drop_rate_silver: 0.06000, drop_rate_bronze: 0.08000 },

  { name: 'Ahmed Karim',    nationality: 'EGY', position: 'FWD', overall: 60, rarity: 'common',
    pace: 75, shooting: 65, passing: 55, dribbling: 68, defending: 28, physical: 65,
    collection: null,
    drop_rate_elite: 0, drop_rate_gold: 0.02000, drop_rate_silver: 0.07000, drop_rate_bronze: 0.09000 },

  { name: 'Pedro Costa',    nationality: 'PRT', position: 'DEF', overall: 58, rarity: 'common',
    pace: 65, shooting: 28, passing: 55, dribbling: 50, defending: 68, physical: 72,
    collection: null,
    drop_rate_elite: 0, drop_rate_gold: 0.02000, drop_rate_silver: 0.07000, drop_rate_bronze: 0.09000 },

  { name: 'Sven Berg',      nationality: 'SWE', position: 'GK',  overall: 55, rarity: 'common',
    pace: 48, shooting: 12, passing: 50, dribbling: 35, defending: 68, physical: 72,
    collection: null,
    drop_rate_elite: 0, drop_rate_gold: 0.01000, drop_rate_silver: 0.07000, drop_rate_bronze: 0.10000 },

  { name: 'Raj Patel',      nationality: 'IND', position: 'MID', overall: 52, rarity: 'common',
    pace: 68, shooting: 50, passing: 62, dribbling: 58, defending: 45, physical: 60,
    collection: null,
    drop_rate_elite: 0, drop_rate_gold: 0.01000, drop_rate_silver: 0.07000, drop_rate_bronze: 0.10000 },

  { name: 'Felix Braun',    nationality: 'DEU', position: 'FWD', overall: 48, rarity: 'common',
    pace: 62, shooting: 55, passing: 48, dribbling: 58, defending: 25, physical: 60,
    collection: null,
    drop_rate_elite: 0, drop_rate_gold: 0, drop_rate_silver: 0.06000, drop_rate_bronze: 0.12000 },

  { name: 'Omar Diallo',    nationality: 'SEN', position: 'DEF', overall: 44, rarity: 'common',
    pace: 70, shooting: 22, passing: 45, dribbling: 42, defending: 58, physical: 68,
    collection: null,
    drop_rate_elite: 0, drop_rate_gold: 0, drop_rate_silver: 0.05000, drop_rate_bronze: 0.12000 },
];

// ── SEED FONKSİYONU ──────────────────────────────────────────

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('🌱 Koleksiyonlar ekleniyor...');
    const collectionIds = {};
    for (const col of collections) {
      const { rows: [existing] } = await client.query(
        `SELECT id FROM collections WHERE name = $1`, [col.name]
      );
      if (existing) {
        collectionIds[col.name] = existing.id;
        console.log(`  ⏭  Mevcut: ${col.name}`);
        continue;
      }
      const { rows: [inserted] } = await client.query(
        `INSERT INTO collections (name, description, total_cards, reward_gp, reward_pack_tier)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [col.name, col.description, col.total_cards, col.reward_gp, col.reward_pack_tier]
      );
      collectionIds[col.name] = inserted.id;
      console.log(`  ✅ ${col.name}`);
    }

    console.log('\n🃏 Kartlar ekleniyor...');
    for (const card of cards) {
      const { rows: [existing] } = await client.query(
        `SELECT id FROM card_templates WHERE name = $1`, [card.name]
      );
      if (existing) {
        console.log(`  ⏭  Mevcut: ${card.name}`);
        continue;
      }

      const collectionId = card.collection ? collectionIds[card.collection] : null;

      await client.query(
        `INSERT INTO card_templates
           (name, nationality, position, overall, rarity,
            pace, shooting, passing, dribbling, defending, physical,
            image_url, collection_id, min_pack_tier,
            drop_rate_bronze, drop_rate_silver, drop_rate_gold, drop_rate_elite)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          card.name, card.nationality, card.position, card.overall, card.rarity,
          card.pace, card.shooting, card.passing, card.dribbling, card.defending, card.physical,
          `https://cdn.footballverse.app/cards/${card.name.toLowerCase().replace(/\s/g,'-')}.png`,
          collectionId,
          card.rarity === 'legendary' ? 'gold'
            : card.rarity === 'epic'  ? 'silver'
            : card.rarity === 'rare'  ? 'bronze' : 'bronze',
          card.drop_rate_bronze, card.drop_rate_silver,
          card.drop_rate_gold,   card.drop_rate_elite,
        ]
      );
      console.log(`  ✅ ${card.name} (${card.rarity}, OVR ${card.overall})`);
    }

    await client.query('COMMIT');
    console.log('\n✅ Seed tamamlandı!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed hatası:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
