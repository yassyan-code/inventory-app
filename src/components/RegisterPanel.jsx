import { useEffect, useState } from 'react'
import CameraScanner from './CameraScanner'
import HardwareScannerInput from './HardwareScannerInput'
import { findByBarcode, createProduct, adjustQuantity, listCategories } from '../lib/inventory'
import { lookupProductName } from '../lib/productLookup'

const MODES = {
  CAMERA: 'camera',
  HARDWARE: 'hardware',
}

export default function RegisterPanel({ onChanged }) {
  const [mode, setMode] = useState(MODES.CAMERA)
  const [status, setStatus] = useState('idle') // idle | loading | existing | new
  const [barcode, setBarcode] = useState('')
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [category, setCategory] = useState('')
  const [categoryOptions, setCategoryOptions] = useState([])
  const [existing, setExisting] = useState(null)
  const [message, setMessage] = useState('')
  const [manualBarcode, setManualBarcode] = useState('')

  useEffect(() => {
    listCategories().then(setCategoryOptions).catch(() => {})
  }, [])

  const handleDetected = async (code) => {
    if (status === 'loading') return
    setBarcode(code)
    setStatus('loading')
    setMessage('')

    try {
      const found = await findByBarcode(code)
      if (found) {
        // スキャンした時点で自動的に+1(入庫)する。以降の微調整は手動の＋/−ボタンで行う。
        const newQty = await adjustQuantity(found.id, 1, '入庫')
        setExisting({ ...found, quantity: newQty })
        setStatus('existing')
        onChanged?.()
      } else {
        const suggestedName = await lookupProductName(code)
        setName(suggestedName ?? '')
        setQuantity(1)
        setStatus('new')
      }
    } catch (err) {
      setMessage('エラー: ' + err.message)
      setStatus('idle')
    }
  }

  const resetForm = () => {
    setStatus('idle')
    setBarcode('')
    setName('')
    setQuantity(1)
    setCategory('')
    setExisting(null)
    setManualBarcode('')
  }

  const handleManualSubmit = (e) => {
    e.preventDefault()
    const code = manualBarcode.trim()
    if (code) {
      handleDetected(code)
    }
  }

  const handleRegisterNew = async (e) => {
    e.preventDefault()
    try {
      await createProduct(barcode, name.trim(), Number(quantity), category.trim())
      setMessage(`「${name}」を登録しました`)
      onChanged?.()
      resetForm()
      listCategories().then(setCategoryOptions).catch(() => {})
    } catch (err) {
      setMessage('登録エラー: ' + err.message)
    }
  }

  const handleAdjust = async (change) => {
    try {
      const newQty = await adjustQuantity(existing.id, change, change > 0 ? '入庫' : '出庫')
      setExisting({ ...existing, quantity: newQty })
      onChanged?.()
    } catch (err) {
      setMessage('更新エラー: ' + err.message)
    }
  }

  return (
    <div className="register-panel">
      <div className="mode-switch">
        <button
          className={mode === MODES.CAMERA ? 'active' : ''}
          onClick={() => setMode(MODES.CAMERA)}
        >
          📷 カメラで読み取る
        </button>
        <button
          className={mode === MODES.HARDWARE ? 'active' : ''}
          onClick={() => setMode(MODES.HARDWARE)}
        >
          🔌 スキャナーで読み取る
        </button>
      </div>

      <CameraScanner active={mode === MODES.CAMERA && status === 'idle'} onDetected={handleDetected} />
      <HardwareScannerInput
        active={mode === MODES.HARDWARE && status === 'idle'}
        onDetected={handleDetected}
      />

      {mode === MODES.CAMERA && status === 'idle' && (
        <form className="manual-entry" onSubmit={handleManualSubmit}>
          <label>
            うまく読み取れない場合はバーコード番号を直接入力
            <input
              value={manualBarcode}
              onChange={(e) => setManualBarcode(e.target.value)}
              inputMode="numeric"
              placeholder="例: 4901234567890"
            />
          </label>
          <button type="submit">この番号で確認する</button>
        </form>
      )}

      {status === 'loading' && <p>商品情報を確認中...</p>}

      {status === 'existing' && existing && (
        <div className="scan-result">
          <p className="scan-result__barcode">バーコード: {existing.barcode}</p>
          <h3>{existing.name}</h3>
          {existing.category && <p className="scan-result__category">カテゴリ: {existing.category}</p>}
          <p>現在の在庫数: {existing.quantity}（スキャンにより+1済み）</p>
          <p>数量を修正する場合はこちら</p>
          <div className="qty-buttons">
            <button onClick={() => handleAdjust(1)}>＋1（入庫）</button>
            <button onClick={() => handleAdjust(-1)} disabled={existing.quantity <= 0}>
              −1（出庫）
            </button>
          </div>
          <button className="secondary" onClick={resetForm}>
            次のバーコードをスキャン
          </button>
        </div>
      )}

      {status === 'new' && (
        <form className="scan-result" onSubmit={handleRegisterNew}>
          <p className="scan-result__barcode">バーコード: {barcode}</p>
          <p>新しい商品です。商品名と数量を入力してください。</p>
          <label>
            商品名
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              placeholder="商品名を入力"
            />
          </label>
          <label>
            カテゴリ（任意）
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              list="category-options"
              placeholder="例: 飲料、お菓子"
            />
            <datalist id="category-options">
              {categoryOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label>
            数量
            <input
              type="number"
              min="0"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <div className="qty-buttons">
            <button type="submit">登録する</button>
            <button type="button" className="secondary" onClick={resetForm}>
              キャンセル
            </button>
          </div>
        </form>
      )}

      {message && <p className="message">{message}</p>}
    </div>
  )
}
