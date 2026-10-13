import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runAgent, LIMITS } from './agent.mjs'
import { createTools, MAX_BODY } from './tools.mjs'

// 台本どおりに動く偽のAI。1回ごとに scripts の次の要素（tool_use のリスト）を返す
const fakeClient = (script, usage = { input_tokens: 100, output_tokens: 50 }) => {
  let i = 0
  return {
    messages: {
      create: async () => {
        const s = script[Math.min(i++, script.length - 1)]
        return { content: s.map((u, n) => ({ type: 'tool_use', id: `t${i}-${n}`, name: u.name, input: u.input })), usage }
      },
    },
  }
}
const use = (name, input) => ({ name, input })
const setup = () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-'))
  return { reportDir, ...createTools({ reportDir }) }
}

describe('正常な流れ', () => {
  it('調べて→探して→保存で終わる', async () => {
    const { impl, saved } = setup()
    const r = await runAgent({
      goal: 'x',
      tools: impl,
      client: fakeClient([
        [use('list_low_stock', { threshold: 5 })],
        [use('search_docs', { query: '在庫の補充' })],
        [use('save_report', { title: 't', body: '# 本文' })],
      ]),
    })
    expect(r.status).toBe('done')
    expect(saved).toHaveLength(1)
    expect(fs.readFileSync(saved[0], 'utf8')).toContain('本文')
  })
})

describe('安全ガード', () => {
  it('許可リストに無い道具は実行されない', async () => {
    const { impl } = setup()
    const r = await runAgent({ goal: 'x', tools: impl, client: fakeClient([[use('delete_all', {})], [use('save_report', { title: 't', body: 'b' })]]) })
    expect(r.blocked).toContainEqual({ step: 1, tool: 'delete_all', reason: 'not_allowed' })
    expect(r.status).toBe('done')
  })

  it('"constructor" のような名前でも許可リストを抜けられない', async () => {
    const { impl } = setup()
    const r = await runAgent({ goal: 'x', tools: impl, client: fakeClient([[use('constructor', {})], [use('save_report', { title: 't', body: 'b' })]]) })
    expect(r.blocked[0].reason).toBe('not_allowed')
  })

  it('同じ道具は回数の上限を超えて呼べない', async () => {
    const { impl } = setup()
    const r = await runAgent({ goal: 'x', tools: impl, client: fakeClient([[use('search_docs', { query: '在庫' })]]) })
    expect(r.blocked.filter((b) => b.reason === 'call_limit').length).toBeGreaterThan(0)
    expect(r.trace.filter((t) => t.tool === 'search_docs' && !t.result.error)).toHaveLength(LIMITS.maxCallsPerTool.search_docs)
  })

  it('ステップ数の上限で止まる（無限ループしない）', async () => {
    const { impl } = setup()
    const r = await runAgent({ goal: 'x', tools: impl, client: fakeClient([[use('list_low_stock', { threshold: 1 })]]), limits: { ...LIMITS, maxSteps: 3 } })
    expect(r.status).toBe('step_limit')
  })

  it('トークンの上限で止まる', async () => {
    const { impl } = setup()
    const r = await runAgent({
      goal: 'x',
      tools: impl,
      client: fakeClient([[use('list_low_stock', { threshold: 1 })]], { input_tokens: 30000, output_tokens: 0 }),
      limits: { ...LIMITS, maxTotalTokens: 50000 },
    })
    expect(r.status).toBe('token_limit')
  })

  it('保存は1回だけ。2回目は書かれない', async () => {
    const { impl, saved } = setup()
    await runAgent({ goal: 'x', tools: impl, client: fakeClient([[use('save_report', { title: 'a', body: 'b' }), use('save_report', { title: 'c', body: 'd' })]]) })
    expect(saved).toHaveLength(1)
  })

  it('保存先はAIに決めさせない（パスを渡しても reportDir の中にだけ書く）', async () => {
    const { impl, saved, reportDir } = setup()
    await runAgent({ goal: 'x', tools: impl, client: fakeClient([[use('save_report', { title: 't', body: 'b', path: '../../.env', file: '../x.md' })]]) })
    expect(path.dirname(saved[0])).toBe(reportDir)
  })

  it('おかしな引数は拒否される（長すぎる本文・範囲外の数・型違い）', async () => {
    const { impl, saved } = setup()
    expect(impl.save_report({ title: 't', body: 'a'.repeat(MAX_BODY + 1) }).error).toBeTruthy()
    expect(impl.save_report({ title: 123, body: 'b' }).error).toBeTruthy()
    expect(impl.list_low_stock({ threshold: -1 }).error).toBeTruthy()
    expect(impl.list_low_stock({ threshold: '5' }).error).toBeTruthy()
    expect(impl.search_docs({ query: '' }).error).toBeTruthy()
    expect(saved).toHaveLength(0)
  })

  it('道具が例外を投げてもエージェントは落ちない', async () => {
    const r = await runAgent({ goal: 'x', tools: { list_low_stock: () => { throw new Error('boom') } }, client: fakeClient([[use('list_low_stock', { threshold: 1 })]]), limits: { ...LIMITS, maxSteps: 2 } })
    expect(r.trace[0].result.error).toContain('boom')
  })

  it('AIの呼び出しが失敗したら api_error で終わる', async () => {
    const { impl } = setup()
    const client = { messages: { create: async () => { throw new Error('down') } } }
    expect((await runAgent({ goal: 'x', tools: impl, client })).status).toBe('api_error')
  })
})
