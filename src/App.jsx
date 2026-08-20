import { useEffect, useState } from 'react'
import './App.css'
import { supabase } from './lib/supabaseClient'
import Auth from './components/Auth'
import RegisterPanel from './components/RegisterPanel'
import InventoryList from './components/InventoryList'
import ChatPanel from './components/ChatPanel'

const TABS = {
  SCAN: 'scan',
  LIST: 'list',
  CHAT: 'chat',
}

function App() {
  const [session, setSession] = useState(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [tab, setTab] = useState(TABS.SCAN)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setCheckingSession(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  if (checkingSession) {
    return <div className="app-loading">読み込み中...</div>
  }

  if (!session) {
    return (
      <div className="app-shell app-shell--centered">
        <h1>在庫管理アプリ</h1>
        <Auth />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>
          📦 在庫管理アプリ <span className="app-subtitle">for Team</span>
        </h1>
        <button className="secondary" onClick={() => supabase.auth.signOut()}>
          ログアウト
        </button>
      </header>

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
          <RegisterPanel onChanged={() => setRefreshKey((k) => k + 1)} />
        )}
        {tab === TABS.LIST && <InventoryList refreshKey={refreshKey} />}
        {tab === TABS.CHAT && <ChatPanel />}
      </main>
    </div>
  )
}

export default App
