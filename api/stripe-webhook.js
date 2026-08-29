// Stripe からのイベント通知を受け取り、teams のプラン状態を更新する。
//
// 継続課金の状態遷移をここで一元管理する:
//   invoice.paid / invoice.payment_succeeded  → active に復帰
//   invoice.payment_failed                    → past_due（猶予）
//   customer.subscription.updated             → status をそのまま反映（解約予約も）
//   customer.subscription.deleted             → free に停止
//   checkout.session.completed                → 初回の Pro 化（保険。通常は checkout-sync が先に効く）
//
// 署名検証には生ボディが必要なので bodyParser を無効化する。
// (注) ローカルの `vercel dev` はこの設定を無視するため署名検証が通らない。
//      ローカルで Webhook を試すときだけ STRIPE_WEBHOOK_SKIP_VERIFY=1 を .env に置くと
//      署名検証をスキップして req.body をそのままイベントとして扱う（本番では絶対に設定しない）。

import { stripe, serviceClient } from './_lib/clients.js'
import { patchFromSubscription } from './_lib/billing-state.js'

export const config = { api: { bodyParser: false } }

async function readRawBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

async function updateTeam(match, patch) {
  const { error } = await serviceClient().from('teams').update(patch).match(match)
  if (error) console.error('[webhook] teams update error:', error.message)
}

// invoice から顧客/サブスクを引いて teams を更新する
async function syncFromSubscriptionId(subscriptionId, customerId, fallbackPatch) {
  if (subscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subscriptionId)
      await updateTeam({ stripe_customer_id: sub.customer }, patchFromSubscription(sub))
      return
    } catch (err) {
      console.error('[webhook] subscription retrieve failed:', err.message)
    }
  }
  if (customerId && fallbackPatch) {
    await updateTeam({ stripe_customer_id: customerId }, fallbackPatch)
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  let event
  if (process.env.STRIPE_WEBHOOK_SKIP_VERIFY === '1') {
    // ローカル専用: 署名検証をスキップ。vercel dev は req.body を既にパース済み。
    event = req.body
    console.warn('[webhook] signature verification SKIPPED (dev mode)')
  } else {
    try {
      const raw = await readRawBody(req)
      event = stripe.webhooks.constructEvent(
        raw,
        req.headers['stripe-signature'],
        process.env.STRIPE_WEBHOOK_SECRET
      )
    } catch (err) {
      console.error('[webhook] signature verification failed:', err.message)
      res.status(400).json({ error: `invalid signature: ${err.message}` })
      return
    }
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
            stripe_customer_id: s.customer,
            ...(sub
              ? patchFromSubscription(sub)
              : { plan: 'pro', plan_status: 'active', stripe_subscription_id: s.subscription || null }),
          }
        )
        break
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = event.data.object
        const match = sub.metadata?.team_id
          ? { id: sub.metadata.team_id }
          : { stripe_customer_id: sub.customer }
        await updateTeam(match, patchFromSubscription(sub))
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object
        const match = sub.metadata?.team_id
          ? { id: sub.metadata.team_id }
          : { stripe_customer_id: sub.customer }

        // 同じ顧客に別の有効なサブスクが残っていれば、そちらを反映して下げない。
        // (重複契約の片方を解約したケースなど)
        let other = null
        try {
          const list = await stripe.subscriptions.list({ customer: sub.customer, status: 'all', limit: 5 })
          other = list.data.find(
            (s) => s.id !== sub.id && ['active', 'trialing', 'past_due'].includes(s.status)
          )
        } catch (err) {
          console.error('[webhook] list subs on delete failed:', err.message)
        }

        if (other) {
          await updateTeam(match, patchFromSubscription(other))
        } else {
          await updateTeam(match, {
            plan: 'free',
            plan_status: 'canceled',
            stripe_subscription_id: null,
            cancel_at_period_end: false,
            current_period_end: null,
          })
        }
        break
      }

      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const inv = event.data.object
        await syncFromSubscriptionId(inv.subscription, inv.customer, {
          plan: 'pro',
          plan_status: 'active',
        })
        break
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object
        // Stripe 側はこの後も自動リトライ。猶予として past_due にするが Pro は維持。
        await syncFromSubscriptionId(inv.subscription, inv.customer, {
          plan: 'pro',
          plan_status: 'past_due',
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
