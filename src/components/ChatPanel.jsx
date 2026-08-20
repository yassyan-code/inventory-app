import { useState } from 'react'

const MAX_MESSAGE_LENGTH = 2000

export default function ChatPanel() {
  const [messages, setMessages] = useState([]) // [{ role: 'user' | 'assistant', content: string }]
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
    setError('')

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
      })

      if (!res.ok) {
        throw new Error(`サーバーエラー (${res.status})`)
      }

      const data = await res.json()
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }])
    } catch (err) {
      setError('エラー: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="chat-panel">
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
        {loading && <p className="chat-empty">考え中...</p>}
      </div>

      {error && <p className="message">{error}</p>}

      <form className="chat-input" onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="メッセージを入力"
          maxLength={MAX_MESSAGE_LENGTH}
          disabled={loading}
        />
        <button type="submit" disabled={loading || !input.trim()}>
          送信
        </button>
      </form>
    </div>
  )
}
