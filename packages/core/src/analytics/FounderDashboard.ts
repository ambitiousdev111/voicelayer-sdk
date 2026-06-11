// ─────────────────────────────────────────────────────────────────────────────
// VoiceLayer — Founder Dashboard
//
// Opens a full-screen overlay (iframe srcdoc) with live analytics charts.
// Trigger:  window.voicelayer.openDashboard()
//           OR keyboard shortcut Ctrl + Shift + V (when debug mode is on)
//
// Data flow: parent page → postMessage({ type: 'vl-insights', data }) → iframe
// ─────────────────────────────────────────────────────────────────────────────

import type { VLInsights } from './types.js'

export class FounderDashboard {
  private overlay: HTMLDivElement | null = null
  private shortcutHandler: ((e: KeyboardEvent) => void) | null = null

  constructor(private readonly getInsights: () => VLInsights) {}

  /** Register Ctrl+Shift+V keyboard shortcut. Call once in VoiceLayer.init(). */
  installShortcut(): void {
    this.shortcutHandler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        e.preventDefault()
        this.isOpen() ? this.close() : this.open()
      }
    }
    window.addEventListener('keydown', this.shortcutHandler)
  }

  open(): void {
    if (this.isOpen()) return

    const insights = this.getInsights()

    this.overlay = document.createElement('div')
    this.overlay.id = 'voicelayer-dashboard-overlay'
    Object.assign(this.overlay.style, {
      position:   'fixed',
      inset:      '0',
      zIndex:     '2147483647',
      background: 'rgba(0,0,0,0.6)',
      backdropFilter: 'blur(4px)',
      display:    'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif',
    })

    const iframe = document.createElement('iframe')
    Object.assign(iframe.style, {
      width:        '92vw',
      maxWidth:     '1100px',
      height:       '88vh',
      border:       'none',
      borderRadius: '16px',
      boxShadow:    '0 32px 80px rgba(0,0,0,0.5)',
    })
    iframe.srcdoc = DASHBOARD_HTML
    iframe.setAttribute('sandbox', 'allow-scripts')

    // Send data after iframe loads
    iframe.onload = () => {
      iframe.contentWindow?.postMessage(
        { type: 'vl-insights', data: insights },
        '*',
      )
    }

    // Close on backdrop click
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close()
    })

    this.overlay.appendChild(iframe)
    document.body.appendChild(this.overlay)
  }

  close(): void {
    this.overlay?.remove()
    this.overlay = null
  }

  isOpen(): boolean {
    return this.overlay !== null
  }

  uninstall(): void {
    this.close()
    if (this.shortcutHandler) {
      window.removeEventListener('keydown', this.shortcutHandler)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-contained dashboard HTML (injected as iframe srcdoc)
// Chart.js loaded from cdnjs. No external fonts or assets.
// ─────────────────────────────────────────────────────────────────────────────

const DASHBOARD_HTML = /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VoiceLayer Insights</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"><\/script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #0f1117;
    --surface:  #1a1d27;
    --border:   #2a2d3a;
    --text:     #e8eaf0;
    --muted:    #7b7f93;
    --accent:   #6c63ff;
    --green:    #22c55e;
    --red:      #ef4444;
    --orange:   #f97316;
    --blue:     #3b82f6;
  }

  html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, sans-serif; font-size: 13px; }

  /* ── Layout ── */
  #app { display: flex; flex-direction: column; height: 100vh; }

  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 22px; border-bottom: 1px solid var(--border);
    background: var(--surface); flex-shrink: 0;
  }
  .logo { font-size: 15px; font-weight: 700; letter-spacing: -0.02em; }
  .logo span { color: var(--accent); }
  .header-right { display: flex; gap: 10px; align-items: center; }
  .pill-badge { font-size: 10px; font-weight: 600; padding: 3px 8px; border-radius: 10px; }
  .live { background: rgba(34,197,94,.15); color: var(--green); }
  .ts  { color: var(--muted); font-size: 11px; }
  .btn {
    background: var(--surface); border: 1px solid var(--border); color: var(--text);
    padding: 5px 12px; border-radius: 6px; font-size: 11px; font-weight: 600;
    cursor: pointer; transition: border-color .15s;
  }
  .btn:hover { border-color: var(--accent); }
  .btn-accent { background: var(--accent); border-color: var(--accent); color: #fff; }

  main { flex: 1; overflow-y: auto; padding: 18px 22px; }

  /* ── KPI row ── */
  .kpi-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 18px; }
  .kpi {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; padding: 14px 16px;
  }
  .kpi-label { font-size: 10px; font-weight: 600; text-transform: uppercase;
    letter-spacing: .06em; color: var(--muted); margin-bottom: 6px; }
  .kpi-value { font-size: 26px; font-weight: 700; letter-spacing: -.03em; line-height: 1; }
  .kpi-sub   { font-size: 10px; color: var(--muted); margin-top: 4px; }
  .kpi-green .kpi-value { color: var(--green); }
  .kpi-blue  .kpi-value { color: var(--blue);  }
  .kpi-orange.kpi-value { color: var(--orange); }

  /* ── Charts ── */
  .charts-row { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; margin-bottom: 18px; }
  .charts-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 18px; }

  .chart-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; padding: 16px;
  }
  .chart-title { font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .06em; color: var(--muted); margin-bottom: 12px; }
  .chart-wrap { position: relative; }

  /* ── Tables ── */
  .tables-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em;
    color: var(--muted); padding: 6px 10px; text-align: left;
    border-bottom: 1px solid var(--border); }
  td { padding: 7px 10px; font-size: 12px; border-bottom: 1px solid rgba(255,255,255,.04); }
  tr:last-child td { border-bottom: none; }
  .route { font-family: monospace; font-size: 11px; color: var(--blue); }
  .success-bar { height: 4px; border-radius: 2px; background: var(--border); overflow: hidden; width: 60px; }
  .success-fill { height: 100%; border-radius: 2px; }

  /* ── Latency breakdown ── */
  .latency-row { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; margin-bottom: 18px; }
  .lat-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; padding: 12px 14px; text-align: center;
  }
  .lat-label { font-size: 10px; color: var(--muted); text-transform: uppercase;
    letter-spacing: .05em; margin-bottom: 4px; }
  .lat-value { font-size: 22px; font-weight: 700; }
  .lat-sub   { font-size: 10px; color: var(--muted); }

  /* ── Scrollbar ── */
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  .empty { color: var(--muted); font-size: 12px; padding: 12px 0; text-align: center; }

  .section-sep { border: none; border-top: 1px solid var(--border); margin: 0 0 18px 0; }
</style>
</head>
<body>
<div id="app">
  <header>
    <div class="logo">Voice<span>Layer</span> Insights</div>
    <div class="header-right">
      <span class="pill-badge live">● LIVE</span>
      <span class="ts" id="computed-ts">—</span>
      <button class="btn" onclick="exportCSV()">Export CSV</button>
      <button class="btn" onclick="exportJSON()">Export JSON</button>
    </div>
  </header>

  <main id="main">
    <div class="empty" id="loading">Waiting for data…</div>
  </main>
</div>

<script>
let _insights = null

window.addEventListener('message', (e) => {
  if (e.data?.type === 'vl-insights') {
    _insights = e.data.data
    render(_insights)
  }
})

function fmt(n, decimals = 0) {
  if (n === undefined || n === null) return '—'
  return Number(n).toFixed(decimals)
}
function pct(n) { return (n * 100).toFixed(1) + '%' }
function ms(n)  { return n < 1000 ? n + 'ms' : (n/1000).toFixed(1) + 's' }
function usd(n) { return '$' + n.toFixed(4) }
function tsLabel(ts) {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function render(d) {
  document.getElementById('loading')?.remove()
  document.getElementById('computed-ts').textContent =
    'Updated ' + new Date(d.computed).toLocaleTimeString()

  const main = document.getElementById('main')
  main.innerHTML = ''

  // ── KPI row ──
  const learnedPct = pct(d.learnedRatio)
  main.insertAdjacentHTML('beforeend', \`
    <div class="kpi-row">
      <div class="kpi">
        <div class="kpi-label">Total Commands</div>
        <div class="kpi-value">\${d.totalCommands}</div>
        <div class="kpi-sub">\${d.sessions.total} sessions · \${fmt(d.sessions.avgCommandsPerSession,1)} avg/session</div>
      </div>
      <div class="kpi kpi-green">
        <div class="kpi-label">Success Rate</div>
        <div class="kpi-value">\${pct(d.successRate)}</div>
        <div class="kpi-sub">of commands executed</div>
      </div>
      <div class="kpi kpi-blue">
        <div class="kpi-label">Avg Latency</div>
        <div class="kpi-value">\${ms(d.avgLatencyMs)}</div>
        <div class="kpi-sub">voice-to-action total</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">AI-Free Rate</div>
        <div class="kpi-value" style="color:var(--accent)">\${learnedPct}</div>
        <div class="kpi-sub">\${d.learningStore.commandsSavedFromAI} commands skipped AI</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Est. Cost</div>
        <div class="kpi-value" style="color:var(--orange)">\${usd(d.estimatedCostUSD)}</div>
        <div class="kpi-sub">\${usd(d.learningStore.estimatedCostSaved)} saved by learning</div>
      </div>
    </div>
  \`)

  // ── Volume + Source ──
  const tsData = d.timeSeries.slice(-48)   // last 48 hours
  main.insertAdjacentHTML('beforeend', '<div class="charts-row"><div class="chart-card" id="vol-card"><div class="chart-title">Command Volume (48h)</div><div class="chart-wrap"><canvas id="vol-chart" height="130"></canvas></div></div><div class="chart-card" id="src-card"><div class="chart-title">Resolution Source</div><div class="chart-wrap"><canvas id="src-chart" height="130"></canvas></div></div></div>')

  new Chart(document.getElementById('vol-chart'), {
    type: 'bar',
    data: {
      labels: tsData.map(p => tsLabel(p.ts)),
      datasets: [
        { label: 'AI', data: tsData.map(p => p.aiCalls), backgroundColor: '#6c63ff', stack: 'a' },
        { label: 'Learned', data: tsData.map(p => p.learnedCalls), backgroundColor: '#22c55e', stack: 'a' },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#7b7f93', boxWidth: 10, font: { size: 10 } } } },
      scales: {
        x: { stacked: true, ticks: { color: '#7b7f93', font: { size: 9 }, maxRotation: 0, maxTicksLimit: 8 }, grid: { color: '#2a2d3a' } },
        y: { stacked: true, ticks: { color: '#7b7f93', font: { size: 10 } }, grid: { color: '#2a2d3a' } }
      }
    }
  })

  const src = d.stats.bySource
  new Chart(document.getElementById('src-chart'), {
    type: 'doughnut',
    data: {
      labels: ['Claude AI', 'Learned', 'Local Extract'],
      datasets: [{ data: [src.ai, src.learned, src.local_extract], backgroundColor: ['#6c63ff','#22c55e','#3b82f6'], borderWidth: 0, hoverOffset: 4 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: { position: 'bottom', labels: { color: '#7b7f93', boxWidth: 10, font: { size: 10 }, padding: 12 } }
      }
    }
  })

  // ── Language + Success rate + Latency breakdown ──
  main.insertAdjacentHTML('beforeend', '<div class="charts-row-3"><div class="chart-card"><div class="chart-title">Language Split</div><canvas id="lang-chart" height="120"></canvas></div><div class="chart-card"><div class="chart-title">Success Rate (48h)</div><canvas id="sr-chart" height="120"></canvas></div><div class="chart-card"><div class="chart-title">Action Types</div><canvas id="action-chart" height="120"></canvas></div></div>')

  const lang = d.stats.byLang
  new Chart(document.getElementById('lang-chart'), {
    type: 'doughnut',
    data: {
      labels: ['Hindi', 'English', 'Mixed', 'Unknown'],
      datasets: [{ data: [lang.hi, lang.en, lang.mixed, lang.unknown], backgroundColor: ['#f97316','#3b82f6','#a855f7','#7b7f93'], borderWidth: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '60%',
      plugins: { legend: { position: 'bottom', labels: { color: '#7b7f93', boxWidth: 10, font: { size: 10 }, padding: 10 } } }
    }
  })

  new Chart(document.getElementById('sr-chart'), {
    type: 'line',
    data: {
      labels: tsData.map(p => tsLabel(p.ts)),
      datasets: [{ label: 'Success %', data: tsData.map(p => (p.successRate * 100).toFixed(1)),
        borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.1)', tension: 0.4, fill: true, pointRadius: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#7b7f93', font: { size: 9 }, maxTicksLimit: 6, maxRotation: 0 }, grid: { color: '#2a2d3a' } },
        y: { min: 0, max: 100, ticks: { color: '#7b7f93', font: { size: 10 } }, grid: { color: '#2a2d3a' } }
      }
    }
  })

  const actions = d.stats.byAction
  const aKeys   = Object.keys(actions).sort((a,b) => actions[b]-actions[a]).slice(0,7)
  new Chart(document.getElementById('action-chart'), {
    type: 'bar',
    data: {
      labels: aKeys,
      datasets: [{ data: aKeys.map(k => actions[k]), backgroundColor: '#6c63ff', borderRadius: 4 }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#7b7f93', font: { size: 10 } }, grid: { color: '#2a2d3a' } },
        y: { ticks: { color: '#7b7f93', font: { size: 10 } }, grid: { display: false } }
      }
    }
  })

  // ── Latency breakdown ──
  main.insertAdjacentHTML('beforeend', \`
    <div class="latency-row">
      <div class="lat-card">
        <div class="lat-label">Whisper (Speech → Text)</div>
        <div class="lat-value" style="color:var(--blue)">\${ms(d.stats.avgWhisperMs)}</div>
        <div class="lat-sub">avg transcription time</div>
      </div>
      <div class="lat-card">
        <div class="lat-label">Claude (Intent)</div>
        <div class="lat-value" style="color:var(--accent)">\${ms(d.stats.avgAiMs)}</div>
        <div class="lat-sub">avg AI response time</div>
      </div>
      <div class="lat-card">
        <div class="lat-label">Total Voice → Action</div>
        <div class="lat-value" style="color:var(--green)">\${ms(d.stats.avgTotalMs)}</div>
        <div class="lat-sub">end-to-end</div>
      </div>
    </div>
  \`)

  // ── Top commands + Top failures ──
  main.insertAdjacentHTML('beforeend', '<div class="tables-row"><div class="chart-card" id="top-cmd-card"><div class="chart-title">Top Commands</div></div><div class="chart-card" id="top-fail-card"><div class="chart-title">Top Failures</div></div></div>')

  const cmdCard  = document.getElementById('top-cmd-card')
  const failCard = document.getElementById('top-fail-card')

  if (d.topCommands.length === 0) {
    cmdCard.insertAdjacentHTML('beforeend', '<div class="empty">No commands yet</div>')
  } else {
    const rows = d.topCommands.map(c => {
      const sr  = (c.successRate * 100).toFixed(0)
      const col = c.successRate > .8 ? '#22c55e' : c.successRate > .5 ? '#f97316' : '#ef4444'
      return \`<tr>
        <td class="route">\${c.route}</td>
        <td style="color:var(--muted)">\${c.action}</td>
        <td>\${c.count}</td>
        <td><div style="display:flex;align-items:center;gap:6px"><div class="success-bar"><div class="success-fill" style="width:\${sr}%;background:\${col}"></div></div><span style="font-size:10px;color:\${col}">\${sr}%</span></div></td>
      </tr>\`
    }).join('')
    cmdCard.insertAdjacentHTML('beforeend',
      '<table><thead><tr><th>Route</th><th>Action</th><th>Count</th><th>Success</th></tr></thead><tbody>' + rows + '</tbody></table>')
  }

  if (d.topFailures.length === 0) {
    failCard.insertAdjacentHTML('beforeend', '<div class="empty">No failures 🎉</div>')
  } else {
    const rows = d.topFailures.map(f => \`<tr>
      <td class="route">\${f.route}</td>
      <td style="color:var(--red);font-family:monospace;font-size:11px">\${f.errorCode}</td>
      <td style="color:var(--red);font-weight:700">\${f.count}</td>
    </tr>\`).join('')
    failCard.insertAdjacentHTML('beforeend',
      '<table><thead><tr><th>Route</th><th>Error</th><th>Count</th></tr></thead><tbody>' + rows + '</tbody></table>')
  }

  // ── Learning store ──
  const ls = d.learningStore
  main.insertAdjacentHTML('beforeend', \`
    <div class="chart-card" style="margin-bottom:18px">
      <div class="chart-title">Learning Store</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding-top:4px">
        <div><div style="font-size:10px;color:var(--muted);margin-bottom:4px">TOTAL MAPPINGS</div><div style="font-size:22px;font-weight:700">\${ls.totalMappings}</div></div>
        <div><div style="font-size:10px;color:var(--muted);margin-bottom:4px">CONFIDENT (≥3 uses)</div><div style="font-size:22px;font-weight:700;color:var(--green)">\${ls.confidentMappings}</div></div>
        <div><div style="font-size:10px;color:var(--muted);margin-bottom:4px">AI CALLS SAVED</div><div style="font-size:22px;font-weight:700;color:var(--accent)">\${ls.commandsSavedFromAI}</div></div>
        <div><div style="font-size:10px;color:var(--muted);margin-bottom:4px">COST SAVED</div><div style="font-size:22px;font-weight:700;color:var(--orange)">\${usd(ls.estimatedCostSaved)}</div></div>
      </div>
      <div style="margin-top:12px">
        <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden">
          <div style="height:100%;background:var(--accent);border-radius:3px;width:\${ls.totalMappings ? Math.min(100,(ls.confidentMappings/ls.totalMappings)*100) : 0}%;transition:width .6s ease"></div>
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:4px">\${ls.totalMappings ? ((ls.confidentMappings/ls.totalMappings)*100).toFixed(0) : 0}% of mappings are confident — target 80%</div>
      </div>
    </div>
  \`)
}

function exportCSV() {
  window.parent.postMessage({ type: 'vl-export', format: 'csv' }, '*')
}
function exportJSON() {
  window.parent.postMessage({ type: 'vl-export', format: 'json' }, '*')
}
<\/script>
</body>
</html>`
