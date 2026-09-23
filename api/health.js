// 稼働監視用のヘルスチェック。Uptime Kuma などの監視から叩く。
// 正常なら 200、依存(DB/設定)が壊れていれば 503 を返す。
// 認証なし・秘密情報は返さない。

import { serviceClient } from './_lib/clients.js'

export default async function handler(req, res) {
  const checks = {}
  let healthy = true

  // DB 疎通
  try {
    const t0 = Date.now()
    const { error } = await serviceClient()
      .from('teams')
      .select('id', { head: true, count: 'exact' })
      .limit(1)
    if (error) {
      checks.db = { ok: false, error: error.message }
      healthy = false
    } else {
      checks.db = { ok: true, ms: Date.now() - t0 }
    }
  } catch (e) {
    checks.db = { ok: false, error: e.message }
    healthy = false
  }

  // 必須環境変数がそろっているか（値は返さない）
  const required = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY']
  const missing = required.filter((k) => !process.env[k])
  checks.config = { ok: missing.length === 0, missing }
  if (missing.length) healthy = false

  res.setHeader('Cache-Control', 'no-store')
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    checks,
    ts: new Date().toISOString(),
  })
}
