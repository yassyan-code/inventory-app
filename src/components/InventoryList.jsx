import { useEffect, useRef, useState } from 'react'
import {
  listStock,
  listCategories,
  adjustQuantity,
  updateCategory,
  archiveProduct,
  unarchiveProduct,
} from '../lib/inventory'
import { toCsv, downloadCsv } from '../lib/csv'

const CSV_HEADERS = [
  { key: 'name', label: '商品名' },
  { key: 'category', label: 'カテゴリ' },
  { key: 'barcode', label: 'バーコード' },
  { key: 'createdAt', label: '登録日' },
  { key: 'quantity', label: '数量' },
  { key: 'status', label: '状態' },
]

const MAX_CATEGORY_LENGTH = 50

const formatDate = (iso) => {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('ja-JP')
}

export default function InventoryList({ refreshKey }) {
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sortOrder, setSortOrder] = useState('name') // 'name' | 'newest' | 'oldest'
  const [category, setCategory] = useState('')
  const [categoryOptions, setCategoryOptions] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [adjustingId, setAdjustingId] = useState(null)
  const debounceRef = useRef(null)

  const load = async (text, order, cat, includeArchived) => {
    setLoading(true)
    setError('')
    try {
      const data = await listStock(text, order, cat, includeArchived)
      setItems(data)
    } catch (err) {
      setError('取得エラー: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(search, sortOrder, category, showArchived)
    listCategories().then(setCategoryOptions).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, sortOrder, category, showArchived])

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    load(search, sortOrder, category, showArchived)
  }

  const handleSearchChange = (e) => {
    const value = e.target.value
    setSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => load(value, sortOrder, category, showArchived), 300)
  }

  const handleArchive = async (item) => {
    if (!window.confirm(`「${item.name}」を非表示にしますか？（在庫データや履歴は残り、後で復元できます）`)) return
    try {
      await archiveProduct(item.id)
      if (showArchived) {
        setItems((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, archivedAt: new Date().toISOString() } : it))
        )
      } else {
        setItems((prev) => prev.filter((it) => it.id !== item.id))
      }
    } catch (err) {
      setError('非表示エラー: ' + err.message)
    }
  }

  const handleExportCsv = () => {
    const rows = items.map((item) => ({
      name: item.name,
      category: item.category || '',
      barcode: item.barcode,
      createdAt: formatDate(item.createdAt),
      quantity: item.quantity,
      status: item.archivedAt ? '非表示' : '',
    }))
    const csvText = toCsv(CSV_HEADERS, rows)
    const today = formatDate(new Date().toISOString()).replace(/\//g, '-')
    downloadCsv(`inventory_${today}.csv`, csvText)
  }

  const handleUnarchive = async (item) => {
    try {
      await unarchiveProduct(item.id)
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, archivedAt: null } : it))
      )
    } catch (err) {
      setError('復元エラー: ' + err.message)
    }
  }

  const handleAdjust = async (item, change) => {
    if (adjustingId === item.id) return
    if (change < 0 && item.quantity <= 0) return
    setAdjustingId(item.id)
    try {
      const newQty = await adjustQuantity(item.id, change, change > 0 ? '入庫' : '出庫')
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, quantity: newQty } : it))
      )
    } catch (err) {
      setError('更新エラー: ' + err.message)
    } finally {
      setAdjustingId(null)
    }
  }

  const startEdit = (item) => {
    setEditingId(item.id)
    setEditValue(item.category || '')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditValue('')
  }

  const saveEdit = async (item) => {
    const newCategory = editValue.trim()
    setEditingId(null)
    if (newCategory === (item.category || '')) return
    if (newCategory.length > MAX_CATEGORY_LENGTH) {
      setError(`カテゴリは${MAX_CATEGORY_LENGTH}文字以内で入力してください`)
      return
    }
    try {
      await updateCategory(item.id, newCategory)
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, category: newCategory || null } : it))
      )
      listCategories().then(setCategoryOptions).catch(() => {})
    } catch (err) {
      setError('カテゴリ更新エラー: ' + err.message)
    }
  }

  return (
    <div className="inventory-list">
      <form className="search-bar" onSubmit={handleSearchSubmit}>
        <input
          value={search}
          onChange={handleSearchChange}
          placeholder="商品名・バーコード・カテゴリで検索"
        />
        <button type="submit">検索</button>
      </form>

      <select
        className="category-filter"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      >
        <option value="">すべてのカテゴリ</option>
        {categoryOptions.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <div className="sort-buttons">
        <button
          className={sortOrder === 'name' ? 'active' : 'secondary'}
          onClick={() => setSortOrder('name')}
        >
          名前順
        </button>
        <button
          className={sortOrder === 'newest' ? 'active' : 'secondary'}
          onClick={() => setSortOrder('newest')}
        >
          新しい順
        </button>
        <button
          className={sortOrder === 'oldest' ? 'active' : 'secondary'}
          onClick={() => setSortOrder('oldest')}
        >
          古い順
        </button>
      </div>

      <datalist id="category-suggestions">
        {categoryOptions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className="list-toolbar">
        <label className="show-archived-toggle">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          非表示の商品も表示する
        </label>
        <button
          className="secondary"
          onClick={handleExportCsv}
          disabled={items.length === 0}
        >
          CSVエクスポート
        </button>
      </div>

      {loading && <p>読み込み中...</p>}
      {error && <p className="message">{error}</p>}

      {!loading && items.length === 0 && <p>登録された商品がありません。</p>}

      {!loading && items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>商品名</th>
              <th>カテゴリ</th>
              <th>バーコード</th>
              <th>登録日</th>
              <th>数量</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className={item.archivedAt ? 'row--archived' : ''}>
                <td>
                  {item.name}
                  {item.archivedAt && <span className="archived-badge">非表示</span>}
                </td>
                <td className="category-cell">
                  {editingId === item.id ? (
                    <input
                      className="category-edit-input"
                      list="category-suggestions"
                      autoFocus
                      maxLength={MAX_CATEGORY_LENGTH}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => saveEdit(item)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                        if (e.key === 'Escape') cancelEdit()
                      }}
                    />
                  ) : (
                    <button className="category-edit-trigger" onClick={() => startEdit(item)}>
                      {item.category || '－'}
                    </button>
                  )}
                </td>
                <td className="barcode-cell">{item.barcode}</td>
                <td className="barcode-cell">{formatDate(item.createdAt)}</td>
                <td>{item.quantity}</td>
                <td className="qty-buttons qty-buttons--inline">
                  <button onClick={() => handleAdjust(item, 1)} disabled={adjustingId === item.id}>
                    ＋1
                  </button>
                  <button
                    onClick={() => handleAdjust(item, -1)}
                    disabled={adjustingId === item.id || item.quantity <= 0}
                  >
                    −1
                  </button>
                </td>
                <td>
                  {item.archivedAt ? (
                    <button className="secondary" onClick={() => handleUnarchive(item)}>
                      復元
                    </button>
                  ) : (
                    <button className="secondary" onClick={() => handleArchive(item)}>
                      非表示
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
