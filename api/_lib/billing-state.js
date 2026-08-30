// サブスクの status からアプリ内のプラン扱いを決める共通ロジック。
// Webhook と checkout-sync の両方で使う。

// past_due（支払い失敗の猶予中）は Pro のまま使わせる。
// 停止扱いにするのは unpaid / canceled / incomplete_expired など。
const PRO_STATUSES = new Set(['active', 'trialing', 'past_due'])

export function planFromStatus(status) {
  return PRO_STATUSES.has(status) ? 'pro' : 'free'
}

// Stripe の subscription オブジェクトから teams に書くパッチを組み立てる
export function patchFromSubscription(sub) {
  return {
    plan: planFromStatus(sub.status),
    plan_status: sub.status,
    stripe_subscription_id: sub.id,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    current_period_end: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
  }
}
