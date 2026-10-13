// 第64課題 ③: 検索と根拠の確認を、小さな質問セットで測る。
// 質問は、資料の言い回しとわざと変えてある（意味で探せるかを見るため）。
// 実行: node --env-file=../../.env eval.mjs
import { openDb } from './lib.mjs'
import { answer, newClient, retrieve } from './rag.mjs'

// expect: 答えが載っている資料（正解になりうるものを全部）。null は「資料に無い質問」（答えてはいけない）
const CASES = [
  { q: 'データベースが休止状態になっていたとき、どうやって元に戻した？', expect: ['docs/spof.md'] },
  { q: '本番に自動で反映されなかった原因は？', expect: ['docs/postmortem-2026-10-06-railway-ci-deadlock.md'] },
  { q: '利用者が増えたとき、最初に拒否され始めたのはどこ？', expect: ['docs/scale-bottleneck.md'] },
  { q: '在庫を増やす処理は、通信を何回に減らす設計？', expect: ['docs/async-architecture.md'] },
  { q: '日次の集計は毎日何時に動く？', expect: ['docs/data-pipeline.md'] },
  { q: '別のチームの在庫が見えないようにしている仕組みは？', expect: ['docs/threat-model.md', 'docs/tenant-isolation-test.md', 'docs/architecture.md'] },
  { q: 'データを丸ごとバックアップしたいとき、どうする？', expect: ['docs/db-backup-restore.md'] },
  { q: '自分のドメインでサイトを開けるようにする方法は？', expect: ['docs/custom-domain.md'] },
  { q: 'ユーザーの権限の種類と、できることの違いは？', expect: ['docs/auth.md'] },
  { q: '商品名をAIに整えさせる機能の、間違いへの備えは？', expect: ['docs/ai-structured-output.md'] },
  // 資料に無い質問
  { q: '社長の誕生日はいつ？', expect: null },
  { q: 'このアプリの月額料金はいくら？', expect: null },
]

// 比較用の素朴な「言葉の一致」検索: 質問と資料に共通する2文字の並びの数で点をつける
const bigrams = (s) => {
  const t = s.replace(/[\s\p{P}\p{S}]/gu, '')
  return new Set(Array.from({ length: Math.max(0, t.length - 1) }, (_, i) => t.slice(i, i + 2)))
}
async function keywordTop(db, q, k) {
  const { rows } = await db.query('select source, heading, content from doc_chunks')
  const qb = bigrams(q)
  return rows
    .map((r) => ({ source: r.source, score: [...bigrams(r.heading + r.content)].filter((b) => qb.has(b)).length }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

const RETRIEVAL_ONLY = process.env.RETRIEVAL_ONLY === '1' // 検索だけ測る（AIを呼ばない）
const db = await openDb()
const client = RETRIEVAL_ONLY ? null : newClient()
let vecHit = 0, kwHit = 0, vecHit5 = 0, kwHit5 = 0, retries = 0, answerable = 0, grounded = 0, refused = 0, unanswerable = 0

for (const c of CASES) {
  const vec = await retrieve(db, c.q, 5)
  const kw = await keywordTop(db, c.q, 5)
  if (c.expect) {
    answerable++
    const has = (rows, n) => rows.slice(0, n).some((r) => c.expect.includes(r.source))
    vecHit += has(vec, 3); kwHit += has(kw, 3); vecHit5 += has(vec, 5); kwHit5 += has(kw, 5)
    if (RETRIEVAL_ONLY) {
      console.log(`${has(vec, 3) ? '○' : '×'}${has(kw, 3) ? '○' : '×'} ${c.q}`)
      continue
    }
    const r = await answer(db, client, c.q)
    retries += r.retried
    grounded += r.grounded
    const mark = (x) => (x ? 'あり ✓' : 'なし ✗')
    console.log(`Q: ${c.q}
   期待: ${c.expect[0]}${c.expect.length > 1 ? ' ほか' : ''}
   意味検索 上位3に${mark(has(vec, 3))}(上位5: ${mark(has(vec, 5))}) / 言葉の一致 上位3に${mark(has(kw, 3))}(上位5: ${mark(has(kw, 5))})
   根拠 ${r.grounded ? '原文と一致 ✓' : '✗ 採用しない'}${r.retried ? '（頼み直した）' : ''}
   答え: ${r.answer.slice(0, 90).replace(/\n/g, ' ')}
`)
  } else {
    if (RETRIEVAL_ONLY) continue
    unanswerable++
    const r = await answer(db, client, c.q)
    const ok = !r.found
    refused += ok
    console.log(`Q: ${c.q}\n   (資料に無い質問) ${ok ? '答えなかった ✓' : '答えてしまった ✗'}  答え: ${r.answer.slice(0, 90)}\n`)
  }
}
console.log('==== まとめ ====')
console.log(`検索(上位3に正解の資料): 意味検索 ${vecHit}/${answerable}  言葉の一致 ${kwHit}/${answerable}`)
console.log(`検索(上位5に正解の資料): 意味検索 ${vecHit5}/${answerable}  言葉の一致 ${kwHit5}/${answerable}`)
console.log(`根拠(答えが原文の引用つき): ${grounded}/${answerable}（頼み直し ${retries}回）`)
console.log(`資料に無い質問に「ない」と答えた: ${refused}/${unanswerable}`)
