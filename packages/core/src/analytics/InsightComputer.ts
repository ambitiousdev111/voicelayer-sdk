// ─────────────────────────────────────────────────────────────────────────────
// VoiceLayer Analytics — Insight Computer
//
// Pure functions — no side-effects, fully testable.
// Takes raw VLEvent[] and produces VLInsights.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  VLEvent, VLInsights, CommandStats,
  TimeSeriesPoint, TopCommand, TopFailure,
} from './types.js'

// Approximate API costs (USD)
const COST_WHISPER_PER_SEC  = 0.0001    // $0.006 / min
const COST_CLAUDE_PER_CALL  = 0.003     // avg ~1.5k tokens in + 200 out
const COST_TTS_PER_CHAR     = 0.0003    // ElevenLabs $0.30 / 1k chars
const AVG_SPEAK_CHARS       = 45

export class InsightComputer {

  compute(
    events: VLEvent[],
    learningStoreStats?: { total: number; confident: number },
  ): VLInsights {
    const now      = Date.now()
    const commands = events.filter(e => e.type === 'command')
    const errors   = events.filter(e => e.type === 'error')
    const sessions = new Set(events.map(e => e.sessionId)).size

    const stats      = this._commandStats(commands)
    const timeSeries = this._timeSeries(commands)
    const topCommands = this._topCommands(commands)
    const topFailures = this._topFailures(commands, errors)

    const aiCalls      = commands.filter(e => e.source === 'ai').length
    const learnedCalls = commands.filter(e =>
      e.source === 'learned' || e.source === 'local_extract',
    ).length

    const avgLatency = commands.length
      ? commands.reduce((s, e) => s + (e.totalMs ?? 0), 0) / commands.length
      : 0

    // Cost estimate
    const whisperCost = commands.reduce(
      (s, e) => s + ((e.whisperMs ?? 2_000) / 1_000) * COST_WHISPER_PER_SEC, 0,
    )
    const aiCost  = aiCalls * COST_CLAUDE_PER_CALL
    const ttsCost = commands.filter(e => e.success).length * AVG_SPEAK_CHARS * COST_TTS_PER_CHAR
    const totalCost   = whisperCost + aiCost + ttsCost
    const costSaved   = learnedCalls * COST_CLAUDE_PER_CALL

    return {
      computed: now,
      period: {
        from: events.length ? Math.min(...events.map(e => e.ts)) : now,
        to:   now,
      },
      totalCommands:    commands.length,
      successRate:      stats.successRate,
      avgLatencyMs:     Math.round(avgLatency),
      learnedRatio:     commands.length ? (learnedCalls) / commands.length : 0,
      estimatedCostUSD: totalCost,
      stats,
      timeSeries,
      topCommands,
      topFailures,
      learningStore: {
        totalMappings:       learningStoreStats?.total    ?? 0,
        confidentMappings:   learningStoreStats?.confident ?? 0,
        commandsSavedFromAI: learnedCalls,
        estimatedCostSaved:  costSaved,
      },
      sessions: {
        total:                 sessions,
        avgCommandsPerSession: sessions ? commands.length / sessions : 0,
      },
    }
  }

  // ── private helpers ──────────────────────────────────────────────────────────

  private _commandStats(commands: VLEvent[]): CommandStats {
    const total     = commands.length
    const successes = commands.filter(e => e.success).length

    const bySource  = { ai: 0, learned: 0, local_extract: 0 }
    const byLang    = { hi: 0, en: 0, mixed: 0, unknown: 0 }
    const byAction: Record<string, number> = {}
    const byRoute:  Record<string, { total: number; success: number }> = {}

    let totalMs = 0, whisperMs = 0, aiMs = 0

    for (const e of commands) {
      if (e.source) {
        if (e.source in bySource) (bySource as Record<string, number>)[e.source]++
      }
      if (e.lang && e.lang in byLang) (byLang as Record<string, number>)[e.lang]++
      if (e.action) byAction[e.action] = (byAction[e.action] ?? 0) + 1

      const route = e.route ?? 'unknown'
      if (!byRoute[route]) byRoute[route] = { total: 0, success: 0 }
      byRoute[route].total++
      if (e.success) byRoute[route].success++

      totalMs   += e.totalMs   ?? 0
      whisperMs += e.whisperMs ?? 0
      aiMs      += e.aiMs      ?? 0
    }

    return {
      total,
      successRate:  total ? successes / total : 0,
      avgTotalMs:   total ? Math.round(totalMs   / total) : 0,
      avgWhisperMs: total ? Math.round(whisperMs / total) : 0,
      avgAiMs:      total ? Math.round(aiMs      / total) : 0,
      bySource,
      byLang,
      byAction,
      byRoute,
    }
  }

  private _timeSeries(commands: VLEvent[]): TimeSeriesPoint[] {
    const cutoff  = Date.now() - 7 * 24 * 60 * 60 * 1_000
    const recent  = commands.filter(e => e.ts > cutoff)
    const HOUR_MS = 60 * 60 * 1_000

    const buckets = new Map<number, VLEvent[]>()
    for (const e of recent) {
      const hour = Math.floor(e.ts / HOUR_MS) * HOUR_MS
      if (!buckets.has(hour)) buckets.set(hour, [])
      buckets.get(hour)!.push(e)
    }

    return Array.from(buckets.entries())
      .sort(([a], [b]) => a - b)
      .map(([ts, evs]) => ({
        ts,
        commands:     evs.length,
        successRate:  evs.length ? evs.filter(e => e.success).length / evs.length : 0,
        avgMs:        evs.length ? evs.reduce((s, e) => s + (e.totalMs ?? 0), 0) / evs.length : 0,
        aiCalls:      evs.filter(e => e.source === 'ai').length,
        learnedCalls: evs.filter(e => e.source === 'learned' || e.source === 'local_extract').length,
      }))
  }

  private _topCommands(commands: VLEvent[]): TopCommand[] {
    const map = new Map<string, { total: number; success: number }>()
    for (const e of commands) {
      const key = `${e.route ?? 'unknown'}::${e.action ?? 'unknown'}`
      if (!map.has(key)) map.set(key, { total: 0, success: 0 })
      const v = map.get(key)!
      v.total++
      if (e.success) v.success++
    }
    return Array.from(map.entries())
      .map(([key, v]) => {
        const [route, action] = key.split('::')
        return { route, action, count: v.total, successRate: v.total ? v.success / v.total : 0 }
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
  }

  private _topFailures(commands: VLEvent[], errors: VLEvent[]): TopFailure[] {
    const map = new Map<string, number>()
    for (const e of [...commands.filter(e => !e.success), ...errors]) {
      const key = `${e.route ?? 'unknown'}::${e.errorCode ?? 'exec_failed'}`
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return Array.from(map.entries())
      .map(([key, count]) => {
        const [route, errorCode] = key.split('::')
        return { route, errorCode, count }
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
  }
}
