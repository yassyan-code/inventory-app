import { supabase } from './supabaseClient'

// 運営用 API を叩く。運営者でなければ 403（呼び出し側で握りつぶしてタブを出さない）。
export async function fetchAdminOverview() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('未ログインです')

  const res = await fetch('/api/admin-overview', {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (res.status === 403) {
    const err = new Error('forbidden')
    err.code = 'forbidden'
    throw err
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `取得に失敗しました (${res.status})`)
  return body // { summary, teams, recentAudit }
}
