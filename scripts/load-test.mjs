// 第58課題: スケールの壁を調べるための簡易負荷実験スクリプト。
//
// 使い方: node scripts/load-test.mjs
// 対象: .env の VITE_SUPABASE_URL（通常はstaging）と、Railway本番の静的配信。
// 同時リクエスト数を増やしながら、以下3経路のレイテンシ・エラー率を計測する。
//   1. static  : Railway本番の静的ファイル配信（対照群。詰まらないはずの経路）
//   2. read    : Supabase REST経由のproducts読み取り（RLSポリシー評価を含む）
//   3. write   : log_client_error RPC（error_logs用の全体レート制限カウンタに書き込む経路）
//
// 注意: staging環境に対してのみ実行すること。write経路はerror_logsにテスト行を
// 作るため、実行後にクリーンアップのSQLを案内する（SUPABASE_SERVICE_ROLE_KEYが
// .envにあれば自動で削除する）。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadEnv() {
  const text = readFileSync(join(__dirname, '..', '.env'), 'utf8')
  const env = {}
  for (const line of text.split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (m) env[m[1]] = m[2]
  }
  return env
}

const env = loadEnv()
const SUPABASE_URL = env.VITE_SUPABASE_URL
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const STATIC_URL = process.env.STATIC_URL || 'https://inventory-app-production-64fe.up.railway.app/'

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が.envに見つかりません')
  process.exit(1)
}

async function timed(fn) {
  const t0 = performance.now()
  try {
    const res = await fn()
    await res.text() // ボディまで読み切ってから計測終了(実際の応答完了時間にするため)
    return { ms: performance.now() - t0, status: res.status, ok: res.ok }
  } catch (e) {
    return { ms: performance.now() - t0, status: 0, ok: false, error: String(e) }
  }
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

async function runBurst(name, concurrency, fn) {
  const results = await Promise.all(Array.from({ length: concurrency }, () => timed(fn)))
  const ms = results.map((r) => r.ms)
  const statusCounts = {}
  for (const r of results) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1
  const line = `[${name}] n=${concurrency}\tp50=${percentile(ms, 50).toFixed(0)}ms\tp95=${percentile(ms, 95).toFixed(0)}ms\tmax=${Math.max(...ms).toFixed(0)}ms\tstatuses=${JSON.stringify(statusCounts)}`
  console.log(line)
  return { name, concurrency, p50: percentile(ms, 50), p95: percentile(ms, 95), max: Math.max(...ms), statusCounts }
}

const reads = () =>
  fetch(`${SUPABASE_URL}/rest/v1/products?select=id,name&limit=5`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  })

const writes = () =>
  fetch(`${SUPABASE_URL}/rest/v1/rpc/log_client_error`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_source: 'load-test',
      p_message: `load-test ${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }),
  })

const statics = () => fetch(STATIC_URL)

const levels = [10, 30, 60, 100]

async function main() {
  console.log('=== 1. static（Railway本番・対照群） ===')
  for (const c of levels) await runBurst('static', c, statics)

  console.log('\n=== 2. read（Supabase REST・RLS評価込み） ===')
  for (const c of levels) await runBurst('read', c, reads)

  console.log('\n=== 3. write（log_client_error RPC・全体レート制限あり） ===')
  for (const c of levels) await runBurst('write', c, writes)

  if (SERVICE_ROLE_KEY) {
    console.log('\n後片付け: error_logsのload-test行を削除します…')
    const res = await fetch(`${SUPABASE_URL}/rest/v1/error_logs?source=eq.load-test`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    })
    console.log(`削除結果: ${res.status}`)
  } else {
    console.log('\nSUPABASE_SERVICE_ROLE_KEYが無いため自動削除はスキップしました。')
    console.log("手動で削除する場合: delete from error_logs where source = 'load-test';")
  }
}

main()
