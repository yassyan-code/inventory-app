// 商品名の整形・カテゴリ提案を /api/suggest-product に頼む（第63課題）。
// AIは補助なので、失敗・遅延・未対応の環境（Railwayの静的配信には /api がない）では
// 例外にせず null を返し、呼び出し側は手入力のまま進める。

import { supabase } from './supabaseClient'

const TIMEOUT_MS = 5000

export async function suggestProductFields(rawName, categories = []) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) return null

    const res = await fetch('/api/suggest-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ rawName, categories }),
      signal: controller.signal,
    })
    if (!res.ok) return null

    // /api が無い環境では index.html が返るため、JSONとして読めなければ null
    const body = await res.json()
    if (typeof body?.name !== 'string' || !body.name) return null
    return { name: body.name, category: typeof body.category === 'string' ? body.category : '' }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
