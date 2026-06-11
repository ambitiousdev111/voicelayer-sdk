// ─────────────────────────────────────────────────────────────────────────────
// VoiceLayer Analytics — Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

export type VLEventType = 'command' | 'plan' | 'error' | 'session_start'

export type VLActionType =
  | 'navigate' | 'click' | 'fill_form' | 'submit_form'
  | 'speak_only' | 'clarify' | 'plan' | 'scroll'
  | 'tab' | 'close_modal' | 'open_dropdown' | 'select_option'
  | 'focus' | 'key' | 'accordion' | 'filter'

export type VLSource = 'ai' | 'learned' | 'local_extract'
export type VLLang  = 'hi' | 'en' | 'mixed' | 'unknown'

// ── Raw event stored per voice command ───────────────────────────────────────

export interface VLEvent {
  id:         string       // random id for deduplication
  appId:      string       // from data-app-id
  sessionId:  string       // random per browser tab
  ts:         number       // Date.now()
  type:       VLEventType
  sdkVersion: string

  // command / plan fields
  action?:              VLActionType
  route?:               string        // parameterized: /orders/:id
  success?:             boolean
  source?:              VLSource
  lang?:                VLLang
  whisperMs?:           number
  aiMs?:                number
  execMs?:              number
  totalMs?:             number

  // plan-specific
  planSteps?:           number
  planStepsCompleted?:  number

  // error fields
  errorCode?:           string
}

// ── Derived stats ─────────────────────────────────────────────────────────────

export interface CommandStats {
  total:        number
  successRate:  number       // 0–1
  avgTotalMs:   number
  avgWhisperMs: number
  avgAiMs:      number
  bySource:     { ai: number; learned: number; local_extract: number }
  byLang:       { hi: number; en: number; mixed: number; unknown: number }
  byAction:     Record<string, number>
  byRoute:      Record<string, { total: number; success: number }>
}

export interface TimeSeriesPoint {
  ts:           number   // start-of-hour unix ms
  commands:     number
  successRate:  number
  avgMs:        number
  aiCalls:      number
  learnedCalls: number
}

export interface TopCommand {
  route:       string
  action:      string
  count:       number
  successRate: number
}

export interface TopFailure {
  route:      string
  errorCode:  string
  count:      number
}

export interface VLInsights {
  computed:  number
  period:    { from: number; to: number }

  // headline KPIs
  totalCommands:     number
  successRate:       number    // 0–1
  avgLatencyMs:      number
  learnedRatio:      number    // 0–1 — commands resolved without hitting AI
  estimatedCostUSD:  number

  // detailed breakdowns
  stats:       CommandStats
  timeSeries:  TimeSeriesPoint[]    // last 7 days by hour
  topCommands: TopCommand[]         // top 10 by frequency
  topFailures: TopFailure[]         // top 10 failures

  learningStore: {
    totalMappings:      number
    confidentMappings:  number
    commandsSavedFromAI: number
    estimatedCostSaved:  number
  }

  sessions: {
    total:                  number
    avgCommandsPerSession:  number
  }
}
