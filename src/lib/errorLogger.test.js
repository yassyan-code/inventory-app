import { describe, it, expect, vi, beforeEach } from 'vitest'

const insert = vi.fn()
vi.mock('./supabaseClient', () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u1' } } } })) },
    from: vi.fn(() => ({ insert })),
  },
}))

const { buildErrorRecord, logError, resetErrorLoggerState } = await import('./errorLogger')

beforeEach(() => {
  insert.mockReset()
  insert.mockResolvedValue({ error: null })
  resetErrorLoggerState()
})

describe('buildErrorRecord', () => {
  it('Error からメッセージとスタックを取り出す', () => {
    const rec = buildErrorRecord(new Error('boom'), 'react')
    expect(rec.message).toBe('boom')
    expect(rec.source).toBe('react')
    expect(rec.stack).toContain('boom')
  })

  it('Error 以外（文字列など）も記録できる', () => {
    const rec = buildErrorRecord('plain reject', 'unhandledrejection')
    expect(rec.message).toBe('plain reject')
    expect(rec.stack).toBeNull()
  })

  it('長すぎるメッセージは DB 制約に合わせて切り詰める', () => {
    const rec = buildErrorRecord(new Error('x'.repeat(5000)), 'react')
    expect(rec.message.length).toBe(2000)
  })
})

describe('logError', () => {
  it('error_logs に user_id 付きで insert する', async () => {
    await logError(new Error('boom'), 'react')
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert.mock.calls[0][0]).toMatchObject({ message: 'boom', source: 'react', user_id: 'u1' })
  })

  it('同じエラーの連投は1回にまとめる', async () => {
    await logError(new Error('same'), 'react')
    await logError(new Error('same'), 'react')
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it('1セッションの送信数に上限がある', async () => {
    for (let i = 0; i < 30; i++) await logError(new Error(`e${i}`), 'react')
    expect(insert).toHaveBeenCalledTimes(20)
  })

  it('記録に失敗しても例外を投げない', async () => {
    insert.mockRejectedValue(new Error('db down'))
    await expect(logError(new Error('boom'), 'react')).resolves.toBeUndefined()
  })
})
