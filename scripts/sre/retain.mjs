// 第72課題: 定期実行で貯まる probes.jsonl を、評価期間(30日)+余裕の分だけ残す。
// 実行: node scripts/sre/retain.mjs [--days 31]   （data/probes.jsonl をその場で書き換える）
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { DATA_FILE } from './probe.mjs'

// 壊れた行(途中で切れた等)は捨てる。1行の不良で全体を読めなくしないため
export function keepRecent(text, now, days = 31) {
  const limit = now - days * 24 * 60 * 60 * 1000
  return text
    .split('\n')
    .filter((line) => {
      if (!line) return false
      try {
        return JSON.parse(line).t >= limit
      } catch {
        return false
      }
    })
    .join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--days')
  const days = i > 0 ? Number(process.argv[i + 1]) : 31
  const kept = fs.existsSync(DATA_FILE) ? keepRecent(fs.readFileSync(DATA_FILE, 'utf8'), Date.now(), days) : ''
  fs.writeFileSync(DATA_FILE, kept ? kept + '\n' : '')
  console.log(`残した測定: ${kept ? kept.split('\n').length : 0}件`)
}
