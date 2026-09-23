import { supabase } from './supabaseClient'

// プランごとの制限（画面表示・判定用。実際の強制は DB 側）
export const PLAN_LIMITS = {
  free: {
    products: 50,
    aiChatPerMonth: 20,
    csvExport: false, // 機能ゲート: CSVエクスポートは Pro 専用
  },
  pro: {
    products: Infinity,
    aiChatPerMonth: Infinity,
    csvExport: true,
  },
}

export function limitsFor(plan) {
  return PLAN_LIMITS[plan === 'pro' ? 'pro' : 'free']
}

function currentPeriod() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// 今月の AIチャット利用回数を取得する（無ければ 0）
export async function getAiChatUsage(teamId) {
  const { data, error } = await supabase
    .from('usage_counters')
    .select('count')
    .eq('team_id', teamId)
    .eq('metric', 'ai_chat')
    .eq('period', currentPeriod())
    .maybeSingle()

  if (error) {
    console.warn('[usage] 取得失敗:', error.message)
    return 0
  }
  return data?.count ?? 0
}
