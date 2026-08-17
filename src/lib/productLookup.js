// JANコード(バーコード)から商品名を自動取得する。
// Yahoo!ショッピング商品検索API（無料・要アプリケーションID）を利用。
// https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html
//
// VITE_YAHOO_APP_ID が未設定の場合は null を返し、呼び出し側で手入力にフォールバックする。

const YAHOO_ENDPOINT = 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch'

export async function lookupProductName(barcode) {
  const appId = import.meta.env.VITE_YAHOO_APP_ID

  if (!appId) {
    return null
  }

  const url = `${YAHOO_ENDPOINT}?appid=${encodeURIComponent(appId)}&jan_code=${encodeURIComponent(
    barcode
  )}&results=1`

  try {
    const res = await fetch(url)
    if (!res.ok) {
      console.warn('[productLookup] APIエラー', res.status)
      return null
    }
    const data = await res.json()
    const hit = data?.hits?.[0]
    return hit?.name ?? null
  } catch (err) {
    console.warn('[productLookup] 取得失敗', err)
    return null
  }
}
