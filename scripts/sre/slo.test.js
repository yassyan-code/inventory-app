import { describe, it, expect } from 'vitest'
import { evaluate, SLOS, MIN_SAMPLES } from './slo.mjs'

const web = SLOS.find((s) => s.key === 'web') // 目標 99.5%
const speed = SLOS.find((s) => s.key === 'speed')
const NOW = Date.UTC(2026, 9, 15)
const MIN = 60 * 1000
// 直近 n 分、1分おきに測定。bad(i) が true の回は失敗
const series = (n, bad = () => false, ms = 200) =>
  Array.from({ length: n }, (_, i) => ({ t: NOW - (n - i - 1) * MIN, id: 'web', ok: !bad(i), ms }))

describe('SLI とバジェット', () => {
  it('全部成功なら SLI 100%・バジェット満タン・正常', () => {
    const r = evaluate(series(200), NOW, web)
    expect(r.sli).toBe(1)
    expect(r.budgetLeft).toBe(1)
    expect(r.status).toBe('ok')
  })

  it('1000件で 5件までの失敗が許容（99.5%）。2件失敗ならバジェット60%残り', () => {
    const r = evaluate(series(1000, (i) => i === 100 || i === 200), NOW, web)
    expect(r.allowedBad).toBeCloseTo(5)
    expect(r.budgetLeft).toBeCloseTo(0.6)
    expect(r.status).toBe('ok')
  })

  it('バジェット残り25%未満は注意、使い切ると凍結', () => {
    const warn = evaluate(series(1000, (i) => [100, 200, 300, 400].includes(i)), NOW, web)
    expect(warn.status).toBe('warn')
    const freeze = evaluate(series(1000, (i) => i < 6 * 10 && i % 10 === 0), NOW, web)
    expect(freeze.budgetLeft).toBeLessThan(0)
    expect(freeze.status).toBe('freeze')
  })

  it('直近1時間で急に落ち続けていたら緊急（燃焼率が高い）', () => {
    const r = evaluate(series(300, (i) => i >= 290), NOW, web) // 直近10分が全滅
    expect(r.fast.rate).toBeGreaterThanOrEqual(14.4)
    expect(r.status).toBe('page')
  })

  it('測定が少ないうちは判定しない（騒がない）', () => {
    const r = evaluate(series(MIN_SAMPLES - 1, () => true), NOW, web)
    expect(r.status).toBe('nodata')
  })

  it('30日より古い測定は数えない', () => {
    const old = [{ t: NOW - 31 * 24 * 60 * MIN, id: 'web', ok: false, ms: 200 }]
    expect(evaluate([...old, ...series(50)], NOW, web).bad).toBe(0)
  })

  it('速さのSLI: 1秒以上かかった測定は「悪い」に数える', () => {
    const rows = [...series(18, () => false, 300), ...series(2, () => false, 1500).map((r, i) => ({ ...r, t: r.t - (i + 1) * 1000 }))]
    const r = evaluate(rows, NOW, speed)
    expect(r.bad).toBe(2)
    expect(r.sli).toBeCloseTo(0.9)
  })
})
