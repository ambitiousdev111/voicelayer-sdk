// ─────────────────────────────────────────────────────────────────────────────
// VoiceLayer VariantGenerator
//
// After a successful agent-loop resolution, asks Claude to generate transcript
// variants in Hindi / English / Hinglish and bulk-inserts them into the
// LearningStore. This is always async and fire-and-forget — it never blocks
// the user's response.
//
// Example:
//   Resolved: "subscription khatam ho gaya hai wale customers dikhao"
//             → click #inactive-tab on /customers
//
//   Generated variants:
//     "inactive customers dikhao"
//     "jo customers ka subscription expire ho gaya"
//     "subscription lapse ho gaye users"
//     "churned customers", "expired users", ...
// ─────────────────────────────────────────────────────────────────────────────

import type { LearningStore, StoredStep } from './LearningStore.js'

export interface VariantGeneratorOptions {
  anthropicKey?: string
  openaiKey?:    string
  anthropicBase: string
  openaiBase:    string
  model?:        string
}

export class VariantGenerator {
  private readonly model: string

  private readonly useOpenAI: boolean

  constructor(private readonly opts: VariantGeneratorOptions) {
    this.useOpenAI = !opts.anthropicKey && !!opts.openaiKey
    this.model = opts.model ?? (this.useOpenAI ? 'gpt-4o-mini' : 'claude-haiku-4-5-20251001')
  }

  /**
   * Fire-and-forget: generate variants and seed the LearningStore.
   * Call after speaking the response — never await this.
   */
  seedAsync(
    originalTranscript: string,
    steps:              StoredStep[],
    speak:              string,
    startRoute:         string,
    confidence:         number,
    store:              LearningStore,
  ): void {
    this.generate(originalTranscript, startRoute)
      .then((variants) => {
        store.bulkStore(variants, steps, speak, startRoute, confidence)
      })
      .catch(() => {
        // Variant generation is best-effort — silently ignore errors
      })
  }

  // ── Private ────────────────────────────────────────────────────────────

  private async generate(transcript: string, route: string): Promise<string[]> {
    const system = `You are a multilingual NLP assistant. Your job is to generate transcript variants for voice commands in Hindi, English, and Hinglish (Hindi-English mix).

RULES:
1. Output ONLY a valid JSON array of strings — no explanation, no markdown.
2. Generate exactly 12 variants.
3. Each variant must convey the SAME intent as the original but phrased differently.
4. Cover all three registers: pure Hindi, pure English, and Hinglish mix.
5. Vary length: some short (3-4 words), some long (8-10 words).
6. Include natural spoken variations: with/without subject pronouns, different verb forms.
7. NEVER change the core subject noun (subscription ≠ meal plan ≠ order). Keep the specific entity.
8. Do NOT include the original transcript itself in the output.

OUTPUT FORMAT: ["variant 1", "variant 2", ...]`

    const user = `Original voice command: "${transcript}"\nPage route: ${route}\n\nGenerate 12 variants:`

    const raw = this.useOpenAI
      ? await this.callOpenAI(system, user)
      : await this.callAnthropic(system, user)

    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 3)
      }
    } catch { /* malformed — fail silently */ }
    return []
  }

  private async callAnthropic(system: string, user: string): Promise<string> {
    const headers: Record<string, string> = {
      'content-type':      'application/json',
      'x-api-key':         this.opts.anthropicKey!,
      'anthropic-version': '2023-06-01',
    }
    if (this.opts.anthropicBase === 'https://api.anthropic.com') {
      headers['anthropic-dangerous-allow-browser'] = 'true'
    }
    const res = await fetch(`${this.opts.anthropicBase}/v1/messages`, {
      method: 'POST', headers,
      body: JSON.stringify({ model: this.model, max_tokens: 512, system, messages: [{ role: 'user', content: user }] }),
    })
    if (!res.ok) return '[]'
    const data = (await res.json()) as { content: Array<{ type: string; text: string }> }
    return data.content.find((c) => c.type === 'text')?.text ?? '[]'
  }

  private async callOpenAI(system: string, user: string): Promise<string> {
    const res = await fetch(`${this.opts.openaiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${this.opts.openaiKey}` },
      body: JSON.stringify({
        model: this.model, max_tokens: 512,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    })
    if (!res.ok) return '[]'
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> }
    return data.choices[0]?.message?.content ?? '[]'
  }
}
