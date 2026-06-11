// Public endpoint — SDK POSTs here. No auth required (keys are checked on the SDK side).
const express    = require('express')
const { insertMany } = require('../db')

const router = express.Router()
const MAX    = 1_000   // max events per batch

// ── In-memory token-bucket rate limiter ───────────────────────────────────────
// 60 requests / minute per IP. No external dependency needed.
const WINDOW_MS  = 60_000
const MAX_RPM    = 60
const ipBuckets  = new Map()   // ip → { count, resetAt }

function rateLimited(ip) {
  const now    = Date.now()
  let   bucket = ipBuckets.get(ip)

  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 1, resetAt: now + WINDOW_MS }
    ipBuckets.set(ip, bucket)
    return false
  }
  bucket.count++
  return bucket.count > MAX_RPM
}

// Prune stale buckets every 5 minutes to prevent unbounded growth
setInterval(() => {
  const now = Date.now()
  for (const [ip, bucket] of ipBuckets) {
    if (now > bucket.resetAt) ipBuckets.delete(ip)
  }
}, 5 * 60_000)

// ── Route ─────────────────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown'

  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded — 60 requests/min per IP' })
  }

  try {
    const { events } = req.body ?? {}

    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'events must be a non-empty array' })
    }
    if (events.length > MAX) {
      return res.status(400).json({ error: `Max ${MAX} events per batch` })
    }

    // Validate minimal shape — drop garbage silently
    const valid = events.filter(e =>
      e &&
      typeof e.id      === 'string' && e.id.length > 0 &&
      typeof e.appId   === 'string' && e.appId.length > 0 &&
      typeof e.ts      === 'number' &&
      typeof e.type    === 'string'
    )

    const inserted = insertMany(valid)
    res.json({ received: valid.length, inserted, dropped: events.length - valid.length })
  } catch (err) {
    console.error('[events] insert error:', err.message)
    res.status(500).json({ error: 'Storage error' })
  }
})

module.exports = router
