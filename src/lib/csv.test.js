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
})
