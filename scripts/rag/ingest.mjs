// 第64課題 ①: docs/ を取り込む（チャンクに切る → 意味の数字にする → pgvectorに貯める）
// 実行: node ingest.mjs
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, chunkMarkdown, embed, openDb } from './lib.mjs'

const docsDir = path.join(ROOT, 'docs')
const files = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md')).sort()

const chunks = files.flatMap((f) => chunkMarkdown(`docs/${f}`, fs.readFileSync(path.join(docsDir, f), 'utf8')))
console.log(`資料 ${files.length}件 → チャンク ${chunks.length}個`)

const db = await openDb({ reset: true })
const t = Date.now()
for (const [i, c] of chunks.entries()) {
  // 見出し・題名つきで埋め込む（「何についての節か」も意味に含める）
  const e = await embed(`${c.title} > ${c.heading}\n${c.content}`, 'passage')
  await db.query('insert into doc_chunks (source, heading, content, embedding) values ($1,$2,$3,$4)', [
    c.source, c.heading, c.content, e,
  ])
  if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${chunks.length}`)
}
const { rows } = await db.query('select count(*)::int n from doc_chunks')
console.log(`貯めた: ${rows[0].n}行 (${((Date.now() - t) / 1000).toFixed(1)}秒)`)
