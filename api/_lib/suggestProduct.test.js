import { describe, it, expect, vi } from 'vitest'
import {
  TOOL_NAME,
  MAX_RAW_NAME_LENGTH,
  MAX_NAME_LENGTH,
  validateInput,
  buildRequest,
  parseSuggestion,
  suggestProduct,
} from './suggestProduct.js'

const toolReply = (input) => ({ content: [{ type: 'tool_use', name: TOOL_NAME, input }] })

describe('validateInput', () => {
  it('商品名とカテゴリを受け取り、前後の空白を除く', () => {
    const r = validateInput({ rawName: '  牛乳 1L ', categories: [' 飲料 ', ''] })
    expect(r).toEqual({ ok: true, rawName: '牛乳 1L', categories: ['飲料'] })
  })

  it('商品名が空・文字列でない・長すぎるものは input エラー', () => {
    for (const rawName of ['', '   ', 123, undefined, 'a'.repeat(MAX_RAW_NAME_LENGTH + 1)]) {
      const r = validateInput({ rawName })
      expect(r.ok).toBe(false)
      expect(r.kind).toBe('input')
    }
  })

  it('カテゴリが配列でない・多すぎる・文字列でないものは input エラー', () => {
    expect(validateInput({ rawName: 'a', categories: 'x' }).kind).toBe('input')
    expect(validateInput({ rawName: 'a', categories: Array(51).fill('x') }).kind).toBe('input')
    expect(validateInput({ rawName: 'a', categories: [1] }).kind).toBe('input')
  })
})

describe('buildRequest', () => {
  it('ツール呼び出しを強制し、商品名はデータとして囲んで渡す', () => {
    const req = buildRequest({ rawName: '牛乳', categories: ['飲料'] })
    expect(req.tool_choice).toEqual({ type: 'tool', name: TOOL_NAME })
    expect(req.tools[0].input_schema.required).toEqual(['name', 'category'])
    expect(req.messages[0].content).toContain('<raw_name>牛乳</raw_name>')
    expect(req.messages[0].content).toContain('飲料')
  })

  it('カテゴリが無いときも組み立てられる', () => {
    expect(buildRequest({ rawName: 'a', categories: [] }).messages[0].content).toContain('まだなし')
  })
})

describe('parseSuggestion', () => {
  it('正しい形の出力を取り出す', () => {
    expect(parseSuggestion(toolReply({ name: ' 牛乳 1L ', category: '飲料' }))).toEqual({
      ok: true,
      suggestion: { name: '牛乳 1L', category: '飲料' },
    })
  })

  it('間違った出力は捨てる（output エラー）', () => {
    const bad = [
      { content: [{ type: 'text', text: 'こんにちは' }] }, // ツールを呼ばなかった
      toolReply({ name: '', category: '飲料' }), // 空
      toolReply({ name: 123, category: '飲料' }), // 型が違う
      toolReply({ category: '飲料' }), // 項目が無い
      toolReply({ name: 'a'.repeat(MAX_NAME_LENGTH + 1), category: '飲料' }), // 長すぎる
      toolReply({ name: '牛乳', category: 'あ'.repeat(31) }), // カテゴリが長すぎる
      {},
      null,
    ]
    for (const r of bad) {
      const out = parseSuggestion(r)
      expect(out.ok).toBe(false)
      expect(out.kind).toBe('output')
    }
  })

  it('カテゴリが空でも名前があれば使える', () => {
    expect(parseSuggestion(toolReply({ name: '卵', category: '' })).ok).toBe(true)
  })
})

describe('suggestProduct', () => {
  it('入力が不正なら、AIを呼ばない', async () => {
    const client = { messages: { create: vi.fn() } }
    const r = await suggestProduct(client, { rawName: '' })
    expect(r.ok).toBe(false)
    expect(client.messages.create).not.toHaveBeenCalled()
  })

  it('AIの答えを検証して返す', async () => {
    const client = { messages: { create: vi.fn().mockResolvedValue(toolReply({ name: '牛乳', category: '飲料' })) } }
    const r = await suggestProduct(client, { rawName: '【送料無料】牛乳 1L', categories: ['飲料'] })
    expect(r).toEqual({ ok: true, suggestion: { name: '牛乳', category: '飲料' } })
    expect(client.messages.create).toHaveBeenCalledTimes(1)
  })
})
