// src/bot/bot.js
// Ana Telegram bot — komutlar ve menüler

const { Telegraf, Markup, session } = require('telegraf');
const { query, withTransaction } = require('../database/db');
const { collectGP, processDailyLogin, getGPStatus, processReferral } = require('../modules/gp/gp.service');
const { openPack, setActiveSlot, getInventory } = require('../modules/packs/pack.service');
const { registerMarketplaceCommands } = require('./marketplace.bot');
const { registerCollectionCommands } = require('./collection.bot');
const { registerTaskCommands } = require('./tasks.bot');

const bot = new Telegraf(process.env.BOT_TOKEN);

// ── SESSION ──────────────────────────────────────────────────
bot.use(session());

// ── KULLANICI KAYIT / GİRİŞ MİDDLEWARE ──────────────────────
bot.use(async (ctx, next) => {
  if (!ctx.from) return next();

  const tgId = ctx.from.id;

  // Kullanıcıyı bul veya oluştur
  let { rows: [user] } = await query(
    `SELECT * FROM users WHERE telegram_id = $1`, [tgId]
  );

  if (!user) {
    // Yeni kullanıcı
    const { rows: [newUser] } = await query(
      `INSERT INTO users (telegram_id, username, first_name, language_code)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (telegram_id) DO UPDATE
         SET username = $2, first_name = $3, updated_at = NOW()
       RETURNING *`,
      [tgId, ctx.from.username, ctx.from.first_name, ctx.from.language_code || 'tr']
    );
    user = newUser;

    // Referral kontrolü (deep link: /start ref_CODE)
    const startParam = ctx.message?.text?.split(' ')[1];
    if (startParam?.startsWith('ref_')) {
      const code = startParam.replace('ref_', '');
      await processReferral(user.id, code);
    }
  }

  // Günlük giriş
  const loginResult = await processDailyLogin(user.id);
  ctx.state.user = user;
  ctx.state.loginResult = loginResult;

  return next();
});

// ── /start ───────────────────────────────────────────────────
bot.start(async (ctx) => {
  const { user, loginResult } = ctx.state;
  const firstName = ctx.from.first_name || 'Koleksiyoncu';

  let welcomeText = `⚽ *Footballverse'e hoş geldin, ${firstName}!*\n\n`;
  welcomeText += `Kurgusal futbolcu kartları topla, koleksiyonunu tamamla ve ödüller kazan!\n\n`;

  if (!loginResult.alreadyLoggedIn) {
    welcomeText += `🎁 *Günlük giriş bonusu:* +${loginResult.gpEarned.toLocaleString()} GP\n`;
    welcomeText += `🔥 *Streak:* ${loginResult.newStreak} gün\n`;
    if (loginResult.packReward) {
      welcomeText += `🎴 *Streak ödülü:* Bedava ${loginResult.packReward} paket!\n`;
    }
    welcomeText += '\n';
  }

  welcomeText += `💰 Bakiye: *${user.gp_balance?.toLocaleString() || 0} GP*\n`;
  welcomeText += `📊 Level: *${user.level}*\n\n`;
  welcomeText += `Davet bağlantın: \`https://t.me/${process.env.BOT_USERNAME}?start=ref_${user.referral_code}\``;

  await ctx.replyWithMarkdown(welcomeText, mainMenu());
});

// ── /topla — GP toplama ──────────────────────────────────────
bot.command('topla', handleCollect);
bot.hears('💰 GP Topla', handleCollect);

async function handleCollect(ctx) {
  const { user } = ctx.state;
  const result = await collectGP(user.id);

  if (!result.success) {
    if (result.nextCollectAt) {
      const diff = Math.ceil((result.nextCollectAt - new Date()) / 60000);
      await ctx.replyWithMarkdown(
        `⏳ *GP toplama bekleniyor*\n\n${diff} dakika sonra tekrar toplayabilirsin.`
      );
    } else {
      await ctx.replyWithMarkdown(
        `⚠️ *${result.message}*\n\n/koleksiyon komutuyla kartlarını aktif slota ekle.`
      );
    }
    return;
  }

  await ctx.replyWithMarkdown(
    `✅ *GP Toplandı!*\n\n` +
    `💰 Kazanılan: *+${result.earnedGP.toLocaleString()} GP*\n` +
    `🃏 Aktif kart: *${result.activeCards}*\n` +
    `⚡ Saatlik üretim: *${result.gpPerHour} GP/saat*\n` +
    `⏱ Birikim süresi: *${result.hoursAccumulated} saat*\n\n` +
    `💼 Yeni bakiye: *${result.newBalance.toLocaleString()} GP*`
  );
}

// ── /paketler — Paket mağazası ───────────────────────────────
bot.command('paketler', handlePacks);
bot.hears('🎴 Paketler', handlePacks);

async function handlePacks(ctx) {
  const { user } = ctx.state;
  const gpStatus = await getGPStatus(user.id);

  const text =
    `🎴 *Paket Mağazası*\n\n` +
    `💰 Bakiyen: *${gpStatus.balance.toLocaleString()} GP*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🥉 *Bronze* — 2.400 GP / 0.3 TON\n` +
    `   5 kart, common ağırlıklı\n\n` +
    `🥈 *Silver* — 8.000 GP / 1 TON\n` +
    `   5 kart, rare garantili\n\n` +
    `🥇 *Gold* — 25.000 GP / 3 TON\n` +
    `   5 kart, epic garantili\n\n` +
    `💎 *Elite* — 70.000 GP / 8 TON\n` +
    `   5 kart, %20 legendary şansı\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Hangi paketi açmak istiyorsun?`;

  await ctx.replyWithMarkdown(text, packMenu(gpStatus.balance));
}

// Paket açma callback'leri
bot.action(/^open_(bronze|silver|gold|elite)_(gp|ton)$/, async (ctx) => {
  const [, tier, method] = ctx.match;
  const { user } = ctx.state;

  await ctx.answerCbQuery('Paket açılıyor...');

  try {
    const result = await openPack(user.id, tier, method);

    let text = `🎉 *${tier.toUpperCase()} Paket Açıldı!*\n\n`;

    for (const card of result.cards) {
      const rarityEmoji = { common: '⚪', rare: '🔵', epic: '🟣', legendary: '🟡' };
      text += `${rarityEmoji[card.rarity]} *${card.name}*\n`;
      text += `   ${card.nationality} | ${card.position} | OVR ${card.overall}\n`;
      text += `   ⚡ ${card.gpPerHour} GP/saat\n\n`;
    }

    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `✨ XP kazandın: *+${result.xpGained}*\n`;
    if (result.newLevel > user.level) {
      text += `🆙 *LEVEL ATLADI! → ${result.newLevel}*\n`;
    }
    text += `💰 GP bakiye: *${result.gpBalance.toLocaleString()}*`;

    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🎴 Tekrar Aç', `open_${tier}_gp`)],
        [Markup.button.callback('📦 Envanterim', 'inventory')],
        [Markup.button.callback('🏪 Pazaryeri', 'marketplace')],
      ])
    });

  } catch (err) {
    await ctx.answerCbQuery(`❌ ${err.message}`, { show_alert: true });
  }
});

// ── /envanter ────────────────────────────────────────────────
bot.command('envanter', handleInventory);
bot.hears('🃏 Envanter', handleInventory);
bot.action('inventory', handleInventory);

async function handleInventory(ctx) {
  const { user } = ctx.state;
  if (ctx.callbackQuery) await ctx.answerCbQuery();

  const { cards, total } = await getInventory(user.id, 1, 10);

  if (cards.length === 0) {
    await ctx.replyWithMarkdown(
      `📦 *Envanterin boş*\n\nHenüz hiç kartın yok. Paket açmak için /paketler komutunu kullan!`
    );
    return;
  }

  let text = `🃏 *Envanterin* (${total} kart toplam)\n\n`;

  for (const card of cards.slice(0, 10)) {
    const rarityEmoji = { common: '⚪', rare: '🔵', epic: '🟣', legendary: '🟡' };
    const activeEmoji = card.is_active_slot ? '⚡' : '  ';
    text += `${activeEmoji}${rarityEmoji[card.rarity]} ${card.name} — OVR ${card.overall}\n`;
    text += `   ${card.nationality} ${card.position} | ${card.gp_per_hour} GP/saat`;
    if (card.is_active_slot) text += ` | Slot ${card.slot_position}`;
    text += '\n';
  }

  if (total > 10) text += `\n_...ve ${total - 10} kart daha_`;

  await ctx.replyWithMarkdown(text, Markup.inlineKeyboard([
    [Markup.button.callback('⚡ Aktif Slotları Düzenle', 'manage_slots')],
    [Markup.button.callback('🏪 Kartı Listele', 'list_card')],
  ]));
}

// ── /profil ──────────────────────────────────────────────────
bot.command('profil', handleProfile);
bot.hears('👤 Profil', handleProfile);

async function handleProfile(ctx) {
  const { user } = ctx.state;
  const gpStatus = await getGPStatus(user.id);

  const { rows: [stats] } = await query(
    `SELECT 
      COUNT(uc.id) as total_cards,
      COUNT(CASE WHEN uc.is_active_slot THEN 1 END) as active_cards,
      COUNT(CASE WHEN ct.rarity = 'legendary' THEN 1 END) as legendary_count
     FROM user_cards uc
     JOIN card_templates ct ON ct.id = uc.template_id
     WHERE uc.user_id = $1`,
    [user.id]
  );

  const text =
    `👤 *Profil*\n\n` +
    `🏷 *${ctx.from.first_name}*\n` +
    `📊 Level: *${user.level}*\n` +
    `✨ XP: *${user.xp.toLocaleString()}*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 GP Bakiye: *${gpStatus.balance.toLocaleString()}*\n` +
    `⚡ Saatlik üretim: *${gpStatus.gpPerHour} GP/saat*\n` +
    `⏳ Bekleyen GP: *${gpStatus.pendingGP.toLocaleString()}*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🃏 Toplam kart: *${stats.total_cards}*\n` +
    `⚡ Aktif slotta: *${stats.active_cards}/${user.active_slots}*\n` +
    `🟡 Legendary: *${stats.legendary_count}*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🔥 Streak: *${user.login_streak} gün* (En uzun: ${user.longest_streak})\n` +
    `👥 Davet: *${user.referral_count} kişi*\n\n` +
    `📨 Davet linkin:\n` +
    `\`https://t.me/${process.env.BOT_USERNAME}?start=ref_${user.referral_code}\``;

  await ctx.replyWithMarkdown(text);
}

// ── /yardım ──────────────────────────────────────────────────
bot.command('yardim', async (ctx) => {
  await ctx.replyWithMarkdown(
    `❓ *Yardım*\n\n` +
    `*Temel Komutlar:*\n` +
    `/start — Ana menü\n` +
    `/topla — GP üretimini topla\n` +
    `/paketler — Paket mağazası\n` +
    `/envanter — Kartların\n` +
    `/koleksiyon — Koleksiyonun\n` +
    `/pazaryeri — Kart alım satım\n` +
    `/profil — İstatistiklerin\n` +
    `/gorevler — Günlük görevler\n\n` +
    `*Nasıl Çalışır?*\n` +
    `1. Paket aç → Kart kazan\n` +
    `2. Kartları aktif slota koy → GP üret\n` +
    `3. Her 1-3 saatte bir GP topla\n` +
    `4. GP ile yeni paket aç\n` +
    `5. Koleksiyonları tamamla → Ödül kazan\n` +
    `6. Fazla kartları pazarda TON'a sat\n\n` +
    `*Sorularınız için:* @footballverse_support`
  );
});

// ── KLAVYELER ────────────────────────────────────────────────

function mainMenu() {
  return Markup.keyboard([
    ['💰 GP Topla', '🎴 Paketler'],
    ['🃏 Envanter', '🏪 Pazaryeri'],
    ['📚 Koleksiyon', '📋 Görevler'],
    ['👤 Profil', '❓ Yardım'],
  ]).resize();
}

function packMenu(gpBalance) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🥉 Bronze (GP)', `open_bronze_gp`),
      Markup.button.callback('🥉 Bronze (TON)', `open_bronze_ton`),
    ],
    [
      Markup.button.callback('🥈 Silver (GP)', `open_silver_gp`),
      Markup.button.callback('🥈 Silver (TON)', `open_silver_ton`),
    ],
    [
      Markup.button.callback('🥇 Gold (GP)', `open_gold_gp`),
      Markup.button.callback('🥇 Gold (TON)', `open_gold_ton`),
    ],
    [
      Markup.button.callback('💎 Elite (GP)', `open_elite_gp`),
      Markup.button.callback('💎 Elite (TON)', `open_elite_ton`),
    ],
  ]);
}

// Pazar yeri komutlarını kaydet
registerMarketplaceCommands(bot);

// Koleksiyon komutlarını kaydet
registerCollectionCommands(bot);

// Görev komutlarını kaydet
registerTaskCommands(bot);

module.exports = bot;
