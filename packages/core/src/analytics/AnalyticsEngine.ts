// ─────────────────────────────────────────────────────────────────────────────
// VoiceLayer Analytics — Engine
//
// Wires EventQueue + InsightComputer into a single public API.
// Persists events to localStorage every 60s and on tab close.
// Optionally batches events to a remote endpoint via navigator.sendBeacon.
// ─────────────────────────────────────────────────────────────────────────────

import { EventQueue }      from './EventQueue.js'
import { InsightComputer } from './InsightComputer.js'
import type {
  VLEvent, VLInsights,
  VLActionType, VLSource, VLLang,
} from './types.js'

export interface AnalyticsConfig {
  appId:          string
  enabled:        boolean
  endpoint?:      string    // POST target for remote collection
  flushIntervalMs?: number  // default 60 000
  sdkVersion?:    string
}

// ─────────────────────────────────────────────────────────────────────────────

let _sessionId: string | null = null
function sessionId(): string {
  return (_sessionId ??= Math.random().toString(36).slice(2) + Date.now().toString(36))
}

/** /orders/123  →  /orders/:id,  /customers/abc-def-xyz  →  /customers/:id */
function parameterize(route: string): string {
  return route
    .replace(/\/\d+/g, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '/:uuid')
    .replace(/\/[a-z0-9]{24,}/gi, '/:id')
}

// ─────────────────────────────────────────────────────────────────────────────

export class AnalyticsEngine {
  private readonly queue:    EventQueue
  private readonly computer: InsightComputer
  private pending:   VLEvent[] = []
  private timer:     number | null = null

  constructor(private readonly config: AnalyticsConfig) {
    this.queue    = new EventQueue(config.appId)
    this.computer = new InsightComputer()
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  install(): void {
    if (!this.config.enabled) return

    this._track({ type: 'session_start' })

    const ms = this.config.flushIntervalMs ?? 60_000
    this.timer = window.setInterval(() => this._flush(), ms)

    window.addEventListener('beforeunload', () => {
      this._flush()
      if (this.config.endpoint && this.pending.length) {
        this._beacon(this.pending)
        this.pending = []
      }
    })
  }

  uninstall(): void {
    if (this.timer) clearInterval(this.timer)
    this._flush()
  }

  // ── tracking ───────────────────────────────────────────────────────────────

  trackCommand(p: {
    action:    VLActionType
    route:     string
    success:   boolean
    source:    VLSource
    lang:      VLLang
    whisperMs: number
    aiMs:      number
    execMs:    number
    totalMs:   number
  }): void {
    this._track({
      type:      'command',
      action:    p.action,
      route:     parameterize(p.route),
      success:   p.success,
      source:    p.source,
      lang:      p.lang,
      whisperMs: p.whisperMs,
      aiMs:      p.aiMs,
      execMs:    p.execMs,
      totalMs:   p.totalMs,
    })
  }

  trackPlan(p: {
    route:           string
    steps:           number
    stepsCompleted:  number
    totalMs:         number
  }): void {
    this._track({
      type:               'plan',
      route:              parameterize(p.route),
      planSteps:          p.steps,
      planStepsCompleted: p.stepsCompleted,
      totalMs:            p.totalMs,
      success:            p.stepsCompleted === p.steps,
    })
  }

  trackError(p: { route: string; errorCode: string }): void {
    this._track({ type: 'error', route: parameterize(p.route), errorCode: p.errorCode })
  }

  // ── insights ───────────────────────────────────────────────────────────────

  getInsights(learningStoreStats?: { total: number; confident: number }): VLInsights {
    return this.computer.compute(this.queue.getAllEvents(), learningStoreStats)
  }

  // ── export ─────────────────────────────────────────────────────────────────

  exportJSON(): string {
    return JSON.stringify(this.queue.getAllEvents(), null, 2)
  }

  exportCSV(): string {
    const events  = this.queue.getAllEvents()
    const headers: (keyof VLEvent)[] = [
      'id','ts','type','action','route','success','source',
      'lang','whisperMs','aiMs','execMs','totalMs','errorCode',
    ]
    const rows = events.map(e =>
      headers.map(h => {
        const v = e[h]
        return v === undefined ? '' : String(v)
      }).join(','),
    )
    return [headers.join(','), ...rows].join('\n')
  }

  // ── private ────────────────────────────────────────────────────────────────

  private _track(partial: Omit<VLEvent, 'id' | 'appId' | 'sessionId' | 'ts' | 'sdkVersion'>): void {
    const event: VLEvent = {
      id:         Math.random().toString(36).slice(2) + Date.now().toString(36),
      appId:      this.config.appId,
      sessionId:  sessionId(),
      ts:         Date.now(),
      sdkVersion: this.config.sdkVersion ?? '0.2.0',
      ...partial,
    }
    this.queue.push(event)
    if (this.config.endpoint) this.pending.push(event)
  }

  private _flush(): void {
    this.queue.persist()
    if (this.config.endpoint && this.pending.length) {
      this._beacon([...this.pending])
      this.pending = []
    }
  }

  private _beacon(events: VLEvent[]): void {
    if (!this.config.endpoint) return
    try {
      const body = JSON.stringify({ events })
      const ok   = navigator.sendBeacon(
        this.config.endpoint,
        new Blob([body], { type: 'application/json' }),
      )
      // If queue was full, retain for next flush attempt
      if (!ok) this.pending.unshift(...events)
    } catch { /* never throw from analytics */ }
  }
}
