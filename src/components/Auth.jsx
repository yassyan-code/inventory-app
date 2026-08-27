import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { toJapaneseAuthError } from '../lib/authErrors'

const MODE = {
  LOGIN: 'login',
  SIGNUP: 'signup',
  FORGOT: 'forgot',
}

// パスワード再設定メールの戻り先。開くと App 側が recovery を検知して再設定画面を出す。
const RESET_REDIRECT = `${window.location.origin}${window.location.pathname}`

export default function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState(MODE.LOGIN)
  const [message, setMessage] = useState(null) // { type: 'error' | 'info', text }
  const [loading, setLoading] = useState(false)
  // 未確認メールでログインに失敗したとき、確認メール再送ボタンを出すためのフラグ
  const [showResend, setShowResend] = useState(false)

  const resetFeedback = () => {
    setMessage(null)
    setShowResend(false)
  }

  const switchMode = (next) => {
    setMode(next)
    resetFeedback()
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    resetFeedback()
    try {
      if (mode === MODE.LOGIN) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) {
          if (/email not confirmed/i.test(error.message)) setShowResend(true)
          throw error
        }
        // 成功時は App の onAuthStateChange が画面を切り替える
      } else if (mode === MODE.SIGNUP) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: RESET_REDIRECT },
        })
        if (error) throw error
        setMessage({
          type: 'info',
          text: '確認メールを送信しました。メール内のリンクを開いてから、ログインしてください。',
        })
      } else if (mode === MODE.FORGOT) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: RESET_REDIRECT,
        })
        if (error) throw error
        // 登録有無を問わず同じ文言（アカウントの存在を漏らさない）
        setMessage({
          type: 'info',
          text: 'そのメールアドレスが登録されていれば、パスワード再設定用のリンクを送信しました。メールをご確認ください。',
        })
      }
    } catch (err) {
      setMessage({ type: 'error', text: toJapaneseAuthError(err) })
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setLoading(true)
    resetFeedback()
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: RESET_REDIRECT },
      })
      if (error) throw error
      setMessage({ type: 'info', text: '確認メールを再送しました。メールをご確認ください。' })
    } catch (err) {
      setMessage({ type: 'error', text: toJapaneseAuthError(err) })
    } finally {
      setLoading(false)
    }
  }

  const titles = {
    [MODE.LOGIN]: 'ログイン',
    [MODE.SIGNUP]: 'アカウント作成',
    [MODE.FORGOT]: 'パスワード再設定',
  }

  return (
    <div className="auth-form">
      <h2>{titles[mode]}</h2>
      <form onSubmit={handleSubmit}>
        <label>
          メールアドレス
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        {mode !== MODE.FORGOT && (
          <label>
            パスワード
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === MODE.LOGIN ? 'current-password' : 'new-password'}
              required
              minLength={6}
            />
          </label>
        )}
        <button type="submit" disabled={loading}>
          {loading
            ? '処理中...'
            : mode === MODE.LOGIN
              ? 'ログイン'
              : mode === MODE.SIGNUP
                ? 'アカウント作成'
                : '再設定メールを送る'}
        </button>
      </form>

      {message && (
        <p className={message.type === 'error' ? 'message message--error' : 'message'}>
          {message.text}
        </p>
      )}

      {showResend && (
        <button className="secondary" onClick={handleResend} disabled={loading}>
          確認メールを再送する
        </button>
      )}

      <div className="auth-links">
        {mode === MODE.LOGIN && (
          <>
            <button className="link" type="button" onClick={() => switchMode(MODE.SIGNUP)}>
              アカウントを作成する
            </button>
            <button className="link" type="button" onClick={() => switchMode(MODE.FORGOT)}>
              パスワードを忘れた方
            </button>
          </>
        )}
        {mode !== MODE.LOGIN && (
          <button className="link" type="button" onClick={() => switchMode(MODE.LOGIN)}>
            ログインに戻る
          </button>
        )}
      </div>
    </div>
  )
}
