const express = require('express')
const router  = express.Router()
const { getDb } = require('../db')

// ── Ensure table exists ────────────────────────────────────────────────────
function ensureTable() {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      email     TEXT    NOT NULL UNIQUE,
      name      TEXT,
      company   TEXT,
      platform  TEXT,           -- 'web' | 'rn' | 'both'
      createdAt TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

// ── POST /api/waitlist ─────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { email, name, company, platform } = req.body ?? {}

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' })
  }

  try {
    ensureTable()
    const db = getDb()
    db.prepare(
      `INSERT OR IGNORE INTO waitlist (email, name, company, platform) VALUES (?, ?, ?, ?)`
    ).run(email.toLowerCase().trim(), name ?? null, company ?? null, platform ?? null)

    console.log(`[waitlist] +1  ${email}`)
    res.json({ ok: true, message: "You're on the list! We'll reach out soon." })
  } catch (err) {
    console.error('[waitlist] error:', err.message)
    res.status(500).json({ error: 'Could not save signup' })
  }
})

// ── GET /api/waitlist  (founder only — simple token check) ─────────────────
router.get('/', (req, res) => {
  const pwd = process.env.FOUNDER_PASSWORD
  if (pwd && req.headers['x-founder-password'] !== pwd) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    ensureTable()
    const db   = getDb()
    const rows = db.prepare(`SELECT * FROM waitlist ORDER BY createdAt DESC`).all()
    res.json({ count: rows.length, signups: rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
