// src/bot/marketplace.bot.js
// Pazar yeri ve TON ödeme komutları — bot.js'e require edilir

const { Markup } = require('telegraf');
const { getListings, getListing, listCard, cancelListing, completePurchase, getUserListings, tonToNano } = require('../modules/marketplace/marketplace.service');
const { waitForPayment, createPaymentInstruction, generateMemo, verifyPayment } = require('../modules/ton/ton.service');
const { openPack } = require('../modules/packs/pack.service');

const PACK_TON_COSTS = {
  bronze: process.env.TON_PRICE_BRONZE || '300000000',
  silver: process.env.TON_PRICE_SILVER || '1000000000',
  gold:   process.env.TON_PRICE_GOLD   || '3000000000',
  elite:  process.env.TON_PRICE_ELITE  || '8000000000',
};

// Bu fonksiyon bot.js'de bot nesnesine bağlanır
function registerMarketplaceCommands(bot) {

  // ── /pazaryeri — Ana pazar listesi ──────────────────────────
  bot.command('pazaryeri', handleMarketplace);
  bot.hears('🏪 Pazaryeri', handleMarketplace);
  bot.action('marketplace', handleMarketplace);

  async function handleMarketplace(ctx) {
    if (ctx.callbackQuery) await ctx.answerCbQuery();

    const { listings, total } = await getListings({ sortBy: 'price_asc', limit: 10 });

    if (listings.length === 0) {
      await ctx.replyWithMarkdown(
        `🏪 *Pazaryeri*\n\nŞu an satışta kart yok.\nKartlarını satmak için /satiskoy komutunu kullan.`
      );
      return;
    }

    let text = `🏪 *Pazaryeri* (${total} kart)\n\n`;

    for (const l of listings.slice(0, 8)) {
      const rarityEmoji = { common: '⚪', rare: '🔵', epic: '🟣', legendary: '🟡' };
      text += `${rarityEmoji[l.rarity]} *${l.name}* — OVR ${l.overall}\n`;
      text += `   ${l.nationality} | ${l.position} | 💰 ${l.priceton} TON\n`;
      text += `   Satıcı: @${l.seller_username || 'anonim'}\n\n`;
    }

    if (total > 8) text += `_...ve ${total - 8} kart daha_\n`;

    await ctx.replyWithMarkdown(text, Markup.inlineKeyboard([
      [
        Markup.button.callback('⚪ Common', 'market_filter_common'),
        Markup.button.callback('🔵 Rare', 'market_filter_rare'),
        Markup.button.callback('🟣 Epic', 'market_filter_epic'),
        Markup.button.callback('🟡 Legendary', 'market_filter_legendary'),
      ],
      [
        Markup.button.callback('💰 Ucuzdan pahalıya', 'market_sort_price_asc'),
        Markup.button.callback('⭐ OVR\'a göre', 'market_sort_overall'),
      ],
      [Markup.button.callback('📋 Listelerim', 'my_listings')],
    ]));
  }

  // Filtre callback'leri
  bot.action(/^market_filter_(.+)$/, async (ctx) => {
    const rarity = ctx.match[1];
    await ctx.answerCbQuery();
    const { listings, total } = await getListings({ rarity, sortBy: 'overall_desc', limit: 10 });

    let text = `🏪 *${rarity.toUpperCase()} Kartlar* (${total})\n\n`;
    for (const l of listings) {
      const rarityEmoji = { common: '⚪', rare: '🔵', epic: '🟣', legendary: '🟡' };
      text += `${rarityEmoji[l.rarity]} *${l.name}* OVR ${l.overall} — ${l.priceton} TON\n`;
    }
    if (listings.length === 0) text += 'Bu kategoride kart yok.';

    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Geri', 'marketplace')],
      ])
    });
  });

  // ── /satiskoy — Kart listele ────────────────────────────────
  bot.command('satiskoy', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    // Kullanım: /satiskoy <kart_id> <fiyat_ton>
    if (args.length < 2) {
      await ctx.replyWithMarkdown(
        `📋 *Kart Listeleme*\n\n` +
        `Kullanım: \`/satiskoy <kart_id> <fiyat_ton>\`\n\n` +
        `Önce /envanter ile kart ID'lerini gör.\n` +
        `Örnek: \`/satiskoy abc123 2.5\``
      );
      return;
    }

    const [cardId, priceStr] = args;
    const { user } = ctx.state;

    try {
      const priceNano = tonToNano(priceStr);
      const result = await listCard(user.id, cardId, priceNano);

      await ctx.replyWithMarkdown(
        `✅ *Kart Listelendi!*\n\n` +
        `🃏 *${result.card.name}* — OVR ${result.card.overall}\n` +
        `💰 Fiyat: *${result.priceTon} TON*\n` +
        `📊 Platform komisyonu: ${result.platformFee} TON\n` +
        `💵 Kazanacaksın: *${result.sellerReceives} TON*\n` +
        `⏰ Süre: 7 gün\n\n` +
        `Liste ID: \`${result.listingId}\`\n` +
        `İptal için: /iptal ${result.listingId}`
      );
    } catch (err) {
      await ctx.replyWithMarkdown(`❌ *Hata:* ${err.message}`);
    }
  });

  // ── /satin — Kart satın al ──────────────────────────────────
  bot.command('satin', async (ctx) => {
    const listingId = ctx.message.text.split(' ')[1];
    if (!listingId) {
      await ctx.replyWithMarkdown('Kullanım: `/satin <listing_id>`');
      return;
    }

    const { user } = ctx.state;
    const listing = await getListing(listingId);

    if (!listing) {
      await ctx.replyWithMarkdown('❌ Liste bulunamadı veya süresi dolmuş.');
      return;
    }

    if (listing.seller_id === user.id) {
      await ctx.replyWithMarkdown('❌ Kendi kartınızı satın alamazsınız.');
      return;
    }

    // Ödeme talimatı oluştur
    const memo = generateMemo(user.id, 'BUY');
    const payment = createPaymentInstruction(listing.price_nano_ton, memo, `${listing.name} satın al`);

    // Session'a bekleyen işlemi kaydet
    ctx.session = ctx.session || {};
    ctx.session.pendingPurchase = { listingId, amountNano: listing.price_nano_ton, memo };

    await ctx.replyWithMarkdown(
      `🛒 *Satın Alma*\n\n` +
      `🃏 *${listing.name}* — OVR ${listing.overall}\n` +
      `${listing.nationality} | ${listing.position} | ${listing.rarity}\n\n` +
      payment.message,
      Markup.inlineKeyboard([
        [Markup.button.url('Phantom ile Öde', payment.deepLink)],
        [Markup.button.callback('✅ Ödedim, Onayla', `confirm_purchase_${listingId}`)],
        [Markup.button.callback('❌ İptal', 'cancel_payment')],
      ])
    );
  });

  // Satın alma onayı
  bot.action(/^confirm_purchase_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Ödeme doğrulanıyor...');
    const listingId = ctx.match[1];
    const { user } = ctx.state;

    const pending = ctx.session?.pendingPurchase;
    if (!pending || pending.listingId !== listingId) {
      await ctx.reply('❌ Bekleyen işlem bulunamadı. /satin ile tekrar başlayın.');
      return;
    }

    await ctx.editMessageText('⏳ TON ağında ödeme aranıyor... (max 2 dakika)');

    const result = await waitForPayment(pending.amountNano, pending.memo, 120_000);

    if (!result.found) {
      await ctx.editMessageText(
        `❌ *Ödeme bulunamadı*\n\n${result.reason}\n\nMemo'yu doğru yazdığından emin ol ve tekrar dene.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    try {
      const purchase = await completePurchase(user.id, listingId, result.txHash);
      ctx.session.pendingPurchase = null;

      await ctx.editMessageText(
        `🎉 *Satın Alma Başarılı!*\n\n` +
        `🃏 *${purchase.card.name}* envanterine eklendi!\n` +
        `OVR ${purchase.card.overall} | ${purchase.card.nationality} | ${purchase.card.position}\n\n` +
        `💰 Ödenen: *${purchase.priceTon} TON*\n` +
        `✅ TX: \`${result.txHash}\``,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📦 Envantere Git', 'inventory')],
          ])
        }
      );
    } catch (err) {
      await ctx.editMessageText(`❌ *Hata:* ${err.message}`, { parse_mode: 'Markdown' });
    }
  });

  // ── TON ile paket al ─────────────────────────────────────────
  bot.action(/^open_(bronze|silver|gold|elite)_ton$/, async (ctx) => {
    await ctx.answerCbQuery();
    const tier = ctx.match[1];
    const { user } = ctx.state;

    const amountNano = PACK_TON_COSTS[tier];
    const memo = generateMemo(user.id, `PKG-${tier.toUpperCase()}`);
    const payment = createPaymentInstruction(amountNano, memo, `${tier} paket`);

    ctx.session = ctx.session || {};
    ctx.session.pendingPack = { tier, amountNano, memo };

    await ctx.editMessageText(payment.message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.url('TON Wallet ile Öde', payment.deepLink)],
        [Markup.button.callback('✅ Ödedim, Paketi Aç', `confirm_pack_${tier}`)],
        [Markup.button.callback('❌ İptal', 'cancel_payment')],
      ])
    });
  });

  // Paket TON ödeme onayı
  bot.action(/^confirm_pack_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Ödeme doğrulanıyor...');
    const tier = ctx.match[1];
    const { user } = ctx.state;

    const pending = ctx.session?.pendingPack;
    if (!pending) {
      await ctx.reply('❌ Bekleyen işlem yok.');
      return;
    }

    await ctx.editMessageText('⏳ Ödeme bekleniyor...');

    const result = await waitForPayment(pending.amountNano, pending.memo, 120_000);

    if (!result.found) {
      await ctx.editMessageText(`❌ Ödeme bulunamadı: ${result.reason}`, { parse_mode: 'Markdown' });
      return;
    }

    try {
      const packResult = await openPack(user.id, tier, 'ton', result.txHash);
      ctx.session.pendingPack = null;

      let text = `🎉 *${tier.toUpperCase()} Paket Açıldı!*\n\n`;
      for (const card of packResult.cards) {
        const e = { common: '⚪', rare: '🔵', epic: '🟣', legendary: '🟡' };
        text += `${e[card.rarity]} *${card.name}* — OVR ${card.overall}\n`;
        text += `   ${card.nationality} | ${card.position} | ⚡${card.gpPerHour} GP/saat\n\n`;
      }
      text += `✨ XP: +${packResult.xpGained} | Level: ${packResult.newLevel}`;

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📦 Envanterim', 'inventory')],
        ])
      });
    } catch (err) {
      await ctx.editMessageText(`❌ ${err.message}`, { parse_mode: 'Markdown' });
    }
  });

  // ── /iptal — Liste iptal ─────────────────────────────────────
  bot.command('iptal', async (ctx) => {
    const listingId = ctx.message.text.split(' ')[1];
    if (!listingId) {
      const listings = await getUserListings(ctx.state.user.id);
      if (listings.length === 0) {
        await ctx.replyWithMarkdown('Aktif listen yok.');
        return;
      }
      let text = `📋 *Aktif Listelerim*\n\n`;
      listings.forEach(l => {
        text += `• *${l.name}* — ${l.priceTon} TON\n  ID: \`${l.id}\`\n`;
      });
      text += `\nİptal için: \`/iptal <id>\``;
      await ctx.replyWithMarkdown(text);
      return;
    }

    try {
      await cancelListing(ctx.state.user.id, listingId);
      await ctx.replyWithMarkdown('✅ Liste iptal edildi, kart envanterine döndü.');
    } catch (err) {
      await ctx.replyWithMarkdown(`❌ ${err.message}`);
    }
  });

  bot.action('cancel_payment', async (ctx) => {
    await ctx.answerCbQuery('İptal edildi');
    ctx.session = {};
    await ctx.editMessageText('❌ İşlem iptal edildi.');
  });

  bot.action('my_listings', async (ctx) => {
    await ctx.answerCbQuery();
    const listings = await getUserListings(ctx.state.user.id);
    if (listings.length === 0) {
      await ctx.editMessageText('📋 Aktif listen yok.', {
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Geri', 'marketplace')]])
      });
      return;
    }
    let text = `📋 *Listelerim*\n\n`;
    listings.forEach(l => {
      text += `🃏 *${l.name}* OVR ${l.overall} — ${l.priceTon} TON\n`;
      text += `   ID: \`${l.id}\`\n\n`;
    });
    text += `İptal: \`/iptal <id>\``;
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Geri', 'marketplace')]])
    });
  });
}

module.exports = { registerMarketplaceCommands };
