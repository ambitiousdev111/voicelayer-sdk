// ─────────────────────────────────────────────────────────────────────────────
// VoiceLayer RN — /api/voice server client
//
// Called only on cache MISS. Sends the transcript (on-device STT already done)
// or raw audio (if on-device STT not ready yet) to the VoiceLayer server.
//
// Server resolves intent via Claude, returns { actionId, params, speak }.
// ─────────────────────────────────────────────────────────────────────────────

import type { VLAction, VoiceResult } from './types'

export interface VoiceApiOptions {
  proxyUrl: string
  appId: string
  screenName?: string
  language?: string
  apiKey?: string
}

function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

/**
 * Resolve a transcript to an action via the VoiceLayer server.
 * Used when the LearningStore doesn't have a match.
 */
export async function resolveViaServer(
  transcript: string,
  actions: VLAction[],
  opts: VoiceApiOptions,
): Promise<VoiceResult> {
  const { proxyUrl, appId, screenName, language } = opts

  const res = await fetch(`${proxyUrl}/api/voice`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(opts.apiKey) },
    body: JSON.stringify({
      transcript,
      appId,
      screenName: screenName ?? 'unknown',
      language:   language   ?? 'hi',
      actions: actions.map((a) => ({
        id:          a.id,
        description: a.description,
        params:      a.params ?? [],
      })),
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`VoiceLayer server error ${res.status}: ${body.slice(0, 100)}`)
  }

  return res.json() as Promise<VoiceResult>
}

/**
 * Send raw audio to the server for STT + intent resolution in one call.
 * Used when on-device Whisper isn't loaded yet (first launch).
 */
export async function resolveViaServerWithAudio(
  audioBase64: string,
  audioFormat: 'wav' | 'm4a' | 'webm',
  actions: VLAction[],
  opts: VoiceApiOptions,
): Promise<VoiceResult & { transcript: string }> {
  const { proxyUrl, appId, screenName, language } = opts

  const res = await fetch(`${proxyUrl}/api/voice`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(opts.apiKey) },
    body: JSON.stringify({
      audio:       audioBase64,
      audioFormat,
      appId,
      screenName:  screenName ?? 'unknown',
      language:    language   ?? 'hi',
      actions: actions.map((a) => ({
        id:          a.id,
        description: a.description,
        params:      a.params ?? [],
      })),
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`VoiceLayer server error ${res.status}: ${body.slice(0, 100)}`)
  }

  return res.json() as Promise<VoiceResult & { transcript: string }>
}
