import { supabase } from './supabaseClient'

// ログイン中ユーザーのアクセストークンを付けて課金APIを叩く共通処理
async function postWithAuth(path) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('未ログインです')

  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
  })

  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(body.error || `リクエストに失敗しました (${res.status})`)
  }
  return body
}

// Proプランのチェックアウト画面へ遷移する
export async function startCheckout() {
  const { url } = await postWithAuth('/api/checkout')
  window.location.href = url
}

// Stripeカスタマーポータル(支払い方法変更・解約)へ遷移する
export async function openBillingPortal() {
  const { url } = await postWithAuth('/api/billing-portal')
  window.location.href = url
}

// 無料プランの商品上限
export const FREE_PLAN_PRODUCT_LIMIT = 50

// DBトリガーが投げる上限エラーかどうかを判定する
export function isFreePlanLimitError(err) {
  return /free plan product limit reached/i.test(err?.message || '')
}
