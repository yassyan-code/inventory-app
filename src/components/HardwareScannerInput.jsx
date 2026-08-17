import { useEffect, useRef } from 'react'

// PC接続の専用バーコードスキャナー用。
// ハンディスキャナーはキーボード入力として文字を送り、最後にEnterを送ってくる
// （キーボードウェッジ方式）ため、専用のtext inputで受け取るだけでよい。
export default function HardwareScannerInput({ onDetected, active }) {
  const inputRef = useRef(null)

  useEffect(() => {
    if (active) {
      inputRef.current?.focus()
    }
  }, [active])

  if (!active) return null

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      const value = e.currentTarget.value.trim()
      if (value) {
        onDetected(value)
      }
      e.currentTarget.value = ''
    }
  }

  return (
    <div className="hardware-scanner">
      <label htmlFor="hardware-scanner-input">
        バーコードスキャナーでスキャンしてください（クリックしてカーソルを合わせてください）
      </label>
      <input
        id="hardware-scanner-input"
        ref={inputRef}
        type="text"
        autoComplete="off"
        onKeyDown={handleKeyDown}
        onBlur={() => inputRef.current?.focus()}
        placeholder="ここにスキャナーでバーコードを読み込む"
      />
    </div>
  )
}
