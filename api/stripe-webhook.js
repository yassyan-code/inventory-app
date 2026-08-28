// Stripe からのイベント通知を受け取り、teams のプラン状態を更新する。
//
// 署名検証には生のリクエストボディが必要なので bodyParser を無効化する。
// (注) ローカルの `vercel dev` はこの設定を無視してボディを先にパースしてしまうため、
//      ローカルでは署名検証が通らない。デプロイ環境(本番 Vercel)では正しく動く。
//      ローカルの即時反映は api/checkout-sync.js（戻り画面から呼ぶ）で担保している。
//
// 登録が必要なイベント(Stripe ダッシュボード > Developers > Webhooks):
//   checkout.session.completed
//   customer.subscription.updated
//   customer.subscription.deleted

import { stripe, serviceClient } from './_lib/clients.js'

export const config = { api: { bodyParser: false } }

async function readRawBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

function planFromStatus(status) {
  return status === 'active' || status === 'trialing' ? 'pro' : 'free'
}

async function updateTeam(match, patch) {
  const db = serviceClient()
  const { error } = await db.from('teams').update(patch).match(match)
  if (error) console.error('[webhook] teams update error:', error.message)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const sig = req.headers['stripe-signature']
  let event
  try {
    const raw = await readRawBody(req)
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('[webhook] signature verification failed:', err.message)
    res.status(400).json({ error: `invalid signature: ${err.message}` })
    return
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object
        const teamId = s.client_reference_id || s.metadata?.team_id
        const sub = s.subscription ? await stripe.subscriptions.retrieve(s.subscription) : null
        await updateTeam(
          { id: teamId },
          {
            plan: 'pro',
            plan_status: sub?.status || 'active',
            stripe_customer_id: s.customer,
            stripe_subscription_id: s.subscription || null,
            current_period_end: sub?.current_period_end
              ? new Date(sub.current_period_end * 1000).toISOString()
              : null,
          }
        )
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object
        const teamId = sub.metadata?.team_id
        await updateTeam(teamId ? { id: teamId } : { stripe_customer_id: sub.customer }, {
          plan: planFromStatus(sub.status),
          plan_status: sub.status,
          stripe_subscription_id: sub.id,
          current_period_end: sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null,
        })
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object
        const teamId = sub.metadata?.team_id
        await updateTeam(teamId ? { id: teamId } : { stripe_customer_id: sub.customer }, {
          plan: 'free',
          plan_status: 'canceled',
          stripe_subscription_id: null,
          current_period_end: null,
        })
        break
      }

      default:
        break
    }
  } catch (err) {
    console.error('[webhook] handler error:', err.message)
    res.status(500).json({ error: 'handler failed' })
    return
  }

  res.status(200).json({ received: true })
}
