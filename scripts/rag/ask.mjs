// 使い方: node --env-file=../../.env ask.mjs "質問"
import { openDb } from './lib.mjs'
import { answer, newClient } from './rag.mjs'

const question = process.argv.slice(2).join(' ')
if (!question) { console.error('質問を指定してください'); process.exit(1) }

const db = await openDb()
const r = await answer(db, newClient(), question)

console.log(`質問: ${r.question}\n`)
console.log('探して見つけた資料(近い順):')
r.chunks.forEach((c, i) => console.log(`  [${i + 1}] ${c.similarity.toFixed(3)}  ${c.source} / ${c.heading}`))
const label = r.grounded ? '' : r.found ? '（根拠が原文と合わない。採用しない）' : '（資料に答えなし）'
console.log(`\n答え${label}: ${r.answer}\n`)
console.log('根拠:')
if (r.checks.length === 0) console.log('  (なし)')
for (const c of r.checks) console.log(`  ${c.ok ? '✓ 原文と一致' : '✗ 原文にない'}  [${c.chunk}] ${c.source ?? '?'} / ${c.heading ?? '?'}\n      「${c.quote}」`)
