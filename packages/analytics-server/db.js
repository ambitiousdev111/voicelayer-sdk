// ─────────────────────────────────────────────────────────────────────────────
// VoiceLayer Analytics — SQLite Database
// ─────────────────────────────────────────────────────────────────────────────

const Database = require('better-sqlite3')
const path     = require('path')
const fs       = require('fs')

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(path.join(DATA_DIR, 'voicelayer.db'))

// WAL mode: faster writes, concurrent reads
db.pragma('journal_mode = WAL')
db.pragma('synchronous  = NORMAL')
db.pragma('temp_store   = MEMORY')
db.pragma('mmap_size    = 268435456')  // 256 MB

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id                   TEXT    PRIMARY KEY,
    app_id               TEXT    NOT NULL,
    session_id           TEXT    NOT NULL,
    ts                   INTEGER NOT NULL,
    type                 TEXT    NOT NULL,
    sdk_version          TEXT,
    action               TEXT,
    route                TEXT,
    success              INTEGER,
    source               TEXT,
    lang                 TEXT,
    whisper_ms           INTEGER,
    ai_ms                INTEGER,
    exec_ms              INTEGER,
    total_ms             INTEGER,
    plan_steps           INTEGER,
    plan_steps_completed INTEGER,
    error_code           TEXT,
    inserted_at          INTEGER DEFAULT (unixepoch() * 1000)
  );

  CREATE INDEX IF NOT EXISTS idx_app_ts   ON events(app_id, ts);
  CREATE INDEX IF NOT EXISTS idx_ts       ON events(ts);
  CREATE INDEX IF NOT EXISTS idx_type     ON events(type);
  CREATE INDEX IF NOT EXISTS idx_app_type ON events(app_id, type);
`)

// ── Prepared insert ───────────────────────────────────────────────────────────

const _insert = db.prepare(`
  INSERT OR IGNORE INTO events
    (id, app_id, session_id, ts, type, sdk_version,
     action, route, success, source, lang,
     whisper_ms, ai_ms, exec_ms, total_ms,
     plan_steps, plan_steps_completed, error_code)
  VALUES
    (@id, @app_id, @session_id, @ts, @type, @sdk_version,
     @action, @route, @success, @source, @lang,
     @whisper_ms, @ai_ms, @exec_ms, @total_ms,
     @plan_steps, @plan_steps_completed, @error_code)
`)

const insertMany = db.transaction((events) => {
  let inserted = 0
  for (const e of events) {
    const changes = _insert.run({
      id:                   e.id,
      app_id:               e.appId,
      session_id:           e.sessionId,
      ts:                   e.ts,
      type:                 e.type,
      sdk_version:          e.sdkVersion          ?? null,
      action:               e.action              ?? null,
      route:                e.route               ?? null,
      success:              e.success === true ? 1 : e.success === false ? 0 : null,
      source:               e.source              ?? null,
      lang:                 e.lang                ?? null,
      whisper_ms:           e.whisperMs           ?? null,
      ai_ms:                e.aiMs                ?? null,
      exec_ms:              e.execMs              ?? null,
      total_ms:             e.totalMs             ?? null,
      plan_steps:           e.planSteps           ?? null,
      plan_steps_completed: e.planStepsCompleted  ?? null,
      error_code:           e.errorCode           ?? null,
    })
    inserted += changes.changes
  }
  return inserted
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function cutoff(period) {
  const map = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000 }
  return Date.now() - (map[period] || map['7d'])
}

module.exports = { db, insertMany, cutoff }
