import { describe, it, expect } from 'vitest'
import { planFromStatus, patchFromSubscription } from './billing-state.js'

describe('planFromStatus', () => {
  it('active はPro', () => {
    expect(planFromStatus('active')).toBe('pro')
  })

  it('trialing はPro', () => {
    expect(planFromStatus('trialing')).toBe('pro')
  })

  it('past_due（支払い失敗の猶予中）はPro維持', () => {
    expect(planFromStatus('past_due')).toBe('pro')
  })

  it('canceled はfreeに落ちる', () => {
    expect(planFromStatus('canceled')).toBe('free')
  })

  it('unpaid はfreeに落ちる', () => {
    expect(planFromStatus('unpaid')).toBe('free')
  })

  it('incomplete_expired はfreeに落ちる', () => {
    expect(planFromStatus('incomplete_expired')).toBe('free')
  })
})

describe('patchFromSubscription', () => {
  it('Stripeのsubscriptionからteamsへのパッチを組み立てる', () => {
    const sub = {
      id: 'sub_123',
      status: 'active',
      cancel_at_period_end: false,
      current_period_end: 1893456000, // 2030-01-01T00:00:00Z
    }
    expect(patchFromSubscription(sub)).toEqual({
      plan: 'pro',
      plan_status: 'active',
      stripe_subscription_id: 'sub_123',
      cancel_at_period_end: false,
      current_period_end: '2030-01-01T00:00:00.000Z',
    })
  })

  it('current_period_endが無ければnullにする', () => {
    const sub = { id: 'sub_456', status: 'canceled', cancel_at_period_end: false, current_period_end: null }
    expect(patchFromSubscription(sub).current_period_end).toBeNull()
  })
})
