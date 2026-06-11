// ─────────────────────────────────────────────────────────────────────────────
// POST /api/voice
//
// The intelligence layer for React Native (and web) voice commands.
//
// Request body:
//   transcript           string      — what the user said
//   audio?               string      — base64 WAV/m4a if on-device STT didn't run
//   audioFormat?         string      — 'wav' | 'm4a'
//   routes               array       — [{ name, container, paramKeys[] }]
//   currentScreen?       string      — screen the user is on right now
//   currentScreenParams? object      — params of the current route
//   screenHints?         string[]    — from useVoiceLayerScreen (optional)
//   screenElements?      string[]    — visible elements from useVoiceLayerScreen
//   recentScreens?       string[]    — navigation history, newest last
//   conversationHistory? array       — [{ role, content }] prior turns
//   appId?               string
//   language?            string      — 'hi' | 'en' | 'auto'
//
// Response:
//   { route: { name, container } | null, params: {}, speak, confidence, transcript }
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express')
const { requireSdkAuth } = require('../middleware/sdkAuth')

const router = express.Router()
router.use(requireSdkAuth)

// ── System prompt ──────────────────────────────────────────────────────────
const SYSTEM = `You are VoiceLayer, an AI voice navigation assistant embedded in a mobile app.
Map the user's voice command to the best available screen and extract any required parameters.

RULES:
1. Output ONLY valid JSON — no markdown, no explanation, no code fences.
2. Pick exactly one screen from the available list using its exact "name".
3. Return "route": null if nothing matches with confidence > 0.55.
4. For "__back__": use when user says "wapas", "back", "pichle screen pe", "go back", etc.
5. "speak" must be in the SAME language the user spoke. Hindi → Hindi. Hinglish → Hinglish. English → English.
6. Keep "speak" to 1 short sentence confirming the action.
7. If a screen accepts params (listed as [params: ...]) and the user provides values, extract them into "params".
8. Use conversation history to resolve pronouns: "unhe", "wahi", "woh", "that", "it", "them".
9. Use current screen context to disambiguate: "add karo" on ShopsScreen → CreateNewShopScreen.

OUTPUT FORMAT (strict JSON):
{
  "route": { "name": "ExactScreenName", "container": "ContainerNameOrNull" },
  "params": {},
  "speak": "Short response in user's language",
  "confidence": 0.0-1.0
}

To go back:
{ "route": { "name": "__back__", "container": null }, "params": {}, "speak": "...", "confidence": 0.98 }

If nothing matches:
{ "route": null, "params": {}, "speak": "Samajh nahi aaya, kya aap dobara bol sakte hain?", "confidence": 0 }`

// ── Build context block for the current user message ──────────────────────
function buildContextBlock({
  routes,
  currentScreen,
  currentScreenParams,
  screenHints,
  screenElements,
  recentScreens,
  language,
}) {
  const lines = []

  // Language
  lines.push(`Language: ${language || 'hi'}`)

  // Current screen with a ← marker so Claude knows where the user is
  if (currentScreen) {
    const params = currentScreenParams && Object.keys(currentScreenParams).length > 0
      ? ` (params: ${JSON.stringify(currentScreenParams)})`
      : ''
    lines.push(`Current screen: ${currentScreen}${params}  ← user is here`)
  }

  // Recent navigation (enables "wapas jaao" and pronoun resolution)
  if (recentScreens?.length > 1) {
    // Show path up to but not including current (it's already stated above)
    const path = recentScreens.slice(0, -1).join(' → ')
    lines.push(`Navigation path: ${path} → ${currentScreen || '?'}`)
  }

  // Available screens
  lines.push('\nAvailable screens:')
  for (const r of routes) {
    let line = r.container
      ? `  - ${r.name} (inside ${r.container})`
      : `  - ${r.name}`
    if (r.paramKeys?.length > 0) {
      line += `  [params: ${r.paramKeys.join(', ')}]`
    }
    lines.push(line)
  }
  lines.push('  - __back__  [go to previous screen]')

  // Optional: screen-level hints from useVoiceLayerScreen
  if (screenHints?.length > 0) {
    lines.push(`\nWhat you can do on ${currentScreen || 'this screen'}: ${screenHints.join(', ')}`)
  }

  // Optional: visible elements
  if (screenElements?.length > 0) {
    lines.push(`Visible elements: ${screenElements.join(', ')}`)
  }

  return lines.join('\n')
}

// ── Helper: call Whisper for audio → transcript ────────────────────────────
async function transcribeAudio(audioBase64, format, language) {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not set')

  const audioBuffer = Buffer.from(audioBase64, 'base64')
  const { FormData, Blob } = await import('node-fetch').catch(() => ({
    FormData: globalThis.FormData,
    Blob:     globalThis.Blob,
  }))

  const form = new FormData()
  form.append('file', new Blob([audioBuffer], { type: `audio/${format}` }), `audio.${format}`)
  form.append('model',           'whisper-1')
  form.append('language',        language === 'auto' ? 'hi' : language)
  form.append('response_format', 'json')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method:  'POST',
    headers: { Authorization: `Bearer ${key}` },
    body:    form,
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Whisper error ${res.status}: ${err.slice(0, 100)}`)
  }

  return (await res.json()).text ?? ''
}

// ── Helper: call Claude with multi-turn context ────────────────────────────
async function resolveIntent(transcript, contextBlock, conversationHistory) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY not set')

  // Build the messages array.
  // Prior turns give Claude pronoun/reference resolution across commands.
  // The current turn always contains the full fresh context block.
  const messages = []

  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    for (const turn of conversationHistory) {
      if (turn.role && turn.content) {
        messages.push({ role: turn.role, content: String(turn.content) })
      }
    }
  }

  // Current turn: context block + user's utterance
  messages.push({
    role:    'user',
    content: `${contextBlock}\n\nUser said: "${transcript}"`,
  })

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'content-type':      'application/json',
      'x-api-key':         key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 256,
      stream:     true,
      system:     SYSTEM,
      messages,
    }),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Claude error ${res.status}: ${err.slice(0, 100)}`)
  }

  return consumeStream(res.body)
}

// ── SSE stream consumer — exits early once JSON object is complete ─────────
async function consumeStream(body) {
  const reader      = body.getReader()
  const decoder     = new TextDecoder()
  let lineBuffer     = ''
  let accumulated    = ''
  let depth = 0, inString = false, escape = false, started = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      lineBuffer += decoder.decode(value, { stream: true })
      const lines = lineBuffer.split('\n')
      lineBuffer  = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (raw === '[DONE]') return accumulated.trim()

        let evt
        try { evt = JSON.parse(raw) } catch { continue }
        if (evt.type !== 'content_block_delta' || evt.delta?.type !== 'text_delta') continue

        const text = evt.delta.text
        accumulated += text

        for (const ch of text) {
          if (escape)               { escape = false; continue }
          if (ch === '\\' && inString) { escape = true;  continue }
          if (ch === '"')           { inString = !inString; continue }
          if (inString)             continue
          if (ch === '{')           { depth++; started = true }
          else if (ch === '}')      { depth-- }
        }

        if (started && depth === 0) {
          reader.releaseLock()
          body.cancel().catch(() => undefined)
          return accumulated.trim()
        }
      }
    }
  } finally {
    try { reader.releaseLock() } catch { /* already released */ }
  }

  return accumulated.trim()
}

// ── POST /api/voice ────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const {
    transcript: incomingTranscript,
    audio,
    audioFormat          = 'wav',
    routes               = [],
    currentScreen        = null,
    currentScreenParams  = {},
    screenHints          = [],
    screenElements       = [],
    recentScreens        = [],
    conversationHistory  = [],
    appId,
    language             = 'hi',
  } = req.body ?? {}

  if (!incomingTranscript && !audio) {
    return res.status(400).json({ error: 'Provide either transcript or audio' })
  }
  if (!Array.isArray(routes) || routes.length === 0) {
    return res.status(400).json({ error: 'routes must be a non-empty array' })
  }

  let transcript = incomingTranscript

  try {
    // Step 1: STT if raw audio provided
    if (!transcript && audio) {
      transcript = await transcribeAudio(audio, audioFormat, language)
      console.log(`[voice] STT: "${transcript}"  appId=${appId}`)
    }

    // Step 2: Build context block
    const contextBlock = buildContextBlock({
      routes,
      currentScreen,
      currentScreenParams,
      screenHints,
      screenElements,
      recentScreens,
      language,
    })

    console.log(`[voice] "${transcript}"  screen=${currentScreen}  routes=${routes.length}  history=${conversationHistory.length}`)

    // Step 3: Resolve intent via Claude (multi-turn)
    const rawJson = await resolveIntent(transcript, contextBlock, conversationHistory)
    console.log(`[voice] Claude → ${rawJson}`)

    // Strip markdown fences Claude occasionally adds
    const cleanJson = rawJson
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```\s*$/m, '')
      .trim()

    let result
    try {
      result = JSON.parse(cleanJson)
    } catch {
      result = {
        route:      null,
        params:     {},
        speak:      'Samajh nahi aaya, kya aap dobara bol sakte hain?',
        confidence: 0,
      }
    }

    res.json({
      route:      result.route      ?? null,
      params:     result.params     ?? {},
      speak:      result.speak      ?? '',
      confidence: result.confidence ?? 0,
      transcript,
    })
  } catch (err) {
    console.error('[voice] error:', err.message)
    res.status(502).json({ error: 'Voice resolution failed', detail: err.message })
  }
})

module.exports = router
