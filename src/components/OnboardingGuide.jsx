import { useEffect, useState } from 'react'
import { countProducts } from '../lib/inventory'

// 初めての顧客が「最初の成功＝最初の商品を登録」に迷わず着くための初回ガイド。
// 商品が1件でも登録されたら自動で引っ込む。手動で閉じたらそのチームでは以後出さない。
export default function OnboardingGuide({ teamId, refreshKey, onStartScan }) {
  const dismissKey = `onboard_dismissed_${teamId}`
  const [productCount, setProductCount] = useState(null)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(dismissKey) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    if (!teamId) return
    countProducts()
      .then(setProductCount)
      .catch(() => setProductCount(null))
  }, [teamId, refreshKey])

  if (dismissed || productCount === null) return null
  if (productCount > 0) return null // 「最初の成功」達成 → 表示しない

  const close = () => {
    try {
      localStorage.setItem(dismissKey, '1')
    } catch {
      /* localStorage 不可でも致命的でない */
    }
    setDismissed(true)
  }

  return (
    <div className="onboarding">
      <div className="onboarding__head">
        <strong>はじめての方へ — 3ステップで使い始められます</strong>
        <button className="onboarding__close" onClick={close} aria-label="閉じる">
          ×
        </button>
      </div>
      <ol className="onboarding__steps">
        <li>
          <b>商品を1つ登録する</b>：カメラかスキャナーでバーコードを読み取り、名前と数量を入力して登録。
          <button className="link" onClick={onStartScan}>
            スキャン登録を開く
          </button>
        </li>
        <li>
          <b>在庫を調整する</b>：登録後に出る画面の ＋1 / −1 で入出庫を記録。
        </li>
        <li>
          <b>一覧で確認する</b>：「在庫一覧」タブで検索・並び替え。Pro なら CSV も出せます。
        </li>
      </ol>
      <p className="onboarding__hint">最初の商品を登録すると、このガイドは自動で消えます。</p>
    </div>
  )
}
