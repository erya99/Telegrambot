// src/bot/tasks.bot.js
// Görev komutları

const { Markup } = require('telegraf');
const { getUserTasks, claimTaskReward, getTaskStats } = require('../modules/tasks/task.service');

function registerTaskCommands(bot) {

  bot.command('gorevler', handleTasks);
  bot.hears('📋 Görevler', handleTasks);

  async function handleTasks(ctx) {
    const { user } = ctx.state;
    const [tasks, stats] = await Promise.all([
      getUserTasks(user.id),
      getTaskStats(user.id),
    ]);

    const daily    = tasks.filter(t => t.type === 'daily');
    const weekly   = tasks.filter(t => t.type === 'weekly');
    const oneTime  = tasks.filter(t => t.type === 'one_time');

    let text = `📋 *Görevler*\n`;
    text += `${stats.daily_done}/${stats.daily_total} günlük tamamlandı`;
    if (stats.unclaimed > 0) text += ` • ⚠️ ${stats.unclaimed} alınmamış ödül`;
    text += `\n\n`;

    if (daily.length > 0) {
      text += `*📅 Günlük*\n`;
      for (const t of daily) {
        text += formatTask(t);
      }
      text += '\n';
    }

    if (weekly.length > 0) {
      text += `*📆 Haftalık*\n`;
      for (const t of weekly) {
        text += formatTask(t);
      }
      text += '\n';
    }

    if (oneTime.length > 0) {
      text += `*⭐ Özel*\n`;
      for (const t of oneTime) {
        if (!t.claimed) text += formatTask(t);
      }
    }

    // Alınacak ödülü olan görevler için buton
    const claimable = tasks.filter(t => t.canClaim);
    const buttons = claimable.map(t =>
      [Markup.button.callback(
        `🎁 "${t.title}" ödülünü al`,
        `claim_task_${t.id}`
      )]
    );

    if (buttons.length === 0) {
      buttons.push([Markup.button.callback('🔄 Yenile', 'refresh_tasks')]);
    }

    await ctx.replyWithMarkdown(text, Markup.inlineKeyboard(buttons));
  }

  // Görev ödülü alma
  bot.action(/^claim_task_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Ödül alınıyor...');
    const { user } = ctx.state;

    try {
      const result = await claimTaskReward(user.id, ctx.match[1]);

      let text = `🎉 *Görev Ödülü Alındı!*\n\n📋 *${result.taskTitle}*\n\n`;
      if (result.gpRewarded > 0)  text += `💰 GP: *+${result.gpRewarded.toLocaleString()}*\n`;
      if (result.packRewarded)    text += `🎴 Paket: *${result.packRewarded}*\n`;
      text += `✨ XP: *+${result.xpGained}*`;

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📋 Görevlere Dön', 'refresh_tasks')],
        ]),
      });
    } catch (err) {
      await ctx.answerCbQuery(`❌ ${err.message}`, { show_alert: true });
    }
  });

  bot.action('refresh_tasks', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
    await handleTasks(ctx);
  });
}

// ── YARDIMCI ────────────────────────────────────────────────

function formatTask(t) {
  const statusEmoji = t.claimed ? '✅' : t.completed ? '🎁' : '🔲';
  let line = `${statusEmoji} *${t.title}*\n`;

  if (!t.completed) {
    line += `   ${t.progressBar}\n`;
  }

  const rewards = [];
  if (t.reward_gp > 0)     rewards.push(`${t.reward_gp.toLocaleString()} GP`);
  if (t.reward_pack_tier)  rewards.push(`${t.reward_pack_tier} paket`);
  if (rewards.length > 0)  line += `   🎁 ${rewards.join(' + ')}\n`;

  return line;
}

module.exports = { registerTaskCommands };
