// src/index.js
require('dotenv').config();
const bot = require('./bot/bot');
const app = require('./api/server');

const API_PORT = process.env.API_PORT || 3000;

async function main() {
  console.log('🚀 Footballverse başlatılıyor...');

  // API server başlat
  app.listen(API_PORT, () => {
    console.log(`✅ API server: http://localhost:${API_PORT}`);
    console.log(`🏥 Health check: http://localhost:${API_PORT}/health`);
  });

  // Telegram bot başlat
  if (process.env.NODE_ENV === 'production' && process.env.WEBHOOK_URL) {
    await bot.telegram.setWebhook(`${process.env.WEBHOOK_URL}/webhook`);
    console.log(`✅ Webhook aktif: ${process.env.WEBHOOK_URL}`);
  } else {
    await bot.telegram.deleteWebhook();
    bot.launch();
    console.log('✅ Bot polling modunda çalışıyor...');
  }

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch(console.error);
