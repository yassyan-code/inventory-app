import { useEffect, useRef, useState } from 'react'
import CameraScanner from './CameraScanner'
import HardwareScannerInput from './HardwareScannerInput'
import { findByBarcode, createProduct, adjustQuantity, listCategories } from '../lib/inventory'
import { lookupProductName } from '../lib/productLookup'
import { suggestProductFields } from '../lib/productSuggest'

const MODES = {
  CAMERA: 'camera',
  HARDWARE: 'hardware',
}

const MAX_NAME_LENGTH = 100
const MAX_CATEGORY_LENGTH = 50
const MAX_BARCODE_LENGTH = 50
const MAX_QUANTITY = 999999

export default function RegisterPanel({ onChanged, isAdmin = false }) {
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
  const [prevQuantity, setPrevQuantity] = useState(0) // スキャン前の在庫数(「○→○」の表示用)
  const [undone, setUndone] = useState(false)
  const [aiNote, setAiNote] = useState('')
  const aiRequestId = useRef(0) // 古い提案が、次の商品の入力欄に入らないようにする

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
        // スキャンした時点で自動的に+1(入庫)する。間違えたときは「取り消す」で1回だけ戻せる。
        const newQty = await adjustQuantity(found.id, 1, '入庫')
        setExisting({ ...found, quantity: newQty })
        setPrevQuantity(found.quantity)
        setUndone(false)
        setStatus('existing')
        onChanged?.()
      } else {
        const suggestedName = await lookupProductName(code)
        setName(suggestedName ?? '')
        setQuantity(1)
        setStatus('new')
        if (isAdmin && suggestedName) applyAiSuggestion(suggestedName)
      }
    } catch (err) {
      setMessage('エラー: ' + err.message)
      setStatus('idle')
    }
  }

  // 商品名の整形・カテゴリ提案。フォームは先に出し、AIの答えは届いたら埋める（待たせない）。
  // 入力済みの欄は上書きしない。保存はユーザーが確認して押したときだけ。
  const applyAiSuggestion = async (rawName) => {
    const id = ++aiRequestId.current
    const suggestion = await suggestProductFields(rawName, categoryOptions)
    if (!suggestion || id !== aiRequestId.current) return

    setName((prev) => (prev === rawName ? suggestion.name.slice(0, MAX_NAME_LENGTH) : prev))
    setCategory((prev) => prev || suggestion.category.slice(0, MAX_CATEGORY_LENGTH))
    setAiNote('AIが商品名とカテゴリを整えました。内容を確認して、必要なら直してください')
  }

  const resetForm = () => {
    aiRequestId.current++
    setAiNote('')
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

  // 直前のスキャンによる入庫(+1)を取り消す。二重に押して在庫が狂わないよう、1回だけ。
  const handleUndo = async () => {
    if (isAdjusting || undone) return
    setIsAdjusting(true)
    try {
      const newQty = await adjustQuantity(existing.id, -1, '入庫の取り消し')
      setExisting({ ...existing, quantity: newQty })
      setUndone(true)
      onChanged?.()
    } catch {
      setMessage('取り消せませんでした。もう一度お試しください')
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
          {undone ? (
            <p className="scan-result__done">↩ 取り消しました。在庫は {existing.quantity} 個に戻りました</p>
          ) : (
            <>
              <p className="scan-result__done">
                ✅ 入庫を1件記録しました（在庫 {prevQuantity} → {existing.quantity} 個）
              </p>
              <p className="scan-result__category">同じ商品をもう1個入荷したら、もう一度スキャンしてください</p>
              <button className="secondary" onClick={handleUndo} disabled={isAdjusting}>
                ↩ 間違えた（取り消す）
              </button>
            </>
          )}
          <button className="secondary" onClick={resetForm}>
            次の商品をスキャン
          </button>
        </div>
      )}

      {status === 'new' && !isAdmin && (
        <div className="scan-result">
          <p className="scan-result__barcode">バーコード: {barcode}</p>
          <p>この商品はまだ登録されていません。新規登録は管理者のみ可能です。管理者に依頼してください。</p>
          <button className="secondary" onClick={resetForm}>
            戻る
          </button>
        </div>
      )}

      {status === 'new' && isAdmin && (
        <form className="scan-result" onSubmit={handleRegisterNew}>
          <p className="scan-result__barcode">バーコード: {barcode}</p>
          <p>新しい商品です。商品名と数量を入力してください。</p>
          {aiNote && <p className="scan-result__category">✨ {aiNote}</p>}
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
