// 第66課題 ②: 測定の記録から SLI・エラーバジェットを計算し、文字と画面（HTML）で見える状態にする。
// 実行: node scripts/sre/report.mjs [--html docs/slo-dashboard.html]
import fs from 'node:fs'
import { DATA_FILE } from './probe.mjs'
import { evaluateAll, pct, STATUS_LABEL, WINDOW_MS } from './slo.mjs'

const records = fs.existsSync(DATA_FILE)
  ? fs.readFileSync(DATA_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : []
const now = Date.now()
const results = evaluateAll(records, now)
const span = records.length ? { from: Math.min(...records.map((r) => r.t)), to: Math.max(...records.map((r) => r.t)) } : null
const fmtTime = (t) => new Date(t).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })

const lat = (id) => {
  const ms = records.filter((r) => r.id === id && r.ok).map((r) => r.ms).sort((a, b) => a - b)
  return ms.length ? { p50: ms[Math.floor(ms.length * 0.5)], p95: ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.95))], max: ms.at(-1) } : null
}

// ---- 文字の出力 ----
console.log(`測定 ${records.length}件${span ? `（${fmtTime(span.from)} 〜 ${fmtTime(span.to)}）` : ''}  評価期間: 直近${WINDOW_MS / 86400000}日\n`)
for (const r of results) {
  console.log(`■ ${r.label}  目標 ${pct(r.target, 1)}`)
  console.log(`   SLI ${pct(r.sli)}（良 ${r.good} / 全 ${r.total}、失敗 ${r.bad}）  バジェット残り ${r.budgetLeft === -Infinity ? '超過' : pct(r.budgetLeft, 0)}`)
  console.log(`   燃焼率 1時間 ${r.fast.rate.toFixed(1)}倍 / 6時間 ${r.slow.rate.toFixed(1)}倍  → ${STATUS_LABEL[r.status]}: ${r.action}`)
}
for (const id of ['web', 'data']) {
  const l = lat(id)
  if (l) console.log(`応答時間 ${id}: 中央値 ${l.p50}ms / p95 ${l.p95}ms / 最大 ${l.max}ms`)
}

// ---- 画面（自己完結のHTML）----
const i = process.argv.indexOf('--html')
if (i > 0) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const color = { ok: '#1a7f4b', warn: '#b7791f', page: '#c53030', freeze: '#c53030', nodata: '#6b7280' }
  const cards = results.map((r) => {
    const left = r.budgetLeft === -Infinity ? 0 : Math.max(0, Math.min(1, r.budgetLeft))
    return `<section class="card">
  <div class="head"><h2>${esc(r.label)}</h2><span class="badge" style="background:${color[r.status]}">${STATUS_LABEL[r.status]}</span></div>
  <div class="big">${pct(r.sli)} <small>目標 ${pct(r.target, 1)}</small></div>
  <div class="bar" role="img" aria-label="エラーバジェット残り ${pct(left, 0)}"><i style="width:${left * 100}%;background:${color[r.status]}"></i></div>
  <p class="meta">エラーバジェット残り ${pct(left, 0)}（失敗 ${r.bad} / 許容 ${r.allowedBad.toFixed(1)}）</p>
  <p class="meta">燃焼率 1時間 ${r.fast.rate.toFixed(1)}倍 ・ 6時間 ${r.slow.rate.toFixed(1)}倍</p>
  <p class="act">${esc(r.action)}</p>
</section>`
  }).join('\n')
  const recent = records.slice(-40)
  const max = Math.max(1000, ...recent.map((r) => r.ms))
  const spark = (id) => `<div class="spark">${recent.filter((r) => r.id === id).map((r) => `<i title="${fmtTime(r.t)} ${r.ms}ms" style="height:${Math.max(4, (r.ms / max) * 100)}%;background:${r.ok ? '#3b82f6' : '#c53030'}"></i>`).join('')}</div>`
  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SLO ダッシュボード</title>
<style>
:root{--bg:#f6f7f9;--fg:#1f2937;--card:#fff;--line:#e5e7eb;--sub:#6b7280}
@media (prefers-color-scheme:dark){:root{--bg:#111827;--fg:#f3f4f6;--card:#1f2937;--line:#374151;--sub:#9ca3af}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,"Hiragino Sans","Yu Gothic",sans-serif}
main{max-width:860px;margin:0 auto}h1{font-size:20px;margin:0 0 4px}.sub{color:var(--sub);margin:0 0 20px;font-size:13px}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}h2{font-size:14px;margin:0}
.badge{color:#fff;border-radius:99px;padding:1px 10px;font-size:12px;white-space:nowrap}
.big{font-size:30px;font-weight:700;margin:8px 0}.big small{font-size:12px;color:var(--sub);font-weight:400}
.bar{height:8px;background:var(--line);border-radius:4px;overflow:hidden}.bar i{display:block;height:100%}
.meta{margin:6px 0 0;font-size:12px;color:var(--sub)}.act{margin:8px 0 0;font-size:13px}
h3{font-size:14px;margin:24px 0 6px}.spark{display:flex;align-items:flex-end;gap:2px;height:60px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px}
.spark i{flex:1;min-width:2px;border-radius:2px}
</style></head><body><main>
<h1>SLO ダッシュボード</h1>
<p class="sub">測定 ${records.length}件${span ? `（${esc(fmtTime(span.from))} 〜 ${esc(fmtTime(span.to))}）` : ''} ／ 評価期間 直近${WINDOW_MS / 86400000}日 ／ 作成 ${esc(fmtTime(now))}</p>
<div class="grid">
${cards}
</div>
<h3>画面（web）の応答時間 — 直近の測定（棒の高さ=ms、赤=失敗）</h3>${spark('web')}
<h3>データ基盤（data）の応答時間</h3>${spark('data')}
</main></body></html>
`
  fs.writeFileSync(process.argv[i + 1], html)
  console.log(`\n画面を書き出しました: ${process.argv[i + 1]}`)
}
