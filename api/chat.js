// Claude API を使ったチャット機能のサーバーレス関数(Vercel Functions)。
// APIキーはこのファイル(サーバー側)でのみ使用し、ブラウザには一切渡らない。
// フロントエンドは /api/chat に { messages: [...] } をPOSTする（要ログイン）。
//
// 第20回: メータリング。無料プランは AIチャット 月20回まで。
//   use_ai_chat_quota RPC で「チェック＋加算」を1回で行い、上限なら 429 を返す。

import Anthropic from '@anthropic-ai/sdk'
import { getUserTeam } from './_lib/clients.js'

const client = new Anthropic() // ANTHROPIC_API_KEY 環境変数から自動で読み込まれる

const SYSTEM_PROMPT =
  'あなたは在庫管理アプリに組み込まれたアシスタントです。バーコード登録・在庫数の増減・在庫一覧の使い方など、' +
  'このアプリの利用に関する質問に日本語で簡潔に答えてください。アプリと関係ない一般的な質問にも通常のアシスタントとして答えてかまいません。'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { messages } = req.body ?? {}
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages is required' })
    return
  }

  // ログイン必須（＋どのチームの利用枠を消費するか特定）
  const auth = await getUserTeam(req)
  if (auth.error) {
    res.status(auth.status).json({ error: auth.error })
    return
  }

  // 利用枠を1回消費（無料は月20回、Proは無制限）
  const { data: quota, error: quotaErr } = await auth.anon.rpc('use_ai_chat_quota', {
    p_team_id: auth.teamId,
  })
  if (quotaErr) {
    console.error('[api/chat] quota rpc error', quotaErr)
    res.status(500).json({ error: '利用枠の確認に失敗しました' })
    return
  }
  if (!quota.allowed) {
    res.status(429).json({
      error: 'quota_exceeded',
      code: 'quota_exceeded',
      usage: { count: quota.count, limit: quota.limit },
    })
    return
  }

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
    res.status(200).json({
      reply: textBlock?.text ?? '',
      usage: { count: quota.count, limit: quota.limit },
    })
  } catch (err) {
    console.error('[api/chat] エラー', err)
    res.status(500).json({ error: 'チャットの応答取得に失敗しました' })
  }
}
