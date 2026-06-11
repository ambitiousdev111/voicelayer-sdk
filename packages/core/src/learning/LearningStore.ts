// ─────────────────────────────────────────────────────────────────────────────
// VoiceLayer LearningStore
//
// Stores successful agent-loop resolutions as transcript → step-sequence
// mappings. On subsequent commands, fuzzy-matches the transcript and replays
// the stored steps directly — no AI call needed.
//
// Collision safety:
//   - Full transcript is the key, not extracted keywords/synonyms
//   - Levenshtein threshold is conservative (≤ 20% edit distance)
//   - Every stored step's selector is validated against live DOM before replay
//   - Any validation failure falls through to the agent loop
// ─────────────────────────────────────────────────────────────────────────────

import type { ActionType } from '../ai/types.js'

// ── Types ──────────────────────────────────────────────────────────────────

export interface StoredStep {
  action:  ActionType
  target:  string | null
  data:    Record<string, string> | null
}

export interface StoredCommand {
  id:                 string
  transcript:         string   // normalized (lowercase, no punctuation)
  originalTranscript: string   // raw — shown in debug logs
  steps:              StoredStep[]
  speak:              string
  startRoute:         string   // route where the command was first issued
  hitCount:           number
  lastUsed:           number
  source:             'learned' | 'variant'
  confidence:         number   // original agent confidence
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Max edit-distance ratio to consider a match (0 = exact, 1 = anything). */
const MATCH_THRESHOLD = 0.20   // ≤ 20% of the longer string's length

/** Give a small bonus to matches on the same route. */
const SAME_ROUTE_BONUS = 0.04  // effectively raises threshold to 0.24

const STORAGE_KEY    = 'vl_learning_store'
const MAX_ENTRIES    = 500
const DECAY_DAYS     = 60      // prune entries unused for this many days

// ── LearningStore ──────────────────────────────────────────────────────────

export class LearningStore {
  private entries: StoredCommand[] = []
  private appId: string

  constructor(appId: string) {
    this.appId = appId
    this.load()
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Find the best matching stored command for a given transcript.
   * Returns null if no match is confident enough.
   *
   * @param transcript    Raw transcript from STT
   * @param currentRoute  Current SPA route (used for same-route bonus)
   */
  findMatch(transcript: string, currentRoute: string): StoredCommand | null {
    if (this.entries.length === 0) return null

    const norm = this.normalize(transcript)
    let bestScore = Infinity
    let bestEntry: StoredCommand | null = null

    for (const entry of this.entries) {
      const dist  = this.levenshtein(norm, entry.transcript)
      const maxLen = Math.max(norm.length, entry.transcript.length)
      if (maxLen === 0) continue

      const ratio     = dist / maxLen
      const sameRoute = currentRoute === entry.startRoute
      const effective = sameRoute ? ratio - SAME_ROUTE_BONUS : ratio

      if (effective < bestScore) {
        bestScore = effective
        bestEntry = entry
      }
    }

    if (bestScore <= MATCH_THRESHOLD && bestEntry) {
      bestEntry.hitCount++
      bestEntry.lastUsed = Date.now()
      this.persist()
      return bestEntry
    }

    return null
  }

  /**
   * Record a successful agent-loop resolution.
   * Call this after speaking the response.
   */
  store(
    originalTranscript: string,
    steps:              StoredStep[],
    speak:              string,
    startRoute:         string,
    confidence:         number,
    source:             'learned' | 'variant' = 'learned',
  ): void {
    const transcript = this.normalize(originalTranscript)

    // If an equivalent entry already exists, update it instead of duplicating
    const existing = this.entries.find(
      (e) => this.levenshtein(e.transcript, transcript) / Math.max(e.transcript.length, transcript.length) < 0.05,
    )
    if (existing) {
      existing.steps      = steps
      existing.speak      = speak
      existing.confidence = confidence
      existing.lastUsed   = Date.now()
      existing.hitCount++
      this.persist()
      return
    }

    this.entries.push({
      id:                 Math.random().toString(36).slice(2),
      transcript,
      originalTranscript,
      steps,
      speak,
      startRoute,
      hitCount:           0,
      lastUsed:           Date.now(),
      source,
      confidence,
    })

    this.prune()
    this.persist()
  }

  /**
   * Bulk-insert variant transcripts that all map to the same step sequence.
   * Used by VariantGenerator to pre-seed the store after a successful resolution.
   */
  bulkStore(
    variants:   string[],
    steps:      StoredStep[],
    speak:      string,
    startRoute: string,
    confidence: number,
  ): void {
    for (const v of variants) {
      if (v.trim().length < 4) continue
      this.store(v, steps, speak, startRoute, confidence, 'variant')
    }
  }

  /**
   * Validate that every selector in a stored command still exists in the DOM.
   * Returns false if any selector-based step cannot be found.
   * Call this before replaying a cached command.
   */
  validateSteps(steps: StoredStep[]): boolean {
    for (const step of steps) {
      if (!step.target) continue
      // Only validate CSS-selector targets (not route paths)
      if (step.target.startsWith('/')) continue
      try {
        if (!document.querySelector(step.target)) return false
      } catch {
        return false   // invalid selector syntax
      }
    }
    return true
  }

  /** Export all entries for upload to the analytics server. */
  export(): StoredCommand[] {
    return [...this.entries]
  }

  /**
   * Merge entries received from the analytics server.
   * Skips entries already present (by id) and respects MAX_ENTRIES.
   */
  merge(remote: StoredCommand[]): void {
    const existing = new Set(this.entries.map((e) => e.id))
    for (const entry of remote) {
      if (!existing.has(entry.id) && this.entries.length < MAX_ENTRIES) {
        this.entries.push(entry)
      }
    }
    this.persist()
  }

  get size(): number { return this.entries.length }

  // ── Private helpers ────────────────────────────────────────────────────

  /**
   * Normalize a transcript for comparison:
   *   - lowercase
   *   - strip punctuation
   *   - collapse whitespace
   *   - remove common filler words
   */
  private normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\sऀ-ॿ]/g, ' ')  // keep ASCII word chars + Devanagari
      .replace(/\b(please|kya|aap|mujhe|mujhe|toh|hai|hain|na|ji|ok|okay)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  /**
   * Iterative Levenshtein distance.
   * O(m×n) time, O(min(m,n)) space.
   */
  private levenshtein(a: string, b: string): number {
    if (a === b) return 0
    if (a.length === 0) return b.length
    if (b.length === 0) return a.length

    // Always iterate over the shorter string
    if (a.length > b.length) { [a, b] = [b, a] }

    let prev = Array.from({ length: a.length + 1 }, (_, i) => i)

    for (let j = 1; j <= b.length; j++) {
      const curr = [j]
      for (let i = 1; i <= a.length; i++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1
        curr[i] = Math.min(
          prev[i] + 1,       // deletion
          curr[i - 1] + 1,   // insertion
          prev[i - 1] + cost, // substitution
        )
      }
      prev = curr
    }

    return prev[a.length]
  }

  /** Drop oldest, lowest-hit entries when over limit or decayed. */
  private prune(): void {
    const cutoff = Date.now() - DECAY_DAYS * 86_400_000
    this.entries = this.entries
      .filter((e) => e.lastUsed > cutoff)
      .sort((a, b) => (b.hitCount * 10 + b.lastUsed / 1e10) - (a.hitCount * 10 + a.lastUsed / 1e10))
      .slice(0, MAX_ENTRIES)
  }

  private storageKey(): string {
    return `${STORAGE_KEY}_${this.appId}`
  }

  private persist(): void {
    try {
      localStorage.setItem(this.storageKey(), JSON.stringify(this.entries))
    } catch {
      // Private browsing / storage full — silently skip
    }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(this.storageKey())
      if (raw) this.entries = JSON.parse(raw) as StoredCommand[]
    } catch {
      this.entries = []
    }
  }
}
