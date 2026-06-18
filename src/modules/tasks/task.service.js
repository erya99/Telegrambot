// src/modules/tasks/task.service.js
// Görev sistemi — günlük/haftalık görevler, ilerleme, ödüller

const { query, withTransaction } = require('../../database/db');

// ── KULLANICININ GÖREVLERİ ───────────────────────────────────

async function getUserTasks(userId) {
  const today = new Date().toISOString().split('T')[0];

  const { rows } = await query(
    `SELECT
       t.id, t.title, t.description, t.type,
       t.reward_gp, t.reward_pack_tier,
       t.condition_type, t.condition_value,
       COALESCE(ut.progress, 0) as progress,
       COALESCE(ut.completed, FALSE) as completed,
       COALESCE(ut.claimed, FALSE) as claimed,
       ut.completed_at
     FROM tasks t
     LEFT JOIN user_tasks ut
       ON ut.task_id = t.id
       AND ut.user_id = $1
       AND (t.type != 'daily' OR ut.reset_at = $2)
     WHERE t.is_active = TRUE
     ORDER BY
       CASE t.type WHEN 'daily' THEN 1 WHEN 'weekly' THEN 2 ELSE 3 END,
       ut.completed ASC`,
    [userId, today]
  );

  return rows.map(t => ({
    ...t,
    percent: t.condition_value > 0
      ? Math.min(100, Math.floor((t.progress / t.condition_value) * 100))
      : 0,
    progressBar: makeTaskBar(t.progress, t.condition_value),
    canClaim: t.completed && !t.claimed,
  }));
}

// ── ÖDÜL AL ──────────────────────────────────────────────────

async function claimTaskReward(userId, taskId) {
  return withTransaction(async (client) => {
    const today = new Date().toISOString().split('T')[0];

    const { rows: [task] } = await client.query(
      `SELECT t.*, ut.completed, ut.claimed, ut.id as ut_id
       FROM tasks t
       LEFT JOIN user_tasks ut
         ON ut.task_id = t.id
         AND ut.user_id = $1
         AND (t.type != 'daily' OR ut.reset_at = $2)
       WHERE t.id = $3`,
      [userId, today, taskId]
    );

    if (!task) throw new Error('Görev bulunamadı');
    if (!task.completed) throw new Error('Görev henüz tamamlanmadı');
    if (task.claimed) throw new Error('Bu görevin ödülü zaten alındı');

    // GP ödülü
    if (task.reward_gp > 0) {
      await client.query(
        `SELECT update_gp($1, $2, 'gp_task', $3, $4)`,
        [userId, task.reward_gp, taskId, `"${task.title}" görevi ödülü`]
      );
    }

    // Paket ödülü
    if (task.reward_pack_tier) {
      await client.query(
        `INSERT INTO pack_opens (user_id, tier, paid_with, card_count)
         VALUES ($1, $2, 'free', 5)`,
        [userId, task.reward_pack_tier]
      );
    }

    // XP
    const xpGain = 20;
    await client.query(
      `UPDATE users SET xp = xp + $1, level = calc_level(xp + $1) WHERE id = $2`,
      [xpGain, userId]
    );

    // Claimed işaretle
    await client.query(
      `UPDATE user_tasks SET claimed = TRUE WHERE id = $1`,
      [task.ut_id]
    );

    return {
      success: true,
      taskTitle:   task.title,
      gpRewarded:  task.reward_gp,
      packRewarded: task.reward_pack_tier,
      xpGained:    xpGain,
    };
  });
}

// ── İSTATİSTİK ───────────────────────────────────────────────

async function getTaskStats(userId) {
  const today = new Date().toISOString().split('T')[0];

  const { rows: [stats] } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE t.type = 'daily') as daily_total,
       COUNT(*) FILTER (WHERE t.type = 'daily' AND ut.completed = TRUE AND ut.reset_at = $2) as daily_done,
       COUNT(*) FILTER (WHERE t.type = 'one_time' AND ut.completed = TRUE) as one_time_done,
       COUNT(*) FILTER (WHERE ut.completed = TRUE AND ut.claimed = FALSE) as unclaimed
     FROM tasks t
     LEFT JOIN user_tasks ut ON ut.task_id = t.id AND ut.user_id = $1
     WHERE t.is_active = TRUE`,
    [userId, today]
  );

  return stats;
}

// ── YARDIMCI ────────────────────────────────────────────────

function makeTaskBar(progress, total) {
  if (!total) return '';
  const pct    = Math.min(100, Math.floor((progress / total) * 100));
  const filled = Math.floor(pct / 20); // 5 blok
  const empty  = 5 - filled;
  return `${'▰'.repeat(filled)}${'▱'.repeat(empty)} ${progress}/${total}`;
}

module.exports = { getUserTasks, claimTaskReward, getTaskStats };
