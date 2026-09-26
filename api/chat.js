// Claude API を使ったチャット機能のサーバーレス関数(Vercel Functions)。
// APIキーはこのファイル(サーバー側)でのみ使用し、ブラウザには一切渡らない。
// フロントエンドは /api/chat に { messages: [...] } をPOSTするだけでよい。

import Anthropic from '@anthropic-ai/sdk'
import { createRateLimiter, getUserId, validateMessages } from './_lib/chatGuard.js'

const client = new Anthropic() // ANTHROPIC_API_KEY 環境変数から自動で読み込まれる

const SYSTEM_PROMPT =
  'あなたは在庫管理アプリに組み込まれたアシスタントです。バーコード登録・在庫数の増減・在庫一覧の使い方など、' +
  'このアプリの利用に関する質問に日本語で簡潔に答えてください。アプリと関係ない一般的な質問にも通常のアシスタントとして答えてかまいません。'

// 1ユーザーあたり 10分に20回まで
const limiter = createRateLimiter({ limit: 20, windowMs: 10 * 60 * 1000 })

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // 未ログインの第三者に Claude API（課金）を使わせない
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

  const checked = validateMessages(req.body?.messages)
  if (!checked.ok) {
    res.status(400).json({ error: checked.error })
    return
  }
  const { messages } = checked

  try {
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      // 通常のチャット用途なので思考は無効化し、応答速度・コストを抑える
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      messages,
    })

    const textBlock = response.content.find((block) => block.type === 'text')
    res.status(200).json({ reply: textBlock?.text ?? '' })
  } catch (err) {
    console.error('[api/chat] エラー', err)
    res.status(500).json({ error: 'チャットの応答取得に失敗しました' })
  }
}
