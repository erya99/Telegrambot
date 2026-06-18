# Footballverse Bot

Telegram üzerinde çalışan futbolcu kartı koleksiyon oyunu.

## Hızlı Kurulum

```bash
# 1. Repoyu klonla
git clone <repo> && cd footballverse-bot

# 2. Bağımlılıkları yükle
npm install

# 3. .env dosyasını oluştur
cp .env.example .env
# .env içine BOT_TOKEN ve DB bilgilerini gir

# 4. Veritabanını başlat
docker-compose up -d postgres redis

# 5. Şemayı yükle
npm run migrate

# 6. Botu başlat
npm run dev
```

## BotFather'dan Bot Alma

1. Telegram'da @BotFather'a yaz
2. `/newbot` komutu → isim ver → username ver
3. Gelen token'ı `.env` dosyasına `BOT_TOKEN=` olarak yapıştır

## Proje Yapısı

```
src/
├── bot/
│   └── bot.js              ← Ana bot, tüm komutlar
├── modules/
│   ├── gp/
│   │   └── gp.service.js   ← GP toplama, streak, referral
│   └── packs/
│       └── pack.service.js ← Paket açma, envanter
├── database/
│   ├── db.js               ← PostgreSQL bağlantısı
│   └── migrations/
│       └── 001_schema.sql  ← Tüm tablolar
└── index.js                ← Giriş noktası
```

## Sıradaki Modüller

- [ ] `marketplace.service.js` — TON pazar yeri
- [ ] `ton.service.js` — TON ödeme doğrulama
- [ ] `collection.service.js` — Koleksiyon/albüm sistemi
- [ ] `task.service.js` — Görev yönetimi
- [ ] Admin panel (kart ekleme, ekonomi ayarları)
