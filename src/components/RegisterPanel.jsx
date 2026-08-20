import { useEffect, useState } from 'react'
import CameraScanner from './CameraScanner'
import HardwareScannerInput from './HardwareScannerInput'
import { findByBarcode, createProduct, adjustQuantity, listCategories } from '../lib/inventory'
import { lookupProductName } from '../lib/productLookup'

const MODES = {
  CAMERA: 'camera',
  HARDWARE: 'hardware',
}

const MAX_NAME_LENGTH = 100
const MAX_CATEGORY_LENGTH = 50
const MAX_BARCODE_LENGTH = 50
const MAX_QUANTITY = 999999

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
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isAdjusting, setIsAdjusting] = useState(false)

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
    if (!code) {
      setMessage('バーコード番号を入力してください')
      return
    }
    if (code.length > MAX_BARCODE_LENGTH) {
      setMessage(`バーコード番号は${MAX_BARCODE_LENGTH}文字以内で入力してください`)
      return
    }
    setMessage('')
    handleDetected(code)
  }

  const handleRegisterNew = async (e) => {
    e.preventDefault()
    if (isSubmitting) return

    const trimmedName = name.trim()
    const trimmedCategory = category.trim()
    const qty = Number(quantity)

    if (!trimmedName) {
      setMessage('商品名を入力してください')
      return
    }
    if (trimmedName.length > MAX_NAME_LENGTH) {
      setMessage(`商品名は${MAX_NAME_LENGTH}文字以内で入力してください`)
      return
    }
    if (trimmedCategory.length > MAX_CATEGORY_LENGTH) {
      setMessage(`カテゴリは${MAX_CATEGORY_LENGTH}文字以内で入力してください`)
      return
    }
    if (quantity === '' || !Number.isInteger(qty) || qty < 0) {
      setMessage('数量は0以上の整数で入力してください')
      return
    }
    if (qty > MAX_QUANTITY) {
      setMessage(`数量は${MAX_QUANTITY}以下で入力してください`)
      return
    }

    setIsSubmitting(true)
    setMessage('')
    try {
      await createProduct(barcode, trimmedName, qty, trimmedCategory)
      setMessage(`「${trimmedName}」を登録しました`)
      onChanged?.()
      resetForm()
      listCategories().then(setCategoryOptions).catch(() => {})
    } catch (err) {
      setMessage('登録エラー: ' + err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleAdjust = async (change) => {
    if (isAdjusting) return
    if (change < 0 && existing.quantity <= 0) return
    setIsAdjusting(true)
    try {
      const newQty = await adjustQuantity(existing.id, change, change > 0 ? '入庫' : '出庫')
      setExisting({ ...existing, quantity: newQty })
      onChanged?.()
    } catch (err) {
      setMessage('更新エラー: ' + err.message)
    } finally {
      setIsAdjusting(false)
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
              maxLength={MAX_BARCODE_LENGTH}
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
            <button onClick={() => handleAdjust(1)} disabled={isAdjusting}>
              ＋1（入庫）
            </button>
            <button onClick={() => handleAdjust(-1)} disabled={isAdjusting || existing.quantity <= 0}>
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
              maxLength={MAX_NAME_LENGTH}
              placeholder="商品名を入力"
            />
          </label>
          <label>
            カテゴリ（任意）
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              list="category-options"
              maxLength={MAX_CATEGORY_LENGTH}
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
              max={MAX_QUANTITY}
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <div className="qty-buttons">
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? '登録中...' : '登録する'}
            </button>
            <button type="button" className="secondary" onClick={resetForm} disabled={isSubmitting}>
              キャンセル
            </button>
          </div>
        </form>
      )}

      {message && <p className="message">{message}</p>}
    </div>
  )
}
