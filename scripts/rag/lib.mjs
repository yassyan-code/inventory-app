// 第64課題: 小さなRAGの共通部品（埋め込み・DB）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from '@huggingface/transformers'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'

const here = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(here, '../..')
export const INDEX_DIR = path.join(here, '.index')
export const MIGRATION = path.join(ROOT, 'supabase', '012_doc_chunks.sql')

// 日本語を含む100言語に対応した小さな埋め込みモデル（384次元）。初回だけダウンロードされる
let extractor
async function getExtractor() {
  extractor ??= await pipeline('feature-extraction', process.env.RAG_MODEL ?? 'Xenova/multilingual-e5-small', { dtype: 'q8' })
  return extractor
}

// e5 は「質問(query:)」と「資料(passage:)」で接頭辞を変える決まり
export async function embed(text, kind) {
  const ext = await getExtractor()
  const out = await ext(`${kind}: ${text}`, { pooling: 'mean', normalize: true })
  return `[${Array.from(out.data).join(',')}]` // pgvector のリテラル形式
}

export async function openDb({ reset = false } = {}) {
  if (reset) fs.rmSync(INDEX_DIR, { recursive: true, force: true })
  const db = new PGlite(INDEX_DIR, { extensions: { vector } })
  const dim = process.env.RAG_DIM ?? '384' // モデルを変える実験用（既定は384次元のまま）
  await db.exec(fs.readFileSync(MIGRATION, 'utf8').replaceAll('vector(384)', `vector(${dim})`)) // 本物のマイグレーションをそのまま流す
  return db
}

// 資料を見出し(##)ごとのチャンクに切る。長い節は段落で分ける
const MAX_CHUNK = 900
export function chunkMarkdown(source, text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const title = (lines.find((l) => l.startsWith('# ')) ?? '# ' + source).replace(/^#\s+/, '')
  const sections = []
  let heading = title
  let buf = []
  let inFence = false
  const flush = () => {
    const body = buf.join('\n').trim()
    if (body) sections.push({ heading, body })
    buf = []
  }
  for (const line of lines) {
    if (line.startsWith('```')) inFence = !inFence
    if (!inFence && /^##\s+/.test(line)) {
      flush()
      heading = line.replace(/^##\s+/, '')
    } else if (!(line.startsWith('# ') && !inFence)) {
      buf.push(line)
    }
  }
  flush()

  const chunks = []
  for (const s of sections) {
    let cur = ''
    for (const para of s.body.split(/\n\s*\n/)) {
      if (cur && cur.length + para.length > MAX_CHUNK) {
        chunks.push({ source, title, heading: s.heading, content: cur.trim() })
        cur = ''
      }
      cur += para + '\n\n'
    }
    if (cur.trim()) chunks.push({ source, title, heading: s.heading, content: cur.trim() })
  }
  return chunks.filter((c) => c.content.length >= 30)
}
