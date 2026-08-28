// api/ 配下で共有するクライアント初期化。
// 先頭が _ のディレクトリは Vercel がルート(関数)として扱わないので、ここに置く。

import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
})

// サーバー専用の Supabase URL。ブラウザ用と同じ値だが VITE_ を付けない変数でも受ける。
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL

// service_role キー: RLS を貫通する。Webhook からの書き込み専用。絶対にブラウザへ出さない。
export function serviceClient() {
  return createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// リクエストの Authorization ヘッダー(Supabase のアクセストークン)から
// ログインユーザーを検証し、そのユーザーが owner を務めるチームを返す。
// owner でなければ null を返す(課金操作は管理者のみ)。
export async function getOwnerTeam(req) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return { error: 'missing token', status: 401 }

  const anon = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: { user }, error: userErr } = await anon.auth.getUser()
  if (userErr || !user) return { error: 'invalid token', status: 401 }

  const { data: membership, error: mErr } = await anon
    .from('team_members')
    .select('team_id, role, teams(id, name, plan, plan_status, stripe_customer_id, stripe_subscription_id)')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (mErr || !membership) return { error: 'team not found', status: 404 }
  if (membership.role !== 'owner') return { error: 'owner only', status: 403 }

  return { user, team: membership.teams, teamId: membership.team_id }
}
