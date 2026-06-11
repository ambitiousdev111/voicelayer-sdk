// ─────────────────────────────────────────────────────────────────────────────
// VoiceLayer API Proxy
//
// Forwards SDK requests to Anthropic / OpenAI so API keys never touch
// the browser. All routes require a valid JWT (founder or app token).
//
// Routes mirror the upstream API paths so the SDK can set:
//   anthropicProxyUrl = "https://yourserver.com/proxy/anthropic"
//   openaiProxyUrl    = "https://yourserver.com/proxy/openai"
// and the SDK's internal fetch calls just append /v1/messages etc. as usual.
//
// Endpoints:
//   POST /proxy/anthropic/v1/messages              → Anthropic Claude
//   POST /proxy/openai/v1/chat/completions         → OpenAI Chat
//   POST /proxy/openai/v1/audio/transcriptions     → OpenAI Whisper
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config()
const express  = require('express')
const { Readable } = require('stream')
const { requireSdkAuth } = require('../middleware/sdkAuth')

const router = express.Router()

// ── Auth: SDK API key (set SDK_API_KEY in .env) ──────────────────────────────
router.use(requireSdkAuth)

// ── Helper: forward a JSON body, piping the response stream through ───────────
//
// Pipes rather than buffers so SSE streaming responses (stream: true) reach
// the browser in real-time. Works identically for non-streaming responses.
async function forwardJSON(targetUrl, headers, body, res) {
  try {
    const upstream = await fetch(targetUrl, {
      method:  'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body:    JSON.stringify(body),
    })

    res.status(upstream.status)
      .set('content-type', upstream.headers.get('content-type') || 'application/json')

    if (!upstream.body) {
      return res.end()
    }

    // Convert the Web ReadableStream to a Node.js Readable and pipe to response.
    // Requires Node 18+ (Readable.fromWeb is stable since Node 18.0.0).
    const nodeStream = Readable.fromWeb(upstream.body)
    await new Promise((resolve, reject) => {
      nodeStream.on('error', reject)
      nodeStream.on('end',   resolve)
      nodeStream.pipe(res, { end: true })
    })
  } catch (err) {
    console.error('[proxy] upstream error:', err.message)
    // Only send error JSON if headers haven't been flushed yet
    if (!res.headersSent) {
      res.status(502).json({ error: 'Upstream request failed', detail: err.message })
    }
  }
}

// ── POST /proxy/anthropic/v1/messages ────────────────────────────────────────
router.post('/anthropic/v1/messages', async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in .env' })

  await forwardJSON(
    'https://api.anthropic.com/v1/messages',
    {
      'x-api-key':         key,
      'anthropic-version': '2023-06-01',
    },
    req.body,
    res,
  )
})

// ── POST /proxy/openai/v1/chat/completions ────────────────────────────────────
router.post('/openai/v1/chat/completions', async (req, res) => {
  const key = process.env.OPENAI_API_KEY
  if (!key) return res.status(500).json({ error: 'OPENAI_API_KEY not set in .env' })

  await forwardJSON(
    'https://api.openai.com/v1/chat/completions',
    { Authorization: `Bearer ${key}` },
    req.body,
    res,
  )
})

// ── POST /proxy/openai/v1/audio/transcriptions ───────────────────────────────
// Whisper uses multipart/form-data, so we stream the body through directly.
router.post('/openai/v1/audio/transcriptions', async (req, res) => {
  const key = process.env.OPENAI_API_KEY
  if (!key) return res.status(500).json({ error: 'OPENAI_API_KEY not set in .env' })

  try {
    // Re-forward the raw multipart body using the same content-type header
    const contentType = req.headers['content-type']
    if (!contentType?.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'Expected multipart/form-data' })
    }

    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const rawBody = Buffer.concat(chunks)

    const upstream = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${key}`,
        'content-type': contentType,  // preserves multipart boundary
      },
      body: rawBody,
    })

    const text = await upstream.text()
    res.status(upstream.status)
      .set('content-type', upstream.headers.get('content-type') || 'application/json')
      .send(text)
  } catch (err) {
    console.error('[proxy/whisper] error:', err.message)
    res.status(502).json({ error: 'Whisper proxy failed', detail: err.message })
  }
})

module.exports = router
