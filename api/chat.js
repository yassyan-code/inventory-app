// Claude API を使ったチャット機能のサーバーレス関数(Vercel Functions)。
// APIキーはこのファイル(サーバー側)でのみ使用し、ブラウザには一切渡らない。
// フロントエンドは /api/chat に { messages: [...] } をPOSTするだけでよい。

import Anthropic from '@anthropic-ai/sdk'

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
