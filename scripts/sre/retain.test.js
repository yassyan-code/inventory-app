import { describe, it, expect } from 'vitest'
import { keepRecent } from './retain.mjs'

const NOW = Date.UTC(2026, 9, 20)
const DAY = 24 * 60 * 60 * 1000
const line = (daysAgo) => JSON.stringify({ t: NOW - daysAgo * DAY, id: 'web', ok: true, status: 200, ms: 100 })

describe('keepRecent', () => {
  it('31日より古い行は捨て、新しい行は残す', () => {
    const out = keepRecent([line(40), line(31.5), line(30), line(0)].join('\n'), NOW, 31)
    expect(out.split('\n')).toHaveLength(2)
  })

  it('ちょうど31日前は残す（境界）', () => {
    expect(keepRecent(line(31), NOW, 31)).toBe(line(31))
  })

  it('壊れた行と空行は捨てるが、他の行は読める', () => {
    const out = keepRecent([line(1), '{"t":', '', line(2)].join('\n'), NOW, 31)
    expect(out.split('\n')).toHaveLength(2)
  })

  it('空の入力は空文字', () => {
    expect(keepRecent('', NOW)).toBe('')
  })
})
