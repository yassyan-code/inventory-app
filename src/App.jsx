import { useEffect, useState } from 'react'
import './App.css'
import { supabase } from './lib/supabaseClient'
import { getMyMembership } from './lib/inventory'
import { syncCheckout } from './lib/billing'
import Auth from './components/Auth'
import ResetPassword from './components/ResetPassword'
import RegisterPanel from './components/RegisterPanel'
import InventoryList from './components/InventoryList'
import ChatPanel from './components/ChatPanel'
import PlanControls from './components/PlanControls'

const TABS = {
  SCAN: 'scan',
  LIST: 'list',
  CHAT: 'chat',
}

// 再設定リンクで開かれたか（URL ハッシュに recovery トークンが載る）を初期判定する
function hasRecoveryInUrl() {
  return /type=recovery/.test(window.location.hash)
}

function App() {
  const [session, setSession] = useState(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [recovering, setRecovering] = useState(hasRecoveryInUrl())
  const [membership, setMembership] = useState(null)
  const [tab, setTab] = useState(TABS.SCAN)
  const [refreshKey, setRefreshKey] = useState(0)
  const [checkoutNotice, setCheckoutNotice] = useState(() =>
    new URLSearchParams(window.location.search).get('checkout')
  )

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setCheckingSession(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      // 再設定リンク経由。専用画面を出し、通常画面には入れない
      if (event === 'PASSWORD_RECOVERY') {
        setRecovering(true)
      }
      if (event === 'SIGNED_OUT') {
        setMembership(null)
        setRecovering(false)
      }
      setSession(newSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  // ログイン後に所属チーム・ロールを取得する
  useEffect(() => {
    if (!session || recovering) {
      setMembership(null)
      return
    }
    let cancelled = false
    getMyMembership()
      .then((m) => {
        if (!cancelled) setMembership(m)
      })
      .catch((err) => {
        console.warn('[membership] 取得に失敗:', err.message)
        if (!cancelled) setMembership(null)
      })
    return () => {
      cancelled = true
    }
  }, [session, recovering])

  // Stripe Checkout から戻ってきたときの処理。
  // 成功時は Webhook 反映に少しラグがあるので、Pro になるまで数回ポーリングする。
  useEffect(() => {
    if (!checkoutNotice) return
    window.history.replaceState(null, '', window.location.pathname)
    if (checkoutNotice !== 'success') return

    let cancelled = false
    ;(async () => {
      // まず Stripe 側の最新状態を teams に反映（Webhook 待ちに依存しない）
      try {
        await syncCheckout()
      } catch (err) {
        console.warn('[checkout-sync] 失敗:', err.message)
      }
      if (cancelled) return
      try {
        const m = await getMyMembership()
        if (cancelled) return
        setMembership(m)
        setCheckoutNotice(m.isPro ? 'done' : 'success')
      } catch {
        /* 次回のメンバーシップ取得で反映される */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [checkoutNotice])

  const finishRecovery = () => {
    // URL からトークンを除去してログイン画面へ
    window.history.replaceState(null, '', window.location.pathname)
    setRecovering(false)
  }

  if (checkingSession) {
    return <div className="app-loading">読み込み中...</div>
  }

  if (recovering) {
    return (
      <div className="app-shell app-shell--centered">
        <h1>在庫管理アプリ</h1>
        <ResetPassword onDone={finishRecovery} />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="app-shell app-shell--centered">
        <h1>在庫管理アプリ</h1>
        <Auth />
      </div>
    )
  }

  const isAdmin = membership?.isAdmin ?? false

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__title">
          <h1>
            📦 在庫管理アプリ <span className="app-subtitle">for Team</span>
          </h1>
          {membership && (
            <p className="app-team-line">
              <span className="app-team-name">{membership.teamName}</span>
              <span className={isAdmin ? 'role-badge role-badge--admin' : 'role-badge'}>
                {isAdmin ? '管理者' : '一般ユーザー'}
              </span>
              <PlanControls membership={membership} />
            </p>
          )}
        </div>
        <button className="secondary" onClick={() => supabase.auth.signOut()}>
          ログアウト
        </button>
      </header>

      {checkoutNotice === 'done' && (
        <div className="checkout-banner checkout-banner--success">
          🎉 Proプランへのアップグレードが完了しました。ありがとうございます！
        </div>
      )}
      {checkoutNotice === 'success' && (
        <div className="checkout-banner">決済を確認しています... 少しお待ちください。</div>
      )}
      {checkoutNotice === 'cancel' && (
        <div className="checkout-banner">アップグレードはキャンセルされました。</div>
      )}

      {membership?.pastDue && (
        <div className="checkout-banner checkout-banner--alert">
          お支払いを確認できませんでした。カードの有効期限などをご確認ください。
          {membership.isAdmin && 'ヘッダーの「プラン管理」から更新できます。'}
          このまま解決しないとPro機能は停止されます。
        </div>
      )}
      {membership?.scheduledCancel && !membership.pastDue && (
        <div className="checkout-banner">
          解約手続きが完了しています。
          {membership.currentPeriodEnd &&
            `${new Date(membership.currentPeriodEnd).toLocaleDateString('ja-JP')}まで`}
          Proプランをご利用いただけます。それ以降は無料プランに切り替わります（データは保持されます）。
        </div>
      )}

      <nav className="tabs">
        <button
          className={tab === TABS.SCAN ? 'active' : ''}
          onClick={() => setTab(TABS.SCAN)}
        >
          スキャン登録
        </button>
        <button
          className={tab === TABS.LIST ? 'active' : ''}
          onClick={() => setTab(TABS.LIST)}
        >
          在庫一覧
        </button>
        <button
          className={tab === TABS.CHAT ? 'active' : ''}
          onClick={() => setTab(TABS.CHAT)}
        >
          チャット
        </button>
      </nav>

      <main>
        {tab === TABS.SCAN && (
          <RegisterPanel isAdmin={isAdmin} onChanged={() => setRefreshKey((k) => k + 1)} />
        )}
        {tab === TABS.LIST && <InventoryList isAdmin={isAdmin} refreshKey={refreshKey} />}
        {tab === TABS.CHAT && <ChatPanel />}
      </main>

      <footer className="app-footer">CI/CD動作確認 v1</footer>
    </div>
  )
}

export default App
