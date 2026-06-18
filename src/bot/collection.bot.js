// src/bot/collection.bot.js
// Koleksiyon ve aktif slot komutları

const { Markup } = require('telegraf');
const {
  getCollections, getCollectionDetail,
  stickCard, claimCollectionReward, getActiveSlots,
} = require('../modules/collections/collection.service');
const { setActiveSlot, getInventory } = require('../modules/packs/pack.service');

function registerCollectionCommands(bot) {

  // ── /koleksiyon — Tüm koleksiyonlar ─────────────────────────
  bot.command('koleksiyon', handleCollections);
  bot.hears('📚 Koleksiyon', handleCollections);

  async function handleCollections(ctx) {
    const { user } = ctx.state;
    const collections = await getCollections(user.id);

    if (collections.length === 0) {
      await ctx.replyWithMarkdown('📚 Henüz aktif koleksiyon yok.');
      return;
    }

    let text = `📚 *Koleksiyonlar*\n\n`;

    for (const c of collections) {
      const doneEmoji = c.is_completed ? '✅' : '🔄';
      text += `${doneEmoji} *${c.name}*\n`;
      text += `   ${c.progressBar} (${c.owned_count}/${c.total_cards})\n`;
      if (c.reward_gp > 0) text += `   🎁 Ödül: ${c.reward_gp.toLocaleString()} GP`;
      if (c.reward_pack_tier) text += ` + ${c.reward_pack_tier} paket`;
      text += '\n\n';
    }

    const buttons = collections.map(c =>
      [Markup.button.callback(
        `${c.is_completed ? '✅' : '📖'} ${c.name}`,
        `col_detail_${c.id}`
      )]
    );
    buttons.push([Markup.button.callback('⚡ Aktif Slotlarım', 'active_slots')]);

    await ctx.replyWithMarkdown(text, Markup.inlineKeyboard(buttons));
  }

  // ── Koleksiyon detayı ────────────────────────────────────────
  bot.action(/^col_detail_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const collectionId = ctx.match[1];
    const { user } = ctx.state;

    const detail = await getCollectionDetail(user.id, collectionId);
    if (!detail) {
      await ctx.reply('Koleksiyon bulunamadı.');
      return;
    }

    let text = `📖 *${detail.name}*\n`;
    if (detail.description) text += `_${detail.description}_\n`;
    text += `\n${detail.progressBar} (${detail.owned_count}/${detail.total_cards})\n\n`;

    // Kartları listele
    const owned   = detail.cards.filter(c => c.user_card_id);
    const missing = detail.cards.filter(c => !c.user_card_id);

    if (owned.length > 0) {
      text += `*Albümünüzdekiler (${owned.length}):*\n`;
      for (const c of owned) {
        const e = { common: '⚪', rare: '🔵', epic: '🟣', legendary: '🟡' };
        text += `${e[c.rarity]} ${c.name} — OVR ${c.overall}\n`;
      }
      text += '\n';
    }

    if (missing.length > 0) {
      text += `*Eksik kartlar (${missing.length}):*\n`;
      for (const c of missing.slice(0, 8)) {
        const e = { common: '⚪', rare: '🔵', epic: '🟣', legendary: '🟡' };
        text += `${e[c.rarity]} ${c.name} — OVR ${c.overall}\n`;
      }
      if (missing.length > 8) text += `_...ve ${missing.length - 8} kart daha_\n`;
    }

    // Ödül bilgisi
    text += `\n🎁 Tamamlama ödülü: `;
    if (detail.reward_gp > 0) text += `${detail.reward_gp.toLocaleString()} GP`;
    if (detail.reward_pack_tier) text += ` + ${detail.reward_pack_tier} paket`;

    const buttons = [];
    if (detail.is_completed && !detail.reward_claimed) {
      buttons.push([Markup.button.callback('🎁 Ödülü Al!', `claim_reward_${collectionId}`)]);
    }
    buttons.push([Markup.button.callback('📌 Kart Yapıştır', `stick_menu_${collectionId}`)]);
    buttons.push([Markup.button.callback('⬅️ Geri', 'back_collections')]);

    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  });

  // ── Ödül alma ────────────────────────────────────────────────
  bot.action(/^claim_reward_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Ödül alınıyor...');
    const { user } = ctx.state;

    try {
      const result = await claimCollectionReward(user.id, ctx.match[1]);

      let text = `🎉 *Koleksiyon Tamamlandı!*\n\n`;
      text += `📚 *${result.collectionName}*\n\n`;
      if (result.gpRewarded > 0) text += `💰 GP Ödülü: *+${result.gpRewarded.toLocaleString()}*\n`;
      if (result.packRewarded) text += `🎴 Paket: *${result.packRewarded}*\n`;
      text += `✨ XP Bonus: *+${result.xpBonus}*`;

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📚 Koleksiyonlara Dön', 'back_collections')],
        ]),
      });
    } catch (err) {
      await ctx.answerCbQuery(`❌ ${err.message}`, { show_alert: true });
    }
  });

  // ── Kart yapıştırma menüsü ───────────────────────────────────
  bot.action(/^stick_menu_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const collectionId = ctx.match[1];
    const { user } = ctx.state;

    // Kullanıcının envanterinde bu koleksiyona ait, albüme girmemiş kartlar
    const { rows: eligible } = await require('../database/db').query(
      `SELECT uc.id, ct.name, ct.overall, ct.rarity, ct.nationality, ct.position
       FROM user_cards uc
       JOIN card_templates ct ON ct.id = uc.template_id
       WHERE uc.user_id = $1
         AND ct.collection_id = $2
         AND uc.is_in_album = FALSE
         AND uc.is_listed = FALSE
       ORDER BY ct.overall DESC`,
      [user.id, collectionId]
    );

    if (eligible.length === 0) {
      await ctx.answerCbQuery(
        'Bu koleksiyona yapıştırabilecek kartın yok!', { show_alert: true }
      );
      return;
    }

    let text = `📌 *Albüme Yapıştır*\n\nHangi kartı yapıştırmak istiyorsun?\n\n`;
    const buttons = eligible.slice(0, 10).map(c => {
      const e = { common: '⚪', rare: '🔵', epic: '🟣', legendary: '🟡' };
      return [Markup.button.callback(
        `${e[c.rarity]} ${c.name} OVR${c.overall}`,
        `do_stick_${c.id}`
      )];
    });
    buttons.push([Markup.button.callback('⬅️ Geri', `col_detail_${collectionId}`)]);

    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  });

  // Yapıştır işlemi
  bot.action(/^do_stick_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Yapıştırılıyor...');
    const { user } = ctx.state;

    try {
      const result = await stickCard(user.id, ctx.match[1]);

      let text =
        `📌 *Kart Albüme Eklendi!*\n\n` +
        `🃏 *${result.card.name}*\n` +
        `OVR ${result.card.overall} | ${result.card.nationality} | ${result.card.position}\n\n` +
        `📊 Koleksiyon: ${result.owned}/${result.total}\n` +
        `✨ XP: +${result.xpGained}\n`;

      if (result.collectionCompleted) {
        text += `\n🎉 *KOLEKSİYON TAMAMLANDI! Ödülünü almayı unutma!*`;
      }

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          result.collectionCompleted
            ? [Markup.button.callback('🎁 Ödülü Al!', `claim_reward_${result.collectionId}`)]
            : [Markup.button.callback('📌 Devam Et', `stick_menu_${result.collectionId}`)],
          [Markup.button.callback('📚 Koleksiyonlar', 'back_collections')],
        ]),
      });
    } catch (err) {
      await ctx.answerCbQuery(`❌ ${err.message}`, { show_alert: true });
    }
  });

  // ── Aktif slotlar ────────────────────────────────────────────
  bot.action('active_slots', handleActiveSlots);
  bot.command('slotlar', handleActiveSlots);

  async function handleActiveSlots(ctx) {
    if (ctx.callbackQuery) await ctx.answerCbQuery();
    const { user } = ctx.state;

    const slotInfo = await getActiveSlots(user.id);

    let text =
      `⚡ *Aktif Slotlar* (${slotInfo.usedSlots}/${slotInfo.maxSlots})\n` +
      `💰 Saatlik üretim: *${slotInfo.totalGpPerHour} GP/saat*\n` +
      `📅 Günlük tahmini: *${slotInfo.dailyEstimate.toLocaleString()} GP*\n\n`;

    if (slotInfo.slots.length === 0) {
      text += `Slotlarında kart yok!\n/envanter ile kart ekle.`;
    } else {
      for (const s of slotInfo.slots) {
        const e = { common: '⚪', rare: '🔵', epic: '🟣', legendary: '🟡' };
        text += `Slot ${s.slot_position}: ${e[s.rarity]} *${s.name}* OVR${s.overall} ⚡${s.gp_per_hour}/saat\n`;
      }
    }

    await ctx.replyWithMarkdown(text, Markup.inlineKeyboard([
      [Markup.button.callback('➕ Slota Kart Ekle', 'add_to_slot')],
      [Markup.button.callback('➖ Kartı Slottan Çıkar', 'remove_from_slot')],
    ]));
  }

  // Slota kart ekle
  bot.action('add_to_slot', async (ctx) => {
    await ctx.answerCbQuery();
    const { user } = ctx.state;

    const slotInfo = await getActiveSlots(user.id);
    if (slotInfo.usedSlots >= slotInfo.maxSlots) {
      await ctx.answerCbQuery(
        `Tüm slotlar dolu! (${slotInfo.maxSlots}/${slotInfo.maxSlots})`,
        { show_alert: true }
      );
      return;
    }

    // Slotta olmayan kartları getir
    const { rows: available } = await require('../database/db').query(
      `SELECT uc.id, ct.name, ct.overall, ct.rarity, ct.gp_per_hour
       FROM user_cards uc
       JOIN card_templates ct ON ct.id = uc.template_id
       WHERE uc.user_id = $1
         AND uc.is_active_slot = FALSE
         AND uc.is_listed = FALSE
       ORDER BY ct.overall DESC
       LIMIT 15`,
      [user.id]
    );

    if (available.length === 0) {
      await ctx.answerCbQuery('Slota eklenebilecek kartın yok.', { show_alert: true });
      return;
    }

    // Boş slot bul
    const usedPositions = new Set(slotInfo.slots.map(s => s.slot_position));
    let nextSlot = 1;
    while (usedPositions.has(nextSlot)) nextSlot++;

    const buttons = available.map(c => {
      const e = { common: '⚪', rare: '🔵', epic: '🟣', legendary: '🟡' };
      return [Markup.button.callback(
        `${e[c.rarity]} ${c.name} OVR${c.overall} ⚡${c.gp_per_hour}/s`,
        `slot_add_${c.id}_${nextSlot}`
      )];
    });

    await ctx.editMessageText(
      `➕ *Slota Ekle* (Slot ${nextSlot})\n\nHangi kartı slota koymak istiyorsun?`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
    );
  });

  bot.action(/^slot_add_(.+)_(\d+)$/, async (ctx) => {
    const [, cardId, slotStr] = ctx.match;
    const slot = parseInt(slotStr);
    const { user } = ctx.state;

    try {
      await setActiveSlot(user.id, cardId, slot);
      await ctx.answerCbQuery(`✅ Kart slot ${slot}'a eklendi!`);
      await handleActiveSlots(ctx);
    } catch (err) {
      await ctx.answerCbQuery(`❌ ${err.message}`, { show_alert: true });
    }
  });

  // Slottan çıkar
  bot.action('remove_from_slot', async (ctx) => {
    await ctx.answerCbQuery();
    const { user } = ctx.state;
    const slotInfo = await getActiveSlots(user.id);

    if (slotInfo.slots.length === 0) {
      await ctx.answerCbQuery('Slotlarında kart yok.', { show_alert: true });
      return;
    }

    const buttons = slotInfo.slots.map(s => {
      const e = { common: '⚪', rare: '🔵', epic: '🟣', legendary: '🟡' };
      return [Markup.button.callback(
        `${e[s.rarity]} Slot ${s.slot_position}: ${s.name}`,
        `slot_remove_${s.id}`
      )];
    });

    await ctx.editMessageText(
      `➖ *Slottan Çıkar*\n\nHangi kartı slottan çıkarmak istiyorsun?`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
    );
  });

  bot.action(/^slot_remove_(.+)$/, async (ctx) => {
    const cardId = ctx.match[1];
    const { user } = ctx.state;

    await require('../database/db').query(
      `UPDATE user_cards SET is_active_slot = FALSE, slot_position = NULL WHERE id = $1 AND user_id = $2`,
      [cardId, user.id]
    );

    await ctx.answerCbQuery('✅ Kart slottan çıkarıldı.');
    await handleActiveSlots(ctx);
  });

  // Geri butonu
  bot.action('back_collections', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage();
    const fakeCtx = { ...ctx, replyWithMarkdown: ctx.replyWithMarkdown.bind(ctx) };
    await handleCollections(fakeCtx);
  });
}

module.exports = { registerCollectionCommands };
