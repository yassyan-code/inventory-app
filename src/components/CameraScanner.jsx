import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'

// 商品バーコードで使われる主な形式に絞り、粘り強く読み取る設定
const hints = new Map()
hints.set(DecodeHintType.POSSIBLE_FORMATS, [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
  BarcodeFormat.QR_CODE,
])
hints.set(DecodeHintType.TRY_HARDER, true)

// スマホ等のカメラでバーコードを読み取るコンポーネント。
// 読み取りに成功すると onDetected(barcode) を呼ぶ。
export default function CameraScanner({ onDetected, active }) {
  const videoRef = useRef(null)
  const readerRef = useRef(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!active) return

    const reader = new BrowserMultiFormatReader(hints)
    readerRef.current = reader
    let cancelled = false

    // 背面カメラを優先し、解像度も指定してピントが合いやすいようにする
    const constraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    }

    reader
      .decodeFromConstraints(constraints, videoRef.current, (result, err) => {
        if (cancelled) return
        if (result) {
          onDetected(result.getText())
        }
        // NotFoundExceptionはフレームごとに発生するので無視してよい
      })
      .catch((err) => {
        setError('カメラを起動できませんでした: ' + err.message)
      })

    return () => {
      cancelled = true
      readerRef.current?.reset?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  if (!active) return null

  return (
    <div className="camera-scanner">
      <video ref={videoRef} className="camera-scanner__video" muted playsInline />
      {error && <p className="camera-scanner__error">{error}</p>}
      <p className="camera-scanner__hint">
        バーコードを画面の横幅いっぱいくらいに大きく、正面から、明るい場所で映してください
      </p>
    </div>
  )
}
