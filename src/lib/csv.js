// CSVの1セルをエスケープする（カンマ・改行・ダブルクォートを含む場合は"..."で囲む）
function escapeCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
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
