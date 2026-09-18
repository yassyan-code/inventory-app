import { useState } from 'react'
import { startCheckout, openBillingPortal } from '../lib/billing'

// ヘッダーに出すプラン表示＋操作ボタン。
// - 無料 + 管理者 → 「Proにアップグレード」(Stripe Checkoutへ)
// - Pro + 管理者   → 「プラン管理」(Stripeカスタマーポータルへ)
// - 一般ユーザー   → バッジのみ
export default function PlanControls({ membership }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!membership) return null

  const { isPro, isAdmin, pastDue, scheduledCancel } = membership

  const statusLabel = pastDue ? '支払い確認中' : scheduledCancel ? '解約予定' : null

  const handle = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <span className="plan-controls">
      <span className={isPro ? 'plan-badge plan-badge--pro' : 'plan-badge'}>
        {isPro ? 'Pro' : '無料プラン'}
      </span>
      {statusLabel && (
        <span className={pastDue ? 'plan-badge plan-badge--alert' : 'plan-badge'}>
          {statusLabel}
        </span>
      )}

      {isAdmin && !isPro && (
        <button className="link" onClick={() => handle(startCheckout)} disabled={busy}>
          {busy ? '処理中...' : 'Proにアップグレード'}
        </button>
      )}
      {isAdmin && isPro && (
        <button className="link" onClick={() => handle(openBillingPortal)} disabled={busy}>
          {busy ? '処理中...' : 'プラン管理'}
        </button>
      )}

      {error && <span className="plan-controls__error">{error}</span>}
    </span>
  )
}
