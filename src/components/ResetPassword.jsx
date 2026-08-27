import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { toJapaneseAuthError } from '../lib/authErrors'

// パスワード再設定メールのリンクから来たときに表示する画面。
// この時点で Supabase は一時的な recovery セッションを張っているので、
// updateUser でそのまま新パスワードを設定できる。
export default function ResetPassword({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setMessage(null)

    if (password !== confirm) {
      setMessage({ type: 'error', text: 'パスワードが一致しません。' })
      return
    }

    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setMessage({ type: 'info', text: 'パスワードを更新しました。新しいパスワードでログインしてください。' })
      await supabase.auth.signOut()
      // URL に残った recovery トークンを消してからログイン画面へ戻す
      setTimeout(() => onDone?.(), 1500)
    } catch (err) {
      setMessage({ type: 'error', text: toJapaneseAuthError(err) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-form">
      <h2>新しいパスワードの設定</h2>
      <form onSubmit={handleSubmit}>
        <label>
          新しいパスワード
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={6}
          />
        </label>
        <label>
          新しいパスワード（確認）
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            minLength={6}
          />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? '更新中...' : 'パスワードを更新する'}
        </button>
      </form>
      {message && (
        <p className={message.type === 'error' ? 'message message--error' : 'message'}>
          {message.text}
        </p>
      )}
    </div>
  )
}
