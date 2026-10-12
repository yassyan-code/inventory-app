// 商品名の整形・カテゴリ提案API（Vercel Functions）。第63課題。
// APIキーはサーバー側でのみ使い、ブラウザには渡さない。
// 守り方は /api/chat と同じ: ログイン必須 → 回数制限 → 入力検証。

import Anthropic from '@anthropic-ai/sdk'
import { createRateLimiter, getUserId } from './_lib/chatGuard.js'
import { suggestProduct } from './_lib/suggestProduct.js'

const client = new Anthropic() // ANTHROPIC_API_KEY 環境変数から自動で読み込まれる

// 1ユーザーあたり 10分に30回まで（商品登録のたびに1回呼ぶ想定）
const limiter = createRateLimiter({ limit: 30, windowMs: 10 * 60 * 1000 })

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const userId = await getUserId(req.headers.authorization, {
    url: process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL,
    anonKey: process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY,
  })
  if (!userId) {
    res.status(401).json({ error: 'ログインが必要です' })
    return
  }

  if (!limiter.allow(userId)) {
    res.status(429).json({ error: '短時間に送信しすぎです。しばらくしてからお試しください' })
    return
  }

  try {
    const result = await suggestProduct(client, req.body)
    if (!result.ok) {
      // 入力が悪い(400)のか、AIの出力が使えない(502)のかを分ける
      res.status(result.kind === 'input' ? 400 : 502).json({ error: result.error })
      return
    }
    res.status(200).json(result.suggestion)
  } catch (err) {
    console.error('[api/suggest-product] エラー', err)
    res.status(500).json({ error: '提案の取得に失敗しました' })
  }
}
