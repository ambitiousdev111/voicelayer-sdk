// ─────────────────────────────────────────────────────────────────────────────
// VoiceLayer Analytics — Event Queue
//
// In-memory circular buffer (last 1 000 events) + localStorage persistence
// (last 30 days, capped at 50 000 events ≈ ~4 MB).
// All reads/writes to localStorage are wrapped in try/catch so the SDK
// never breaks if storage is unavailable (private browsing, quota exceeded).
// ─────────────────────────────────────────────────────────────────────────────

import type { VLEvent } from './types.js'

const STORAGE_PREFIX   = 'vl_events_'
const MAX_IN_MEMORY    = 1_000
const MAX_STORED       = 50_000
const MAX_AGE_MS       = 30 * 24 * 60 * 60 * 1_000   // 30 days

export class EventQueue {
  private buffer: VLEvent[] = []
  private readonly storageKey: string

  constructor(private readonly appId: string) {
    this.storageKey = `${STORAGE_PREFIX}${appId}`
  }

  /** Append one event to the in-memory ring buffer. */
  push(event: VLEvent): void {
    this.buffer.push(event)
    if (this.buffer.length > MAX_IN_MEMORY) this.buffer.shift()
  }

  /**
   * Merge in-memory buffer into localStorage, pruning stale / excess events.
   * Called on a 60-second interval and on beforeunload.
   */
  persist(): void {
    try {
      const stored  = this._load()
      const inMemIds = new Set(this.buffer.map(e => e.id))
      const merged   = [...stored.filter(e => !inMemIds.has(e.id)), ...this.buffer]
      const cutoff   = Date.now() - MAX_AGE_MS
      const pruned   = merged.filter(e => e.ts > cutoff).slice(-MAX_STORED)
      localStorage.setItem(this.storageKey, JSON.stringify(pruned))
    } catch { /* storage full or unavailable — fail silently */ }
  }

  /**
   * Return the union of persisted events + in-memory buffer,
   * sorted oldest → newest. Deduplicated by id.
   */
  getAllEvents(): VLEvent[] {
    const stored    = this._load()
    const inMemIds  = new Set(this.buffer.map(e => e.id))
    const unique    = stored.filter(e => !inMemIds.has(e.id))
    return [...unique, ...this.buffer].sort((a, b) => a.ts - b.ts)
  }

  /** Return only in-memory events (for batched remote sends). */
  flush(): VLEvent[] {
    return [...this.buffer]
  }

  clear(): void {
    this.buffer = []
    try { localStorage.removeItem(this.storageKey) } catch { /* ignore */ }
  }

  // ── private ─────────────────────────────────────────────────────────────────

  private _load(): VLEvent[] {
    try {
      const raw = localStorage.getItem(this.storageKey)
      return raw ? (JSON.parse(raw) as VLEvent[]) : []
    } catch {
      return []
    }
  }
}
