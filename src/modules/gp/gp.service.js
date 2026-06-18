// src/modules/gp/gp.service.js
// GP toplama, günlük bonus, streak sistemi

const { query, withTransaction } = require('../../database/db');

const COLLECTION_INTERVAL_HOURS = parseInt(process.env.GP_COLLECTION_INTERVAL_HOURS || '3');
const MAX_ACCUMULATION_HOURS = parseInt(process.env.GP_MAX_ACCUMULATION_HOURS || '12');

// ── GP TOPLAMA (3 saatlik üretim) ───────────────────────────

async function collectGP(userId) {
  return withTransaction(async (client) => {
    // Kullanıcı ve aktif kartları kilitle
    const { rows: [user] } = await client.query(
      `SELECT u.*, 
        EXTRACT(EPOCH FROM (NOW() - u.last_collection_at)) / 3600 AS hours_since_collect
       FROM users u WHERE u.id = $1 FOR UPDATE`,
      [userId]
    );

    if (!user) throw new Error('Kullanıcı bulunamadı');

    const hoursSince = parseFloat(user.hours_since_collect || MAX_ACCUMULATION_HOURS);

    // Min 1 saat geçmeli
    if (hoursSince < 1 && user.last_collection_at !== null) {
      const nextCollect = new Date(user.last_collection_at);
      nextCollect.setHours(nextCollect.getHours() + 1);
      return {
        success: false,
        nextCollectAt: nextCollect,
        message: 'Henüz toplanacak GP yok'
      };
    }

    // Kaç saatlik üretim birikmiş? (max 12 saat)
    const effectiveHours = Math.min(hoursSince, MAX_ACCUMULATION_HOURS);

    // Aktif slottaki kartların GP üretimini hesapla
    const { rows: activeCards } = await client.query(
      `SELECT ct.overall, ct.gp_per_hour
       FROM user_cards uc
       JOIN card_templates ct ON ct.id = uc.template_id
       WHERE uc.user_id = $1 AND uc.is_active_slot = TRUE`,
      [userId]
    );

    if (activeCards.length === 0) {
      return {
        success: false,
        message: 'Aktif slotunda kart yok. Koleksiyonundan kart seç!'
      };
    }

    const totalGpPerHour = activeCards.reduce((sum, c) => sum + c.gp_per_hour, 0);
    const earnedGP = Math.floor(totalGpPerHour * effectiveHours);

    if (earnedGP <= 0) {
      return { success: false, message: 'Toplanacak GP yok' };
    }

    // GP ekle
    const { rows: [{ update_gp: newBalance }] } = await client.query(
      `SELECT update_gp($1, $2, 'gp_collection', NULL, $3)`,
      [userId, earnedGP, `${activeCards.length} kart × ${effectiveHours.toFixed(1)} saat`]
    );

    // Son toplama zamanını güncelle
    await client.query(
      `UPDATE users SET last_collection_at = NOW() WHERE id = $1`,
      [userId]
    );

    // Görev ilerlemesini güncelle
    await updateTaskProgress(client, userId, 'collect_gp', 1);

    return {
      success: true,
      earnedGP,
      newBalance,
      activeCards: activeCards.length,
      gpPerHour: totalGpPerHour,
      hoursAccumulated: effectiveHours.toFixed(1),
    };
  });
}

// ── GÜNLÜK GİRİŞ & STREAK ───────────────────────────────────

async function processDailyLogin(userId) {
  return withTransaction(async (client) => {
    const { rows: [user] } = await client.query(
      `SELECT id, login_streak, longest_streak, last_login_date, gp_balance
       FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );

    const today = new Date().toISOString().split('T')[0];
    const lastLogin = user.last_login_date;

    // PostgreSQL DATE tipini güvenli karşılaştır
    const lastLoginStr = lastLogin
      ? (lastLogin instanceof Date
          ? lastLogin.toISOString().split('T')[0]
          : String(lastLogin).split('T')[0])
      : null;

    // Bugün zaten giriş yaptıysa atla
    if (lastLoginStr === today) {
      return { alreadyLoggedIn: true };
    }

    // Streak hesapla
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    let newStreak;
    if (!lastLoginStr || lastLoginStr !== yesterdayStr) {
      newStreak = 1;
    } else {
      newStreak = user.login_streak + 1;
    }

    const longestStreak = Math.max(newStreak, user.longest_streak);

    // Streak ödülünü bul
    const { rows: [reward] } = await client.query(
      `SELECT reward_gp, reward_pack FROM streak_rewards
       WHERE streak_day <= $1 ORDER BY streak_day DESC LIMIT 1`,
      [newStreak]
    );

    const baseBonus = parseInt(process.env.GP_DAILY_LOGIN_BASE || '500');
    const streakBonus = reward ? parseInt(reward.reward_gp) : baseBonus;
    const totalGP = streakBonus;

    // Kullanıcıyı güncelle
    await client.query(
      `UPDATE users SET
        login_streak = $1,
        longest_streak = $2,
        last_login_date = $3,
        xp = xp + 10,
        level = calc_level(xp + 10),
        updated_at = NOW()
       WHERE id = $4`,
      [newStreak, longestStreak, today, userId]
    );

    // GP ekle
    const { rows: [{ update_gp: newBalance }] } = await client.query(
      `SELECT update_gp($1, $2, 'gp_daily_bonus', NULL, $3)`,
      [userId, totalGP, `${newStreak}. gün streak bonusu`]
    );

    // Streak paketle ödül var mı?
    let packReward = null;
    if (reward?.reward_pack) {
      packReward = reward.reward_pack;
      // Bedava paket hakkı ekle (pack service'te kullanılacak)
      await client.query(
        `INSERT INTO pack_opens (user_id, tier, paid_with, card_count)
         VALUES ($1, $2, 'free', 5)
         RETURNING id`,
        [userId, reward.reward_pack]
      );
    }

    return {
      alreadyLoggedIn: false,
      newStreak,
      longestStreak,
      gpEarned: totalGP,
      newBalance,
      packReward,
      isStreakMilestone: [7, 14, 21, 30].includes(newStreak),
    };
  });
}

// ── KULLANILABİLİR GP DURUMU ────────────────────────────────

async function getGPStatus(userId) {
  const { rows: [data] } = await query(
    `SELECT 
      u.gp_balance,
      u.last_collection_at,
      u.login_streak,
      u.last_login_date,
      COALESCE(SUM(ct.gp_per_hour), 0) as total_gp_per_hour,
      COUNT(uc.id) as active_card_count,
      EXTRACT(EPOCH FROM (NOW() - u.last_collection_at)) / 3600 as hours_since
     FROM users u
     LEFT JOIN user_cards uc ON uc.user_id = u.id AND uc.is_active_slot = TRUE
     LEFT JOIN card_templates ct ON ct.id = uc.template_id
     WHERE u.id = $1
     GROUP BY u.id`,
    [userId]
  );

  if (!data) return null;

  const hoursSince = Math.min(
    parseFloat(data.hours_since || 0),
    MAX_ACCUMULATION_HOURS
  );
  const pendingGP = Math.floor(data.total_gp_per_hour * hoursSince);

  // Sonraki toplama zamanı
  let nextCollectAt = null;
  if (data.last_collection_at) {
    nextCollectAt = new Date(data.last_collection_at);
    nextCollectAt.setHours(nextCollectAt.getHours() + 1);
  }

  // Max birikime ne kadar kaldı?
  const maxGP = Math.floor(data.total_gp_per_hour * MAX_ACCUMULATION_HOURS);
  const fillPercent = maxGP > 0 ? Math.min(100, Math.floor((pendingGP / maxGP) * 100)) : 0;

  return {
    balance: parseInt(data.gp_balance),
    pendingGP,
    gpPerHour: parseInt(data.total_gp_per_hour),
    activeCards: parseInt(data.active_card_count),
    hoursSince: hoursSince.toFixed(1),
    nextCollectAt,
    maxGP,
    fillPercent,
    loginStreak: parseInt(data.login_streak),
    canCollect: hoursSince >= 1 || !data.last_collection_at,
  };
}

// ── REFERANS BONUSU ──────────────────────────────────────────

async function processReferral(newUserId, referralCode) {
  return withTransaction(async (client) => {
    // Referans sahibini bul
    const { rows: [referrer] } = await client.query(
      `SELECT id FROM users WHERE referral_code = $1 AND id != $2`,
      [referralCode, newUserId]
    );

    if (!referrer) return { success: false };

    // Referans zaten kullanılmış mı?
    const { rows: [newUser] } = await client.query(
      `SELECT referred_by FROM users WHERE id = $1`,
      [newUserId]
    );

    if (newUser.referred_by) return { success: false, reason: 'already_used' };

    const referrerReward = parseInt(process.env.GP_REFERRAL_REWARD || '3000');
    const friendReward = parseInt(process.env.GP_REFERRAL_FRIEND_REWARD || '1000');

    // Davet eden kişiye bonus
    await client.query(
      `SELECT update_gp($1, $2, 'gp_referral', $3, 'Referans bonusu')`,
      [referrer.id, referrerReward, newUserId]
    );

    // Yeni kullanıcıya hoş geldin bonusu
    await client.query(
      `SELECT update_gp($1, $2, 'gp_referral', $3, 'Davet edilme bonusu')`,
      [newUserId, friendReward, referrer.id]
    );

    // Kullanıcı kaydını güncelle
    await client.query(
      `UPDATE users SET
        referred_by = $1
       WHERE id = $2`,
      [referrer.id, newUserId]
    );

    // Referrer'ın sayacını artır
    await client.query(
      `UPDATE users SET referral_count = referral_count + 1 WHERE id = $1`,
      [referrer.id]
    );

    // Görev ilerlemesi
    await updateTaskProgress(client, referrer.id, 'invite_friend', 1);

    return { success: true, referrerReward, friendReward };
  });
}

// ── GÖREV İLERLEMESİ ────────────────────────────────────────

async function updateTaskProgress(client, userId, conditionType, increment) {
  const db = client || { query: (t, p) => query(t, p) };
  const today = new Date().toISOString().split('T')[0];

  await db.query(
    `INSERT INTO user_tasks (user_id, task_id, progress, reset_at)
     SELECT $1, t.id, $2, 
       CASE WHEN t.type = 'daily' THEN $3::date ELSE NULL END
     FROM tasks t
     WHERE t.condition_type = $4 AND t.is_active = TRUE
     ON CONFLICT (user_id, task_id, reset_at) DO UPDATE
       SET progress = user_tasks.progress + $2,
           completed = (user_tasks.progress + $2 >= (
             SELECT condition_value FROM tasks WHERE id = user_tasks.task_id
           )),
           completed_at = CASE
             WHEN user_tasks.progress + $2 >= (
               SELECT condition_value FROM tasks WHERE id = user_tasks.task_id
             ) AND user_tasks.completed = FALSE THEN NOW()
             ELSE user_tasks.completed_at
           END`,
    [userId, increment, today, conditionType]
  );
}

module.exports = { collectGP, processDailyLogin, getGPStatus, processReferral, updateTaskProgress };
