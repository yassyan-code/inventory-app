import { useEffect, useRef, useState } from 'react'
import { listStock, listCategories, adjustQuantity, updateCategory } from '../lib/inventory'

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
  const debounceRef = useRef(null)

  const load = async (text, order, cat) => {
    setLoading(true)
    setError('')
    try {
      const data = await listStock(text, order, cat)
      setItems(data)
    } catch (err) {
      setError('取得エラー: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(search, sortOrder, category)
    listCategories().then(setCategoryOptions).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, sortOrder, category])

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    load(search, sortOrder, category)
  }

  const handleSearchChange = (e) => {
    const value = e.target.value
    setSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => load(value, sortOrder, category), 300)
  }

  const handleAdjust = async (item, change) => {
    try {
      const newQty = await adjustQuantity(item.id, change, change > 0 ? '入庫' : '出庫')
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, quantity: newQty } : it))
      )
    } catch (err) {
      setError('更新エラー: ' + err.message)
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
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td className="category-cell">
                  {editingId === item.id ? (
                    <input
                      className="category-edit-input"
                      list="category-suggestions"
                      autoFocus
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
                  <button onClick={() => handleAdjust(item, 1)}>＋1</button>
                  <button onClick={() => handleAdjust(item, -1)} disabled={item.quantity <= 0}>
                    −1
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
