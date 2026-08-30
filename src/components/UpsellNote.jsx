import { useState } from 'react'
import { startCheckout } from '../lib/billing'

// 上限・ゲートに達したときに出すアップグレード導線。
// 管理者(owner)なら Checkout ボタン、一般ユーザーなら管理者へ相談を促す。
export default function UpsellNote({ message, isAdmin }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const upgrade = async () => {
    setBusy(true)
    setError('')
    try {
      await startCheckout()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="upsell-note">
      <p className="upsell-note__msg">🔒 {message}</p>
      {isAdmin ? (
        <button className="upsell-note__btn" onClick={upgrade} disabled={busy}>
          {busy ? '処理中...' : 'Proにアップグレード'}
        </button>
      ) : (
        <p className="upsell-note__hint">Proへの変更はチームの管理者に依頼してください。</p>
      )}
      {error && <p className="plan-controls__error">{error}</p>}
    </div>
  )
}
