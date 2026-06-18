// src/api/server.js
// Mini App için Express API server

const express = require('express')
const cors = require('cors')
const { query } = require('../database/db')
const { collectGP, getGPStatus, processDailyLogin } = require('../modules/gp/gp.service')
const { openPack, getInventory } = require('../modules/packs/pack.service')
const { getCollections } = require('../modules/collections/collection.service')
const { getUserTasks } = require('../modules/tasks/task.service')
const { getListings } = require('../modules/marketplace/marketplace.service')

const app = express()

// ── MIDDLEWARE ───────────────────────────────────────────────

app.use(cors({
  origin: ['http://localhost:5173', 'https://*.ngrok.io', 'https://*.ngrok-free.app'],
  credentials: true,
}))
app.use(express.json())

// Telegram initData doğrulama middleware
async function authMiddleware(req, res, next) {
  try {
    // initData header'dan al
    const initData = req.headers['x-telegram-init-data']

    let telegramId

    if (initData && initData !== '') {
      // Production: gerçek Telegram initData'yı parse et
      const params = new URLSearchParams(initData)
      const userStr = params.get('user')
      if (userStr) {
        const user = JSON.parse(decodeURIComponent(userStr))
        telegramId = user.id
      }
    }

    // Geliştirme modunda test kullanıcısı
    if (!telegramId && process.env.NODE_ENV !== 'production') {
      telegramId = parseInt(req.headers['x-test-telegram-id'] || '12345')
    }

    if (!telegramId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Kullanıcıyı bul veya oluştur
    let { rows: [user] } = await query(
      `SELECT * FROM users WHERE telegram_id = $1`, [telegramId]
    )

    if (!user) {
      const { rows: [newUser] } = await query(
        `INSERT INTO users (telegram_id, first_name)
         VALUES ($1, $2)
         ON CONFLICT (telegram_id) DO UPDATE SET updated_at = NOW()
         RETURNING *`,
        [telegramId, 'Mini App User']
      )
      user = newUser
    }

    req.user = user
    next()
  } catch (err) {
    console.error('Auth error:', err)
    res.status(401).json({ error: 'Auth failed' })
  }
}

// ── AUTH ─────────────────────────────────────────────────────

app.post('/auth/telegram-login', authMiddleware, async (req, res) => {
  const { user } = req
  await processDailyLogin(user.id).catch(() => {})
  res.json({ success: true, data: { id: user.id, level: user.level, gpBalance: user.gp_balance } })
})

// ── USER ─────────────────────────────────────────────────────

app.get('/user/profile', authMiddleware, async (req, res) => {
  try {
    const { rows: [profile] } = await query(
      `SELECT u.*,
        COUNT(uc.id) as total_cards
       FROM users u
       LEFT JOIN user_cards uc ON uc.user_id = u.id
       WHERE u.id = $1
       GROUP BY u.id`,
      [req.user.id]
    )
    res.json({ success: true, data: profile })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/user/gp-status', authMiddleware, async (req, res) => {
  try {
    const status = await getGPStatus(req.user.id)
    res.json({ success: true, data: status })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GP ───────────────────────────────────────────────────────

app.post('/gp/collect', authMiddleware, async (req, res) => {
  try {
    const result = await collectGP(req.user.id)
    res.json({ success: result.success, data: result })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// ── PACKS ────────────────────────────────────────────────────

app.post('/packs/open', authMiddleware, async (req, res) => {
  try {
    const { tier, method } = req.body
    const result = await openPack(req.user.id, tier, method)
    res.json({ success: true, data: result })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.get('/packs/daily-status', authMiddleware, async (req, res) => {
  try {
    const status = await getGPStatus(req.user.id)
    res.json({ success: true, data: status })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── CARDS ────────────────────────────────────────────────────

app.get('/cards/inventory', authMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const result = await getInventory(req.user.id, page)
    res.json({ success: true, data: result })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/cards/slot', authMiddleware, async (req, res) => {
  try {
    const { cardId, slot } = req.body
    const { setActiveSlot } = require('../modules/packs/pack.service')
    const result = await setActiveSlot(req.user.id, cardId, slot)
    res.json({ success: true, data: result })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// ── COLLECTIONS ──────────────────────────────────────────────

app.get('/collections', authMiddleware, async (req, res) => {
  try {
    const cols = await getCollections(req.user.id)
    res.json({ success: true, data: cols })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── TASKS ────────────────────────────────────────────────────

app.get('/tasks', authMiddleware, async (req, res) => {
  try {
    const tasks = await getUserTasks(req.user.id)
    res.json({ success: true, data: tasks })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── MARKETPLACE ──────────────────────────────────────────────

app.get('/marketplace', authMiddleware, async (req, res) => {
  try {
    const result = await getListings(req.query)
    res.json({ success: true, data: result })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── HEALTH CHECK ─────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

module.exports = app
