-- ============================================================
-- FOOTBALLVERSE BOT — VERİTABANI ŞEMASI
-- PostgreSQL 15+
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── ENUM'LAR ────────────────────────────────────────────────

CREATE TYPE card_rarity AS ENUM ('common', 'rare', 'epic', 'legendary');
CREATE TYPE card_position AS ENUM ('GK', 'DEF', 'MID', 'FWD');
CREATE TYPE pack_tier AS ENUM ('bronze', 'silver', 'gold', 'elite');
CREATE TYPE listing_status AS ENUM ('active', 'sold', 'cancelled');
CREATE TYPE task_type AS ENUM ('daily', 'weekly', 'one_time');
CREATE TYPE tx_type AS ENUM (
  'gp_collection', 'gp_daily_bonus', 'gp_task', 'gp_referral',
  'gp_pack_purchase', 'gp_streak_bonus', 'gp_collection_reward',
  'ton_pack_purchase', 'ton_marketplace_sale', 'ton_marketplace_fee'
);

-- ── 1. USERS ────────────────────────────────────────────────

CREATE TABLE users (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  telegram_id         BIGINT UNIQUE NOT NULL,
  username            VARCHAR(64),
  first_name          VARCHAR(64),
  language_code       VARCHAR(8) DEFAULT 'tr',

  -- Ekonomi
  gp_balance          BIGINT NOT NULL DEFAULT 0,
  gp_lifetime_earned  BIGINT NOT NULL DEFAULT 0,     -- toplam kazanılan (enflasyon takibi)

  -- Level
  level               SMALLINT NOT NULL DEFAULT 1,
  xp                  INTEGER NOT NULL DEFAULT 0,
  active_slots        SMALLINT NOT NULL DEFAULT 10,  -- max aktif koleksiyon slotu

  -- Günlük giriş
  last_login_date     DATE,
  login_streak        SMALLINT NOT NULL DEFAULT 0,
  longest_streak      SMALLINT NOT NULL DEFAULT 0,

  -- GP toplama
  last_collection_at  TIMESTAMPTZ,                   -- son "topla" zamanı

  -- Referans
  referral_code       VARCHAR(10) UNIQUE NOT NULL
                        DEFAULT upper(substr(md5(random()::text), 1, 8)),
  referred_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  referral_count      INTEGER NOT NULL DEFAULT 0,

  -- TON cüzdanı (opsiyonel — pazar yeri için)
  ton_wallet          VARCHAR(66),

  -- Meta
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_banned           BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_users_telegram ON users(telegram_id);
CREATE INDEX idx_users_referral ON users(referral_code);
CREATE INDEX idx_users_level ON users(level DESC);

-- ── 2. CARD_TEMPLATES ───────────────────────────────────────

CREATE TABLE card_templates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Kurgusal futbolcu
  name            VARCHAR(64) NOT NULL,              -- "Marco Silva", "Elena Reyes"
  nationality     VARCHAR(3) NOT NULL,               -- "BRA", "ARG", "TUR"
  position        card_position NOT NULL,
  overall         SMALLINT NOT NULL CHECK (overall BETWEEN 40 AND 99),
  rarity          card_rarity NOT NULL,

  -- Stat detayları
  pace            SMALLINT CHECK (pace BETWEEN 1 AND 99),
  shooting        SMALLINT CHECK (shooting BETWEEN 1 AND 99),
  passing         SMALLINT CHECK (passing BETWEEN 1 AND 99),
  dribbling       SMALLINT CHECK (dribbling BETWEEN 1 AND 99),
  defending       SMALLINT CHECK (defending BETWEEN 1 AND 99),
  physical        SMALLINT CHECK (physical BETWEEN 1 AND 99),

  -- Görsel
  image_url       TEXT NOT NULL,
  card_color      VARCHAR(7) DEFAULT '#1a1a2e',

  -- GP üretimi (saatte, aktif slotta)
  gp_per_hour     SMALLINT GENERATED ALWAYS AS (overall * 2) STORED,

  -- Hangi paketten çıkabilir
  min_pack_tier   pack_tier NOT NULL DEFAULT 'bronze',

  -- Drop rates
  drop_rate_bronze   DECIMAL(6,5) DEFAULT 0,
  drop_rate_silver   DECIMAL(6,5) DEFAULT 0,
  drop_rate_gold     DECIMAL(6,5) DEFAULT 0,
  drop_rate_elite    DECIMAL(6,5) DEFAULT 0,

  -- Koleksiyon grubu
  collection_id   UUID,

  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_templates_rarity ON card_templates(rarity);
CREATE INDEX idx_templates_overall ON card_templates(overall DESC);
CREATE INDEX idx_templates_collection ON card_templates(collection_id);

-- ── 3. COLLECTIONS ──────────────────────────────────────────

CREATE TABLE collections (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(128) NOT NULL,             -- "Güney Amerika Yıldızları"
  description     TEXT,
  image_url       TEXT,
  total_cards     SMALLINT NOT NULL DEFAULT 0,

  -- Tamamlama ödülü
  reward_gp       BIGINT NOT NULL DEFAULT 0,
  reward_pack_tier pack_tier,                        -- Bedava paket tieri

  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE card_templates ADD CONSTRAINT fk_collection
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE SET NULL;

-- ── 4. USER_CARDS ────────────────────────────────────────────

CREATE TABLE user_cards (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id     UUID NOT NULL REFERENCES card_templates(id),

  -- Koleksiyon durumu
  is_active_slot  BOOLEAN NOT NULL DEFAULT FALSE,    -- GP üretecek aktif slotta mı?
  slot_position   SMALLINT,                          -- 1-30 arası slot numarası
  is_in_album     BOOLEAN NOT NULL DEFAULT FALSE,    -- Albüme yapıştırıldı mı?
  stuck_at        TIMESTAMPTZ,

  -- Pazar yeri
  is_listed       BOOLEAN NOT NULL DEFAULT FALSE,

  -- Kazanım
  source          VARCHAR(20) NOT NULL DEFAULT 'pack', -- 'pack' | 'marketplace' | 'reward'
  pack_open_id    UUID,

  obtained_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_cards_user ON user_cards(user_id);
CREATE INDEX idx_user_cards_template ON user_cards(template_id);
CREATE INDEX idx_user_cards_active ON user_cards(user_id, is_active_slot)
  WHERE is_active_slot = TRUE;

-- ── 5. PACK_OPENS ────────────────────────────────────────────

CREATE TABLE pack_opens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier            pack_tier NOT NULL,
  paid_with       VARCHAR(10) NOT NULL,              -- 'gp' | 'ton' | 'stars' | 'free'
  gp_spent        BIGINT NOT NULL DEFAULT 0,
  ton_spent       BIGINT NOT NULL DEFAULT 0,         -- nano-TON
  ton_tx_hash     VARCHAR(64),                       -- TON işlem hash'i
  card_count      SMALLINT NOT NULL DEFAULT 5,
  rng_seed        VARCHAR(64),
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pack_opens_user ON pack_opens(user_id);

ALTER TABLE user_cards ADD CONSTRAINT fk_pack_open
  FOREIGN KEY (pack_open_id) REFERENCES pack_opens(id) ON DELETE SET NULL;

-- ── 6. GP_TRANSACTIONS ───────────────────────────────────────

CREATE TABLE gp_transactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            tx_type NOT NULL,
  amount          BIGINT NOT NULL,                   -- pozitif=kazanç, negatif=harcama
  balance_after   BIGINT NOT NULL,
  reference_id    UUID,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_gp_tx_user ON gp_transactions(user_id);
CREATE INDEX idx_gp_tx_created ON gp_transactions(created_at DESC);

-- ── 7. TON_TRANSACTIONS ──────────────────────────────────────

CREATE TABLE ton_transactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            tx_type NOT NULL,
  amount_nano     BIGINT NOT NULL,                   -- nano-TON
  tx_hash         VARCHAR(64) UNIQUE,
  from_address    VARCHAR(66),
  to_address      VARCHAR(66),
  confirmed       BOOLEAN NOT NULL DEFAULT FALSE,
  reference_id    UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at    TIMESTAMPTZ
);

CREATE INDEX idx_ton_tx_user ON ton_transactions(user_id);
CREATE INDEX idx_ton_tx_hash ON ton_transactions(tx_hash);
CREATE INDEX idx_ton_tx_unconfirmed ON ton_transactions(confirmed)
  WHERE confirmed = FALSE;

-- ── 8. MARKETPLACE_LISTINGS ──────────────────────────────────

CREATE TABLE marketplace_listings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_card_id    UUID NOT NULL REFERENCES user_cards(id) ON DELETE CASCADE,
  template_id     UUID NOT NULL REFERENCES card_templates(id),

  price_nano_ton  BIGINT NOT NULL CHECK (price_nano_ton > 0),
  status          listing_status NOT NULL DEFAULT 'active',

  -- Satış
  buyer_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  platform_fee    BIGINT,                            -- %5
  seller_receives BIGINT,                            -- %95
  sale_tx_hash    VARCHAR(64),
  sold_at         TIMESTAMPTZ,

  listed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days'
);

CREATE INDEX idx_market_status ON marketplace_listings(status)
  WHERE status = 'active';
CREATE INDEX idx_market_template ON marketplace_listings(template_id)
  WHERE status = 'active';
CREATE INDEX idx_market_seller ON marketplace_listings(seller_id);
CREATE UNIQUE INDEX idx_market_card_active
  ON marketplace_listings(user_card_id)
  WHERE status = 'active';

-- ── 9. TASKS ─────────────────────────────────────────────────

CREATE TABLE tasks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title           VARCHAR(128) NOT NULL,
  description     TEXT,
  type            task_type NOT NULL DEFAULT 'daily',
  reward_gp       BIGINT NOT NULL DEFAULT 0,
  reward_pack_tier pack_tier,
  condition_type  VARCHAR(32),                       -- 'open_pack', 'collect_gp', 'invite_friend'
  condition_value INTEGER NOT NULL DEFAULT 1,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_tasks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  progress        INTEGER NOT NULL DEFAULT 0,
  completed       BOOLEAN NOT NULL DEFAULT FALSE,
  claimed         BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at    TIMESTAMPTZ,
  reset_at        DATE,                              -- daily task'ler için
  UNIQUE(user_id, task_id, reset_at)
);

-- ── 10. COLLECTION_PROGRESS ──────────────────────────────────

CREATE TABLE collection_progress (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_id   UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  owned_count     SMALLINT NOT NULL DEFAULT 0,
  is_completed    BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at    TIMESTAMPTZ,
  reward_claimed  BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(user_id, collection_id)
);

-- ── FONKSİYONLAR ─────────────────────────────────────────────

-- Race-condition korumalı GP güncelleme
CREATE OR REPLACE FUNCTION update_gp(
  p_user_id UUID,
  p_amount   BIGINT,
  p_type     tx_type,
  p_ref_id   UUID DEFAULT NULL,
  p_note     TEXT DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
  v_before BIGINT;
  v_after  BIGINT;
BEGIN
  SELECT gp_balance INTO v_before
  FROM users WHERE id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_user_id;
  END IF;

  v_after := v_before + p_amount;

  IF v_after < 0 THEN
    RAISE EXCEPTION 'Insufficient GP. Has: %, Needs: %', v_before, ABS(p_amount);
  END IF;

  UPDATE users SET
    gp_balance = v_after,
    gp_lifetime_earned = CASE
      WHEN p_amount > 0 THEN gp_lifetime_earned + p_amount
      ELSE gp_lifetime_earned
    END,
    updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO gp_transactions(user_id, type, amount, balance_after, reference_id, note)
  VALUES (p_user_id, p_type, p_amount, v_after, p_ref_id, p_note);

  RETURN v_after;
END;
$$ LANGUAGE plpgsql;

-- Level hesaplama
CREATE OR REPLACE FUNCTION calc_level(p_xp INTEGER)
RETURNS SMALLINT AS $$
BEGIN
  RETURN GREATEST(1, LEAST(100, FLOOR(SQRT(p_xp / 100.0))::SMALLINT + 1));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── SEED: GÖREVLER ───────────────────────────────────────────

INSERT INTO tasks (title, description, type, reward_gp, condition_type, condition_value) VALUES
('İlk paket', 'Günlük bedava paketi aç', 'daily', 300, 'open_pack', 1),
('GP topla', '3 saatlik GP üretimini topla', 'daily', 200, 'collect_gp', 1),
('Arkadaşını davet et', 'Bir arkadaşı platforma davet et', 'one_time', 3000, 'invite_friend', 1),
('Koleksiyoncu', 'Koleksiyonuna 10 kart yapıştır', 'one_time', 1000, 'album_cards', 10),
('Pazar alıcı', 'Pazardan ilk kartını satın al', 'one_time', 500, 'marketplace_buy', 1);

-- ── STREAK BONUS TABLOSU ─────────────────────────────────────

CREATE TABLE streak_rewards (
  streak_day    SMALLINT PRIMARY KEY,
  reward_gp     BIGINT NOT NULL DEFAULT 0,
  reward_pack   pack_tier
);

INSERT INTO streak_rewards (streak_day, reward_gp, reward_pack) VALUES
(1,  500,   NULL),
(2,  600,   NULL),
(3,  700,   NULL),
(4,  800,   NULL),
(5,  1000,  NULL),
(6,  1200,  NULL),
(7,  2000,  'bronze'),
(14, 3000,  'silver'),
(21, 4000,  'silver'),
(30, 5000,  'gold');
