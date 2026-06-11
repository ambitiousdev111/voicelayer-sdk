// Founder-only routes. All require valid JWT.
const express       = require('express')
const { db, cutoff } = require('../db')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()
router.use(requireAuth)

// ── Cost constants (USD) ──────────────────────────────────────────────────────
const COST = {
  whisperPerSec:  0.0001,
  claudePerCall:  0.003,
  ttsPerChar:     0.0003,
  avgSpeakChars:  45,
}

function estimateCost({ totalCommands, aiCalls, learnedCalls, avgWhisperMs, successCount }) {
  const whisper   = totalCommands * ((avgWhisperMs || 2000) / 1000) * COST.whisperPerSec
  const ai        = aiCalls * COST.claudePerCall
  const tts       = successCount  * COST.avgSpeakChars * COST.ttsPerChar
  const saved     = learnedCalls  * COST.claudePerCall
  return { total: whisper + ai + tts, saved }
}

// ── GET /api/apps — all apps overview ────────────────────────────────────────

router.get('/', (req, res) => {
  const p = req.query.period || '7d'

  const rows = db.prepare(`
    SELECT
      app_id,
      COUNT(CASE WHEN type = 'command'                         THEN 1 END) AS total_commands,
      COUNT(CASE WHEN type = 'command' AND success = 1        THEN 1 END) AS successful,
      COUNT(CASE WHEN type = 'command' AND source = 'ai'      THEN 1 END) AS ai_calls,
      COUNT(CASE WHEN type = 'command' AND (source = 'learned' OR source = 'local_extract') THEN 1 END) AS learned_calls,
      AVG (CASE WHEN type = 'command'                         THEN total_ms END) AS avg_ms,
      COUNT(DISTINCT session_id)                                            AS sessions,
      MAX(ts)                                                               AS last_seen,
      MIN(ts)                                                               AS first_seen
    FROM events
    WHERE ts > ?
    GROUP BY app_id
    ORDER BY last_seen DESC
  `).all(cutoff(p))

  const apps = rows.map(r => {
    const { total, saved } = estimateCost({
      totalCommands: r.total_commands,
      aiCalls:       r.ai_calls,
      learnedCalls:  r.learned_calls,
      avgWhisperMs:  r.avg_ms,
      successCount:  r.successful,
    })
    return {
      appId:            r.app_id,
      totalCommands:    r.total_commands,
      successRate:      r.total_commands ? r.successful / r.total_commands : 0,
      avgLatencyMs:     Math.round(r.avg_ms || 0),
      learnedRatio:     r.total_commands ? r.learned_calls / r.total_commands : 0,
      totalSessions:    r.sessions,
      estimatedCostUSD: total,
      estimatedSavedUSD: saved,
      lastSeen:         r.last_seen,
      firstSeen:        r.first_seen,
    }
  })

  // Aggregate KPIs across all apps
  const agg = {
    totalApps:     apps.length,
    totalCommands: apps.reduce((s, a) => s + a.totalCommands, 0),
    avgSuccessRate: apps.length ? apps.reduce((s, a) => s + a.successRate, 0) / apps.length : 0,
    totalCostUSD:   apps.reduce((s, a) => s + a.estimatedCostUSD, 0),
    totalSavedUSD:  apps.reduce((s, a) => s + a.estimatedSavedUSD, 0),
    totalSessions:  apps.reduce((s, a) => s + a.totalSessions, 0),
  }

  res.json({ period: p, aggregate: agg, apps })
})

// ── GET /api/apps/:appId — single app detail ──────────────────────────────────

router.get('/:appId', (req, res) => {
  const { appId } = req.params
  const p         = req.query.period || '7d'
  const c         = cutoff(p)

  // KPIs
  const kpi = db.prepare(`
    SELECT
      COUNT(CASE WHEN type='command'                        THEN 1 END) AS total,
      COUNT(CASE WHEN type='command' AND success=1         THEN 1 END) AS successful,
      COUNT(CASE WHEN type='command' AND source='ai'       THEN 1 END) AS ai_calls,
      COUNT(CASE WHEN type='command' AND (source='learned' OR source='local_extract') THEN 1 END) AS learned_calls,
      AVG (CASE WHEN type='command' THEN total_ms   END) AS avg_total,
      AVG (CASE WHEN type='command' THEN whisper_ms END) AS avg_whisper,
      AVG (CASE WHEN type='command' THEN ai_ms      END) AS avg_ai,
      COUNT(DISTINCT session_id)                           AS sessions,
      COUNT(CASE WHEN type='error'                         THEN 1 END) AS errors
    FROM events
    WHERE app_id=? AND ts>?
  `).get(appId, c)

  // Hourly time series
  const series = db.prepare(`
    SELECT
      (ts/3600000)*3600000 AS hour,
      COUNT(*)              AS commands,
      AVG(CASE WHEN success IS NOT NULL THEN success END) AS success_rate,
      AVG(total_ms)         AS avg_ms,
      COUNT(CASE WHEN source='ai'                                THEN 1 END) AS ai_calls,
      COUNT(CASE WHEN source='learned' OR source='local_extract' THEN 1 END) AS learned_calls
    FROM events
    WHERE app_id=? AND type='command' AND ts>?
    GROUP BY hour
    ORDER BY hour ASC
  `).all(appId, c)

  // Top commands
  const topCmd = db.prepare(`
    SELECT route, action, COUNT(*) AS cnt,
           AVG(CASE WHEN success IS NOT NULL THEN success END) AS sr
    FROM events
    WHERE app_id=? AND type='command' AND ts>?
    GROUP BY route, action
    ORDER BY cnt DESC LIMIT 10
  `).all(appId, c)

  // Top failures
  const topFail = db.prepare(`
    SELECT route, COALESCE(error_code,'exec_failed') AS ec, COUNT(*) AS cnt
    FROM events
    WHERE app_id=? AND (type='error' OR (type='command' AND success=0)) AND ts>?
    GROUP BY route, ec
    ORDER BY cnt DESC LIMIT 10
  `).all(appId, c)

  // By source / lang / action
  const bySource = db.prepare(`SELECT source, COUNT(*) c FROM events WHERE app_id=? AND type='command' AND ts>? GROUP BY source`).all(appId, c)
  const byLang   = db.prepare(`SELECT lang,   COUNT(*) c FROM events WHERE app_id=? AND type='command' AND ts>? GROUP BY lang`).all(appId, c)
  const byAction = db.prepare(`SELECT action, COUNT(*) c FROM events WHERE app_id=? AND type='command' AND ts>? GROUP BY action ORDER BY c DESC LIMIT 7`).all(appId, c)

  // Daily commands for last 30 days
  const daily = db.prepare(`
    SELECT (ts/86400000)*86400000 AS day, COUNT(*) AS commands
    FROM events
    WHERE app_id=? AND type='command' AND ts > ?
    GROUP BY day ORDER BY day ASC
  `).all(appId, Date.now() - 30 * 86_400_000)

  const { total: costTotal, saved: costSaved } = estimateCost({
    totalCommands: kpi.total,
    aiCalls:       kpi.ai_calls,
    learnedCalls:  kpi.learned_calls,
    avgWhisperMs:  kpi.avg_whisper,
    successCount:  kpi.successful,
  })

  res.json({
    appId, period: p,
    kpis: {
      totalCommands:      kpi.total       || 0,
      successRate:        kpi.total ? kpi.successful / kpi.total : 0,
      avgLatencyMs:       Math.round(kpi.avg_total   || 0),
      avgWhisperMs:       Math.round(kpi.avg_whisper || 0),
      avgAiMs:            Math.round(kpi.avg_ai      || 0),
      learnedRatio:       kpi.total ? kpi.learned_calls / kpi.total : 0,
      estimatedCostUSD:   costTotal,
      estimatedSavedUSD:  costSaved,
      totalSessions:      kpi.sessions   || 0,
      errors:             kpi.errors     || 0,
    },
    timeSeries: series.map(r => ({
      ts:           r.hour,
      commands:     r.commands,
      successRate:  r.success_rate || 0,
      avgMs:        Math.round(r.avg_ms || 0),
      aiCalls:      r.ai_calls,
      learnedCalls: r.learned_calls,
    })),
    daily: daily.map(r => ({ ts: r.day, commands: r.commands })),
    topCommands: topCmd.map(r  => ({ route: r.route||'?', action: r.action||'?', count: r.cnt, successRate: r.sr||0 })),
    topFailures: topFail.map(r => ({ route: r.route||'?', errorCode: r.ec, count: r.cnt })),
    bySource: Object.fromEntries(bySource.map(r => [r.source||'unknown', r.c])),
    byLang:   Object.fromEntries(byLang.map(r   => [r.lang  ||'unknown', r.c])),
    byAction: Object.fromEntries(byAction.map(r => [r.action||'unknown', r.c])),
  })
})

// ── GET /api/apps/:appId/export — raw CSV or JSON download ───────────────────

router.get('/:appId/export', (req, res) => {
  const { appId }  = req.params
  const fmt        = req.query.format || 'json'
  const limit      = Math.min(parseInt(req.query.limit) || 50_000, 500_000)
  const p          = req.query.period || '30d'

  const rows = db.prepare(`
    SELECT * FROM events WHERE app_id=? AND ts>? ORDER BY ts DESC LIMIT ?
  `).all(appId, cutoff(p), limit)

  if (fmt === 'csv') {
    if (rows.length === 0) return res.send('No data')
    const headers = Object.keys(rows[0]).join(',')
    const body    = rows.map(r => Object.values(r).map(v => v == null ? '' : String(v)).join(',')).join('\n')
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="vl-${appId}-${p}.csv"`)
    res.send(headers + '\n' + body)
  } else {
    res.setHeader('Content-Disposition', `attachment; filename="vl-${appId}-${p}.json"`)
    res.json(rows)
  }
})

module.exports = router
