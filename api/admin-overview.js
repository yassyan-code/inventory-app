// 運営用の管理ダッシュボードのデータ。
// ADMIN_EMAILS（カンマ区切り）に載っているユーザーだけがアクセスできる。
// 全テナントを横断して見るので service_role で集計する。

import { serviceClient, getUserTeam } from './_lib/clients.js'

function adminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

export default async function handler(req, res) {
  const auth = await getUserTeam(req)
  if (auth.error) {
    res.status(auth.status).json({ error: auth.error })
    return
  }

  const allow = adminEmails()
  if (allow.length === 0 || !allow.includes((auth.user.email || '').toLowerCase())) {
    // 運営者でなければ存在を悟らせない
    res.status(403).json({ error: 'forbidden' })
    return
  }

  const db = serviceClient()
  const period = new Date().toISOString().slice(0, 7) // YYYY-MM

  try {
    const [teamsRes, membersRes, productsRes, usageRes, auditRes] = await Promise.all([
      db.from('teams').select('id, name, plan, plan_status, cancel_at_period_end, current_period_end, created_at'),
      db.from('team_members').select('team_id, role'),
      db.from('products').select('team_id, archived_at'),
      db.from('usage_counters').select('team_id, count').eq('metric', 'ai_chat').eq('period', period),
      db.from('audit_log').select('team_id, action, actor_user_id, created_at').order('created_at', { ascending: false }).limit(20),
    ])

    for (const r of [teamsRes, membersRes, productsRes, usageRes, auditRes]) {
      if (r.error) throw r.error
    }

    const countBy = (rows, key, filter = () => true) => {
      const m = {}
      for (const row of rows) if (filter(row)) m[row[key]] = (m[row[key]] || 0) + 1
      return m
    }
    const members = countBy(membersRes.data, 'team_id')
    const products = countBy(productsRes.data, 'team_id', (r) => !r.archived_at)
    const usage = {}
    for (const u of usageRes.data) usage[u.team_id] = u.count

    const teams = teamsRes.data
      .map((t) => ({
        ...t,
        members: members[t.id] || 0,
        products: products[t.id] || 0,
        aiChatThisMonth: usage[t.id] || 0,
      }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

    const summary = {
      teams: teams.length,
      pro: teams.filter((t) => t.plan === 'pro').length,
      pastDue: teams.filter((t) => t.plan_status === 'past_due').length,
      scheduledCancel: teams.filter((t) => t.cancel_at_period_end).length,
      mrrJpy: teams.filter((t) => t.plan === 'pro').length * 1980,
    }

    res.status(200).json({ summary, teams, recentAudit: auditRes.data })
  } catch (err) {
    console.error('[admin-overview] error:', err.message)
    res.status(500).json({ error: 'overview failed' })
  }
}
