// Stripe Checkout セッションを作る。
// フロントは「Proにアップグレード」ボタンで /api/checkout に POST し、
// 返ってきた url へリダイレクトする → Stripe のホスト決済画面へ。

import { stripe, serviceClient, getOwnerTeam } from './_lib/clients.js'
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
  const { user, team, teamId, anon } = auth

  // レート制限: 5分あたり 5 回まで（決済セッションの乱造を防ぐ）
  const rl = await enforceRateLimit(anon, `checkout:${user.id}`, 5, 300)
  if (!rl.ok) {
    res.status(429).json({ error: 'rate_limited', retryAfter: rl.retryAfter })
    return
  }

  if (team.plan === 'pro' && ['active', 'trialing', 'past_due'].includes(team.plan_status)) {
    res.status(400).json({ error: 'already subscribed', code: 'already_subscribed' })
    return
  }

  const priceId = process.env.STRIPE_PRICE_ID
  if (!priceId) {
    res.status(500).json({ error: 'STRIPE_PRICE_ID is not configured' })
    return
  }

  const origin = req.headers.origin || `https://${req.headers.host}`

  try {
    // Stripe の顧客を用意(なければ作成して teams に保存)
    let customerId = team.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: team.name,
        metadata: { team_id: teamId },
      })
      customerId = customer.id
      await serviceClient().from('teams').update({ stripe_customer_id: customerId }).eq('id', teamId)
    }

    // DB が古い場合の保険: Stripe 側に生きているサブスクがあれば二重作成しない。
    // 既存を teams に取り込んで「契約済み」を返す（フロントは再取得すれば Pro になる）。
    const existing = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 3,
    })
    const live = existing.data.find((s) => ['active', 'trialing', 'past_due'].includes(s.status))
    if (live) {
      await serviceClient()
        .from('teams')
        .update({
          plan: 'pro',
          plan_status: live.status,
          stripe_subscription_id: live.id,
          cancel_at_period_end: !!live.cancel_at_period_end,
          current_period_end: live.current_period_end
            ? new Date(live.current_period_end * 1000).toISOString()
            : null,
        })
        .eq('id', teamId)
      res.status(400).json({ error: 'already subscribed', code: 'already_subscribed' })
      return
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: teamId,
      subscription_data: { metadata: { team_id: teamId } },
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
      allow_promotion_codes: true,
      // このアカウントは Managed Payments が既定ON。商品ごとの tax_code 設定を
      // 要求されるため、シンプルなサブスク課金では明示的に無効化する。
      managed_payments: { enabled: false },
    })

    // 監査ログ（誰がアップグレードを開始したか）
    anon.rpc('write_audit', {
      p_action: 'billing.checkout_started',
      p_target: teamId,
      p_meta: { price: priceId },
    }).then(({ error }) => error && console.error('[checkout] audit failed:', error.message))

    res.status(200).json({ url: session.url })
  } catch (err) {
    console.error('[checkout] error:', err.message)
    res.status(500).json({ error: 'checkout failed' })
  }
}
