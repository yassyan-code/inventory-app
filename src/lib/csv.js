// = + - @ タブ・改行始まりの文字列は、Excel/Googleスプレッドシートで開いた時に
// 数式として実行される（CSVインジェクション）。商品名・メモなどは他人の入力を
// 引き継いだ値もあるため、先頭にこれらの文字が来ないかチェックする。
// ただし在庫の増減数（-5 など）のような正真正銘の数値は対象外にする。
const FORMULA_TRIGGER = /^[=+\-@\t\r]/
const PURE_NUMBER = /^[+-]?\d+(\.\d+)?$/

function needsFormulaEscape(text) {
  return FORMULA_TRIGGER.test(text) && !PURE_NUMBER.test(text)
}

// CSVの1セルをエスケープする（カンマ・改行・ダブルクォートを含む場合は"..."で囲む）
function escapeCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  // 数式と誤解されないよう、先頭にシングルクォートを足して文字列扱いにする(OWASP推奨の対策)
  const safe = needsFormulaEscape(text) ? `'${text}` : text
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`
  }
  return safe
}

// headers: [{ key, label }], rows: オブジェクトの配列
export function toCsv(headers, rows) {
  const lines = [headers.map((h) => escapeCell(h.label)).join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCell(row[h.key])).join(','))
  }
  return lines.join('\r\n')
}

// CSV文字列をファイルとしてダウンロードする（Excelでの文字化け防止にUTF-8 BOM付き）
export function downloadCsv(filename, csvText) {
  const bom = '﻿'
  const blob = new Blob([bom + csvText], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
