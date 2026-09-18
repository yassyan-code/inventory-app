// Stripe カスタマーポータルのセッションを作る。
// Pro のチームが「プラン管理」から支払い方法変更・解約などを行う入口。
// 継続課金の運用(請求・解約・失敗)は第19回で Webhook 側を詰める。

import { stripe, getOwnerTeam } from './_lib/clients.js'
import { enforceRateLimit } from './_lib/ratelimit.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = await getOwnerTeam(req)
  if (auth.error) {
    res.status(auth.status).json({ error: auth.error })
    return
  }
  const { team, user, anon } = auth

  const rl = await enforceRateLimit(anon, `portal:${user.id}`, 10, 300)
  if (!rl.ok) {
    res.status(429).json({ error: 'rate_limited', retryAfter: rl.retryAfter })
    return
  }

  if (!team.stripe_customer_id) {
    res.status(400).json({ error: 'no Stripe customer for this team' })
    return
  }

  const origin = req.headers.origin || `https://${req.headers.host}`

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: team.stripe_customer_id,
      return_url: `${origin}/`,
    })
    res.status(200).json({ url: session.url })
  } catch (err) {
    console.error('[billing-portal] error:', err.message)
    res.status(500).json({ error: 'portal failed' })
  }
}
