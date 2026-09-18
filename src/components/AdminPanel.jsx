import { useEffect, useState } from 'react'
import { fetchAdminOverview } from '../lib/admin'

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('ja-JP') : '—')

// 運営（SaaSの提供側）が全テナントの状態を見る画面。
// ADMIN_EMAILS に載っている人だけがデータを取得できる。
export default function AdminPanel() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchAdminOverview().then(setData).catch((e) => setError(e.message))
  }, [])

  if (error) return <p className="message">読み込みエラー: {error}</p>
  if (!data) return <p>読み込み中...</p>

  const { summary, teams, recentAudit } = data

  return (
    <div className="admin-panel">
      <div className="admin-summary">
        <span>テナント <b>{summary.teams}</b></span>
        <span>Pro <b>{summary.pro}</b></span>
        <span>支払い遅延 <b>{summary.pastDue}</b></span>
        <span>解約予定 <b>{summary.scheduledCancel}</b></span>
        <span>推定MRR <b>¥{summary.mrrJpy.toLocaleString()}</b></span>
      </div>

      <div className="admin-table-wrap">
        <table>
          <thead>
            <tr>
              <th>チーム</th>
              <th>プラン</th>
              <th>状態</th>
              <th>人数</th>
              <th>商品</th>
              <th>今月AI</th>
              <th>作成日</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.plan === 'pro' ? 'Pro' : '無料'}</td>
                <td>
                  {t.plan_status || '—'}
                  {t.cancel_at_period_end && '（解約予定）'}
                </td>
                <td>{t.members}</td>
                <td>{t.products}</td>
                <td>{t.aiChatThisMonth}</td>
                <td>{fmtDate(t.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="admin-subhead">最近の監査ログ</h3>
      <ul className="admin-audit">
        {recentAudit.map((a, i) => (
          <li key={i}>
            <code>{a.action}</code> — {fmtDate(a.created_at)}
            {a.actor_user_id ? '（ユーザー操作）' : '（システム）'}
          </li>
        ))}
      </ul>
    </div>
  )
}
