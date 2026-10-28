import { supabase } from './supabaseClient'

// ログイン中ユーザーと、そのユーザーの team_members の1行を取得する
// (現状は1ユーザー1チームを前提。新規サインアップ時にトリガーが自動でチームを作る)
// columns: team_members から取得する列(select に渡す文字列)
async function fetchMyMembershipRow(columns) {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) throw new Error('未ログインです')

  const { data: row, error } = await supabase
    .from('team_members')
    .select(columns)
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!row) throw new Error('所属チームが見つかりません')
  return { user, row }
}

// ログイン中ユーザーが所属するチームIDを取得する
export async function getCurrentTeamId() {
  const { row } = await fetchMyMembershipRow('team_id')
  return row.team_id
}

// ログイン中ユーザーの所属情報（チームID・チーム名・ロール）をまとめて取得する。
// ヘッダー表示と、ロールによる画面の出し分けに使う。
export async function getMyMembership() {
  const { user, row } = await fetchMyMembershipRow('team_id, role, teams(name)')
  const isAdmin = row.role === 'owner' // owner を管理者、それ以外を一般ユーザー扱いにする

  return {
    teamId: row.team_id,
    teamName: row.teams?.name ?? 'マイチーム',
    role: isAdmin ? 'owner' : 'member',
    isAdmin,
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

  return toStockSummary(product)
}

// products の1行(stock_items を埋め込み済み)を、画面で使う基本の形にする
function toStockSummary(product) {
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
  const { data: currentStock, error: fetchError } = await supabase
    .from('stock_items')
    .select('quantity')
    .eq('product_id', productId)
    .single()

  if (fetchError) throw fetchError

  const newQuantity = currentStock.quantity + change

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

  query = applySortOrder(query, sortOrder)

  if (searchText) {
    const pattern = escapeFilterValue(searchText)
    query = query.or(
      `name.ilike.%${pattern}%,barcode.ilike.%${pattern}%,category.ilike.%${pattern}%`
    )
  }

  if (category) {
    query = query.eq('category', category)
  }

  const { data, error } = await query
  if (error) throw error

  return (data ?? []).map((product) => ({
    ...toStockSummary(product),
    createdAt: product.created_at,
    archivedAt: product.archived_at,
  }))
}

function applySortOrder(query, sortOrder) {
  if (sortOrder === 'newest') return query.order('created_at', { ascending: false })
  if (sortOrder === 'oldest') return query.order('created_at', { ascending: true })
  return query.order('name')
}

// or() に渡す文字列で意味を持つ % _ , の前に \ を付けて、ただの文字として扱わせる
function escapeFilterValue(text) {
  return text.replace(/[%_,]/g, (char) => `\\${char}`)
}

// 商品を非表示にする（データは削除せず残す。入出庫履歴も保持される）
export async function archiveProduct(productId) {
  await updateProduct(productId, { archived_at: new Date().toISOString() })
}

// 非表示にした商品を元に戻す
export async function unarchiveProduct(productId) {
  await updateProduct(productId, { archived_at: null })
}

// 商品のカテゴリを更新する（空文字は未設定=nullとして保存）
export async function updateCategory(productId, category) {
  await updateProduct(productId, { category: category || null })
}

// products の1件を更新する(失敗したらエラーを投げる)
async function updateProduct(productId, values) {
  const { error } = await supabase.from('products').update(values).eq('id', productId)
  if (error) throw error
}

// 登録済みのカテゴリ一覧（絞り込みドロップダウン用、重複なし・昇順）
export async function listCategories() {
  const { data, error } = await supabase
    .from('products')
    .select('category')
    .not('category', 'is', null)

  if (error) throw error

  const uniqueCategories = [...new Set((data ?? []).map((row) => row.category).filter(Boolean))]
  return uniqueCategories.sort((a, b) => a.localeCompare(b, 'ja'))
}
