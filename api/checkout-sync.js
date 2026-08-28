// 決済完了後、戻ってきた画面から呼ぶ「セッション照合」API。
// Stripe 側の最新のサブスク状態を取得して teams に即反映する。
// Webhook が遅れても・ローカルで Webhook が使えなくても、ここで確定できる。
// (Stripe 推奨の verify-on-return パターン。Webhook は更新/解約の非同期経路として併用)

import { stripe, serviceClient, getOwnerTeam } from './_lib/clients.js'

function planFromStatus(status) {
  return status === 'active' || status === 'trialing' ? 'pro' : 'free'
}

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
  const { team, teamId } = auth

  if (!team.stripe_customer_id) {
    res.status(200).json({ plan: team.plan || 'free', synced: false })
    return
  }

  try {
    const subs = await stripe.subscriptions.list({
      customer: team.stripe_customer_id,
      status: 'all',
      limit: 1,
    })
    const sub = subs.data[0]

    if (!sub) {
      res.status(200).json({ plan: 'free', synced: true })
      return
    }

    const patch = {
      plan: planFromStatus(sub.status),
      plan_status: sub.status,
      stripe_subscription_id: sub.id,
      current_period_end: sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
    }
    const { error } = await serviceClient().from('teams').update(patch).eq('id', teamId)
    if (error) throw error

    res.status(200).json({ plan: patch.plan, plan_status: patch.plan_status, synced: true })
  } catch (err) {
    console.error('[checkout-sync] error:', err.message)
    res.status(500).json({ error: 'sync failed' })
  }
}
