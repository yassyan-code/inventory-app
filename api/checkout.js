// Stripe Checkout セッションを作る。
// フロントは「Proにアップグレード」ボタンで /api/checkout に POST し、
// 返ってきた url へリダイレクトする → Stripe のホスト決済画面へ。

import { stripe, serviceClient, getOwnerTeam } from './_lib/clients.js'

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
  const { user, team, teamId } = auth

  if (team.plan === 'pro' && team.plan_status === 'active') {
    res.status(400).json({ error: 'already on Pro plan' })
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

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: teamId,
      subscription_data: { metadata: { team_id: teamId } },
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
      allow_promotion_codes: true,
    })

    res.status(200).json({ url: session.url })
  } catch (err) {
    console.error('[checkout] error:', err.message)
    res.status(500).json({ error: 'checkout failed' })
  }
}
