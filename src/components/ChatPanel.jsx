import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { getAiChatUsage, PLAN_LIMITS } from '../lib/plan'
import UpsellNote from './UpsellNote'

const MAX_MESSAGE_LENGTH = 2000
const FREE_LIMIT = PLAN_LIMITS.free.aiChatPerMonth

export default function ChatPanel({ membership }) {
  const [messages, setMessages] = useState([]) // [{ role: 'user' | 'assistant', content: string }]
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  // 「考え中...」は最初のトークンが届くまでだけ表示する（届いた後は本文が伸びていく様子で分かる）
  const [waitingFirstToken, setWaitingFirstToken] = useState(false)
  const [error, setError] = useState('')
  const [usage, setUsage] = useState(null) // { count, limit } / limit=null は無制限
  const [quotaHit, setQuotaHit] = useState(false)

  const isPro = membership?.isPro ?? false
  const teamId = membership?.teamId

  // 初回に今月の利用回数を取得（無料プランのみ表示）
  useEffect(() => {
    if (!teamId || isPro) return
    getAiChatUsage(teamId).then((count) => setUsage({ count, limit: FREE_LIMIT }))
  }, [teamId, isPro])

  const handleSubmit = async (e) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return
    if (text.length > MAX_MESSAGE_LENGTH) {
      setError(`メッセージは${MAX_MESSAGE_LENGTH}文字以内で入力してください（現在${text.length}文字）`)
      return
    }

    const nextMessages = [...messages, { role: 'user', content: text }]
    setMessages(nextMessages)
    setInput('')
    setLoading(true)
    setWaitingFirstToken(true)
    setError('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ messages: nextMessages }),
      })

      // 認証/レート制限/利用枠エラーはここでJSONとして即返る（ストリーミング開始前）
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (res.status === 429 && data.code === 'quota_exceeded') {
          setQuotaHit(true)
          if (data.usage) setUsage(data.usage)
          // 直前に足したユーザー発言は残す（送信済み扱い）
          return
        }
        throw new Error(data.error || `サーバーエラー (${res.status})`)
      }

      // ここからは検証を通過した本番の応答＝SSE。生成できた分から順に描画し、
      // 最初の一文字が届いた時点で「考え中...」を消す（=画面を止めない）。
      let assistantText = ''
      let addedBubble = false
      let buffer = ''
      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const event of events) {
          if (!event.startsWith('data: ')) continue
          const payload = JSON.parse(event.slice(6))

          if (payload.delta) {
            assistantText += payload.delta
            if (!addedBubble) {
              addedBubble = true
              setWaitingFirstToken(false)
              setMessages((prev) => [...prev, { role: 'assistant', content: assistantText }])
            } else {
              setMessages((prev) => {
                const next = [...prev]
                next[next.length - 1] = { role: 'assistant', content: assistantText }
                return next
              })
            }
          } else if (payload.usage) {
            setUsage(payload.usage)
          } else if (payload.error) {
            throw new Error(payload.error)
          }
        }
      }
    } catch (err) {
      setError('エラー: ' + err.message)
    } finally {
      setLoading(false)
      setWaitingFirstToken(false)
    }
  }

  const showUsage = !isPro && usage && usage.limit != null
  const remaining = showUsage ? Math.max(0, usage.limit - usage.count) : null

  return (
    <div className="chat-panel">
      {showUsage && (
        <p className="chat-usage">
          今月のAIチャット: {usage.count} / {usage.limit} 回
          {remaining <= 5 && remaining > 0 && `（残り${remaining}回）`}
        </p>
      )}

      <div className="chat-messages">
        {messages.length === 0 && (
          <p className="chat-empty">アプリの使い方など、何でも質問してください。</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble chat-bubble--${m.role}`}>
            <span className="chat-bubble__label">{m.role === 'user' ? 'あなた' : 'AI'}</span>
            <p>{m.content}</p>
          </div>
        ))}
        {waitingFirstToken && <p className="chat-empty">考え中...</p>}
      </div>

      {quotaHit && (
        <UpsellNote
          isAdmin={membership?.isAdmin}
          message={`今月の無料利用枠（${FREE_LIMIT}回）を使い切りました。ProにアップグレードするとAIチャットが無制限になります。`}
        />
      )}

      {error && <p className="message">{error}</p>}

      <form className="chat-input" onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={quotaHit ? '今月の無料枠は上限です' : 'メッセージを入力'}
          maxLength={MAX_MESSAGE_LENGTH}
          disabled={loading || quotaHit}
        />
        <button type="submit" disabled={loading || quotaHit || !input.trim()}>
          送信
        </button>
      </form>
    </div>
  )
}
