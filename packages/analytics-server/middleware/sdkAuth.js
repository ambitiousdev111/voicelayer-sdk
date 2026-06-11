// ─────────────────────────────────────────────────────────────────────────────
// SDK Auth middleware — VoiceLayer API key validation
//
// Developers receive a personal API key (vl-xxx) from voicelayer.dev.
// They pass it as:  Authorization: Bearer vl-xxx
//
// Server validates against VOICELAYER_API_KEYS env var (comma-separated list).
// This allows multiple keys: per-developer, per-app, revokable individually.
//
// Dev mode: set VOICELAYER_DEV_MODE=true to skip auth (local dev only).
// ─────────────────────────────────────────────────────────────────────────────

function requireSdkAuth(req, res, next) {
  // Skip auth in explicit dev mode
  if (process.env.VOICELAYER_DEV_MODE === 'true') {
    return next()
  }

  // Load valid keys from env (comma-separated, trimmed)
  const rawKeys = process.env.VOICELAYER_API_KEYS || process.env.SDK_API_KEY || ''
  const validKeys = rawKeys
    .split(',')
    .map(k => k.trim())
    .filter(Boolean)

  if (validKeys.length === 0) {
    // No keys configured at all → open dev mode (warn loudly)
    console.warn('[sdkAuth] No VOICELAYER_API_KEYS set — running in open mode. Set keys in production!')
    return next()
  }

  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Missing Authorization header',
      hint:  'Add  Authorization: Bearer vl-your-key  or get a key at voicelayer.dev',
    })
  }

  const provided = header.slice(7).trim()
  if (!validKeys.includes(provided)) {
    console.warn(`[sdkAuth] Rejected key: ${provided.slice(0, 8)}…`)
    return res.status(401).json({
      error: 'Invalid VoiceLayer API key',
      hint:  'Get a valid key at voicelayer.dev',
    })
  }

  // Attach key identifier for logging/analytics
  req.vlApiKey = provided
  next()
}

module.exports = { requireSdkAuth }
