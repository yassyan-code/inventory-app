import { supabase } from './supabaseClient'

// ログイン中ユーザーが所属するチームIDを取得する
// (現状は1ユーザー1チームを前提。新規サインアップ時にトリガーが自動でチームを作る)
export async function getCurrentTeamId() {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) throw new Error('未ログインです')

  const { data, error } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('所属チームが見つかりません')
  return data.team_id
}

// ログイン中ユーザーの所属情報（チームID・チーム名・ロール）をまとめて取得する。
// ヘッダー表示と、ロールによる画面の出し分けに使う。
export async function getMyMembership() {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) throw new Error('未ログインです')

  const { data, error } = await supabase
    .from('team_members')
    .select('team_id, role, teams(name, plan, plan_status, cancel_at_period_end, current_period_end)')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('所属チームが見つかりません')

  const t = data.teams ?? {}
  const plan = t.plan ?? 'free'
  const planStatus = t.plan_status ?? null

  return {
    teamId: data.team_id,
    teamName: t.name ?? 'マイチーム',
    // owner を管理者、それ以外を一般ユーザー扱いにする
    role: data.role === 'owner' ? 'owner' : 'member',
    isAdmin: data.role === 'owner',
    plan,
    planStatus,
    cancelAtPeriodEnd: !!t.cancel_at_period_end,
    currentPeriodEnd: t.current_period_end ?? null,
    // Pro 機能が使えるか（past_due は猶予中なので使わせる）
    isPro: plan === 'pro' && ['active', 'trialing', 'past_due'].includes(planStatus),
    // 支払い失敗の猶予中
    pastDue: planStatus === 'past_due',
    // 期末解約が予約されている
    scheduledCancel: plan === 'pro' && !!t.cancel_at_period_end,
    email: user.email,
  }
}

// バーコードから商品＋在庫を1件取得（無ければ null）
export async function findByBarcode(barcode) {
  const { data: product, error } = await supabase
    .from('products')
    .select('id, barcode, name, category, stock_items(quantity)')
    .eq('barcode', barcode)
    .maybeSingle()

  if (error) throw error
  if (!product) return null

  return {
    id: product.id,
    barcode: product.barcode,
    name: product.name,
    category: product.category,
    quantity: extractQuantity(product.stock_items),
  }
}

// stock_items は product_id にunique制約があるため、Supabaseは埋め込み結果を
// 配列ではなく単一オブジェクトで返す(環境によっては配列のこともあるため両対応)
function extractQuantity(stockItems) {
  if (Array.isArray(stockItems)) {
    return stockItems[0]?.quantity ?? 0
  }
  return stockItems?.quantity ?? 0
}

// 新規商品を登録し、初期在庫数を設定する
export async function createProduct(barcode, name, initialQuantity = 0, category = '') {
  const teamId = await getCurrentTeamId()

  const { data: product, error: productError } = await supabase
    .from('products')
    .insert({ barcode, name, category: category || null, team_id: teamId })
    .select()
    .single()

  if (productError) throw productError

  const { error: stockError } = await supabase
    .from('stock_items')
    .insert({ product_id: product.id, quantity: initialQuantity, team_id: teamId })

  if (stockError) throw stockError

  if (initialQuantity !== 0) {
    await recordMovement(product.id, initialQuantity, '初期登録', teamId)
  }

  return product
}

// 在庫数を増減させる（change は正=入庫 / 負=出庫）
export async function adjustQuantity(productId, change, note = '') {
  const { data: current, error: fetchError } = await supabase
    .from('stock_items')
    .select('quantity')
    .eq('product_id', productId)
    .single()

  if (fetchError) throw fetchError

  const newQuantity = current.quantity + change

  const { error: updateError } = await supabase
    .from('stock_items')
    .update({ quantity: newQuantity })
    .eq('product_id', productId)

  if (updateError) throw updateError

  const teamId = await getCurrentTeamId()
  await recordMovement(productId, change, note, teamId)

  return newQuantity
}

async function recordMovement(productId, change, note, teamId) {
  const { error } = await supabase
    .from('stock_movements')
    .insert({ product_id: productId, change, note, team_id: teamId })
  if (error) throw error
}

// 在庫一覧を取得（商品名・バーコード・カテゴリで検索可能、カテゴリ絞り込み・並び替え可能）
// sortOrder: 'newest'（新しい順） | 'oldest'（古い順） | 'name'（名前順・デフォルト）
// includeArchived: true の場合、非表示にした商品も含める
export async function listStock(searchText = '', sortOrder = 'name', category = '', includeArchived = false) {
  let query = supabase
    .from('products')
    .select('id, barcode, name, category, created_at, archived_at, stock_items(quantity)')

  if (!includeArchived) {
    query = query.is('archived_at', null)
  }

  if (sortOrder === 'newest') {
    query = query.order('created_at', { ascending: false })
  } else if (sortOrder === 'oldest') {
    query = query.order('created_at', { ascending: true })
  } else {
    query = query.order('name')
  }

  if (searchText) {
    const escaped = searchText.replace(/[%_,]/g, (c) => `\\${c}`)
    query = query.or(
      `name.ilike.%${escaped}%,barcode.ilike.%${escaped}%,category.ilike.%${escaped}%`
    )
  }

  if (category) {
    query = query.eq('category', category)
  }

  const { data, error } = await query
  if (error) throw error

  return (data ?? []).map((p) => ({
    id: p.id,
    barcode: p.barcode,
    name: p.name,
    category: p.category,
    createdAt: p.created_at,
    archivedAt: p.archived_at,
    quantity: extractQuantity(p.stock_items),
  }))
}

// 商品を非表示にする（データは削除せず残す。入出庫履歴も保持される）
export async function archiveProduct(productId) {
  const { error } = await supabase
    .from('products')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', productId)

  if (error) throw error
}

// 非表示にした商品を元に戻す
export async function unarchiveProduct(productId) {
  const { error } = await supabase
    .from('products')
    .update({ archived_at: null })
    .eq('id', productId)

  if (error) throw error
}

// 商品のカテゴリを更新する（空文字は未設定=nullとして保存）
export async function updateCategory(productId, category) {
  const { error } = await supabase
    .from('products')
    .update({ category: category || null })
    .eq('id', productId)

  if (error) throw error
}

// 登録済みのカテゴリ一覧（絞り込みドロップダウン用、重複なし・昇順）
export async function listCategories() {
  const { data, error } = await supabase
    .from('products')
    .select('category')
    .not('category', 'is', null)

  if (error) throw error

  const unique = [...new Set((data ?? []).map((d) => d.category).filter(Boolean))]
  return unique.sort((a, b) => a.localeCompare(b, 'ja'))
}

// 自チームの（非表示でない）商品数。オンボーディングの進捗判定に使う。
export async function countProducts() {
  const { count, error } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .is('archived_at', null)

  if (error) throw error
  return count ?? 0
}
