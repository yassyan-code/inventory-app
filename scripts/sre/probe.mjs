// 第66課題 ②: 本番を外から測る（可観測性の入り口）。1回の測定を data/probes.jsonl に1行ずつ足す。
// 実行: node scripts/sre/probe.mjs [--count 回数] [--interval 秒]
// 触るのは GET だけ。認証キーは使わない（Supabase は鍵なしで 401 を返す = 生きている証拠）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const DATA_FILE = path.join(here, 'data', 'probes.jsonl')

export const TARGETS = [
  { id: 'web', url: process.env.PROBE_WEB_URL ?? 'https://inventory-app-production-64fe.up.railway.app/', ok: (s) => s === 200 },
  { id: 'data', url: process.env.PROBE_DATA_URL ?? 'https://noygjyxinkriupwequvt.supabase.co/rest/v1/', ok: (s) => s === 200 || s === 401 },
]
const TIMEOUT_MS = 10000

export async function probeOnce(target, fetchFn = fetch) {
  const t = Date.now()
  const start = performance.now()
  try {
    const res = await fetchFn(target.url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' })
    return { t, id: target.id, ok: target.ok(res.status), status: res.status, ms: Math.round(performance.now() - start) }
  } catch (e) {
    return { t, id: target.id, ok: false, status: 0, ms: Math.round(performance.now() - start), error: String(e?.name ?? e) }
  }
}

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? Number(process.argv[i + 1]) : def
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const count = arg('count', 1)
  const interval = arg('interval', 60)
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
  for (let i = 0; i < count; i++) {
    const rows = await Promise.all(TARGETS.map((t) => probeOnce(t)))
    fs.appendFileSync(DATA_FILE, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
    console.log(rows.map((r) => `${r.id}:${r.ok ? 'OK' : 'NG'}(${r.status}, ${r.ms}ms)`).join('  '))
    if (i < count - 1) await new Promise((r) => setTimeout(r, interval * 1000))
  }
}
