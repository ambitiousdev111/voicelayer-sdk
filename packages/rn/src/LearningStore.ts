// ─────────────────────────────────────────────────────────────────────────────
// VoiceLayer RN — LearningStore
//
// Persists resolved voice commands in AsyncStorage (→ UserDefaults on iOS,
// SharedPreferences on Android). Uses the same Levenshtein fuzzy matching
// as the web SDK so learned commands survive app restarts.
//
// Fast path:  findMatch()  — fully in-memory, synchronous after hydration
// Slow path:  store()      — writes to AsyncStorage in the background
// ─────────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage'
import type { StoredCommand, VoiceResult } from './types'

const MATCH_THRESHOLD = 0.20   // max edit distance as fraction of transcript length
const SAME_SCREEN_BONUS = 0.04 // tighten threshold if on the same screen
const MAX_ENTRIES = 300
const DECAY_DAYS  = 60

export class LearningStore {
  private cache: StoredCommand[] = []
  private readonly key: string
  private readonly readyPromise: Promise<void>

  constructor(appId: string) {
    this.key = `vl_learning_rn_${appId}`
    this.readyPromise = this.hydrate()
  }

  /** Wait for AsyncStorage hydration before first use. */
  ready(): Promise<void> {
    return this.readyPromise
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Synchronous after ready() resolves.
   * Returns the best matching stored command, or null if none passes the
   * similarity threshold.
   */
  findMatch(transcript: string, screenName?: string): StoredCommand | null {
    const normalised = LearningStore.normalise(transcript)
    let best: { cmd: StoredCommand; dist: number } | null = null

    for (const cmd of this.cache) {
      const threshold = Math.floor(
        normalised.length * (MATCH_THRESHOLD - (screenName ? SAME_SCREEN_BONUS : 0)),
      )
      const dist = LearningStore.levenshtein(normalised, cmd.transcript)
      if (dist <= threshold) {
        if (!best || dist < best.dist) best = { cmd, dist }
      }
    }

    if (best) {
      best.cmd.hitCount++
      best.cmd.lastUsed = Date.now()
      this.persist()   // fire-and-forget
    }

    return best?.cmd ?? null
  }

  /** Store a newly resolved command. Deduplicates and prunes old entries. */
  async store(
    originalTranscript: string,
    result: VoiceResult,
    screenName?: string,
  ): Promise<void> {
    const normalised = LearningStore.normalise(originalTranscript)

    // Deduplicate — skip if very similar to an existing entry
    const isDuplicate = this.cache.some((cmd) => {
      const dist = LearningStore.levenshtein(normalised, cmd.transcript)
      return dist <= Math.floor(normalised.length * 0.05)
    })
    if (isDuplicate) return

    this.cache.push({
      transcript: normalised,
      original:   originalTranscript,
      actionId:   result.actionId,
      params:     result.params,
      speak:      result.speak,
      hitCount:   1,
      lastUsed:   Date.now(),
      confidence: result.confidence,
    })

    this.prune()
    await this.persist()
  }

  /** Seed multiple variant transcripts for the same action (from VariantGenerator). */
  async bulkStore(
    variants: string[],
    actionId: string,
    speak: string,
    confidence: number,
  ): Promise<void> {
    for (const v of variants) {
      if (v.trim().length < 4) continue
      await this.store(v, { actionId, params: {}, speak, confidence })
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async hydrate(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(this.key)
      if (raw) this.cache = JSON.parse(raw)
    } catch {
      // Corrupt storage — start fresh
      this.cache = []
    }
  }

  private async persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(this.key, JSON.stringify(this.cache))
    } catch { /* storage full — non-fatal */ }
  }

  private prune(): void {
    const cutoff = Date.now() - DECAY_DAYS * 86_400_000
    this.cache = this.cache
      .filter((c) => c.lastUsed > cutoff)
      .sort((a, b) => (b.hitCount * 10 + b.lastUsed / 1e10) - (a.hitCount * 10 + a.lastUsed / 1e10))
      .slice(0, MAX_ENTRIES)
  }

  // ── Text normalisation ──────────────────────────────────────────────────────

  static normalise(text: string): string {
    return text
      .toLowerCase()
      // Strip punctuation but keep Devanagari and Latin word chars
      .replace(/[^\w\sऀ-ॿ]/g, ' ')
      // Remove Hindi filler words
      .replace(/\b(hai|hain|toh|ji|ok|okay|please|kya|aap|mujhe|na|kar|do|de|meri|mera)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  // ── Iterative Levenshtein — O(m×n) time, O(min(m,n)) space ────────────────

  static levenshtein(a: string, b: string): number {
    if (a === b) return 0
    if (a.length === 0) return b.length
    if (b.length === 0) return a.length

    if (a.length > b.length) [a, b] = [b, a]

    const row = Array.from({ length: a.length + 1 }, (_, i) => i)
    for (let j = 1; j <= b.length; j++) {
      let prev = j
      for (let i = 1; i <= a.length; i++) {
        const val = b[j - 1] === a[i - 1]
          ? row[i - 1]
          : 1 + Math.min(row[i - 1], row[i], prev)
        row[i - 1] = prev
        prev = val
      }
      row[a.length] = prev
    }
    return row[a.length]
  }
}
