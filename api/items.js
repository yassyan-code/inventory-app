// 外部のアプリ/AIから叩ける公開API。チームの商品一覧をJSONで返す。
// ログインユーザーのJWT（getUserTeam）とは別に、チームごとに発行した
// 固定トークン（Authorization: Bearer <token>）で認証する。
// service_role で叩くためRLSは効かない。api_token→team_idの解決と
// products.eq('team_id', ...) の手動フィルタが唯一のテナント分離。

import { serviceClient } from './_lib/clients.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
  if (!token) {
    res.status(401).json({ error: 'missing token' })
    return
  }

  const db = serviceClient()

  const { data: team, error: teamError } = await db
    .from('teams')
    .select('id, name')
    .eq('api_token', token)
    .maybeSingle()

  if (teamError) {
    res.status(500).json({ error: 'internal error' })
    return
  }
  if (!team) {
    res.status(401).json({ error: 'invalid token' })
    return
  }

  const { data: products, error } = await db
    .from('products')
    .select('id, barcode, name, category, stock_items(quantity)')
    .eq('team_id', team.id)
    .is('archived_at', null)
    .order('name')
    .limit(200)

  if (error) {
    res.status(500).json({ error: 'internal error' })
    return
  }

  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({
    team: team.name,
    items: (products ?? []).map((p) => ({
      id: p.id,
      barcode: p.barcode,
      name: p.name,
      category: p.category,
      quantity: Array.isArray(p.stock_items) ? (p.stock_items[0]?.quantity ?? 0) : (p.stock_items?.quantity ?? 0),
    })),
  })
}
