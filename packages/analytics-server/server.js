// ─────────────────────────────────────────────────────────────────────────────
// VoiceLayer Analytics Server
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config()

const express = require('express')
const cors    = require('cors')
const path    = require('path')

const eventsRouter   = require('./routes/events')
const appsRouter     = require('./routes/apps')
const authRouter     = require('./routes/auth')
const proxyRouter    = require('./routes/proxy')
const voiceRouter    = require('./routes/voice')
const waitlistRouter = require('./routes/waitlist')

const app  = express()
const PORT = process.env.PORT || 3001

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json({ limit: '2mb' }))

// CORS — SDK routes are reachable from any origin (mobile apps, browsers, emulators)
const openCors = cors({
  origin:  '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
})
app.use('/api/voice',    openCors)
app.use('/api/waitlist', openCors)
app.use('/api/events',   openCors)
app.use('/proxy',        openCors)
// Dashboard API — also open for simplicity (auth is via JWT)
app.use('/api', cors({ origin: (origin, cb) => cb(null, true) }))

// ── API Routes ────────────────────────────────────────────────────────────────

app.use('/api/events', eventsRouter)
app.use('/api/apps',   appsRouter)
app.use('/api/auth',   authRouter)
app.use('/api/voice',    voiceRouter)
app.use('/api/waitlist', waitlistRouter)
app.use('/proxy',      proxyRouter)

// ── Founder Dashboard (static HTML) ──────────────────────────────────────────

app.use('/assets', express.static(path.join(__dirname, 'public')))

app.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'))
})

// ── Landing page ──────────────────────────────────────────────────────────────

const LANDING_DIR = path.join(__dirname, '..', '..', 'landing')
app.use('/landing', express.static(LANDING_DIR))
app.get('/landing', (_req, res) => res.sendFile(path.join(LANDING_DIR, 'index.html')))

app.get('/', (_req, res) => res.redirect('/landing'))

// ── Health check (for deployment platforms) ───────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }))

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  const devMode = process.env.VOICELAYER_DEV_MODE === 'true'
  const keyCount = (process.env.VOICELAYER_API_KEYS || '').split(',').filter(Boolean).length

  console.log(`\n🎙  VoiceLayer Server`)
  console.log(`   Voice API → POST http://localhost:${PORT}/api/voice`)
  console.log(`   Dashboard → http://localhost:${PORT}/dashboard`)
  console.log(`   Landing   → http://localhost:${PORT}/landing`)
  console.log(`   Auth mode → ${devMode ? 'DEV (open)' : `${keyCount} API key(s) active`}`)
  if (devMode) console.warn('   ⚠  VOICELAYER_DEV_MODE=true — do not use in production')
  console.log()
})
