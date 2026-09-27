import { describe, it, expect } from 'vitest'
import { toCsv } from './csv'

describe('toCsv', () => {
  const headers = [
    { key: 'name', label: '商品名' },
    { key: 'qty', label: '数量' },
  ]

  it('ヘッダー行とデータ行をCRLFで結合する', () => {
    const rows = [{ name: '牛乳', qty: 3 }]
    const csv = toCsv(headers, rows)
    expect(csv).toBe('商品名,数量\r\n牛乳,3')
  })

  it('カンマ・改行・ダブルクォートを含む値をダブルクォートで囲みエスケープする', () => {
    const rows = [{ name: '"特売",牛乳\n(1L)', qty: 1 }]
    const csv = toCsv(headers, rows)
    expect(csv).toContain('"""特売"",牛乳\n(1L)"')
  })

  it('nullやundefinedは空文字として扱う', () => {
    const rows = [{ name: null, qty: undefined }]
    const csv = toCsv(headers, rows)
    expect(csv).toBe('商品名,数量\r\n,')
  })

  it('=+-@始まりの値はExcelで数式にならないよう先頭にシングルクォートを足す（CSVインジェクション対策）', () => {
    const rows = [
      { name: '=SUM(A1:A2)', qty: 1 },
      { name: '+81-1234', qty: 1 },
      { name: '-rm -rf', qty: 1 },
      { name: '@mention', qty: 1 },
    ]
    const csv = toCsv(headers, rows)
    const lines = csv.split('\r\n').slice(1)
    expect(lines[0]).toBe("'=SUM(A1:A2),1")
    expect(lines[1]).toBe("'+81-1234,1")
    expect(lines[2]).toBe("'-rm -rf,1")
    expect(lines[3]).toBe("'@mention,1")
  })

  it('在庫の増減数のような正真正銘の数値はエスケープしない', () => {
    const rows = [{ name: '牛乳', qty: -5 }]
    const csv = toCsv(headers, rows)
    expect(csv).toContain('牛乳,-5')
  })
})
