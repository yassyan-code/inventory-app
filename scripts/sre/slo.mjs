// 第66課題: SLO / SLI / エラーバジェットの計算（外部に依存しない純粋な関数。テストあり）。
// 測定の記録 1件 = { t: 時刻(ms), id: 'web' | 'data', ok: boolean, ms: 応答時間 }

export const WINDOW_MS = 30 * 24 * 60 * 60 * 1000 // SLOの評価期間: 直近30日

// 目標。「月に何分の停止まで許せるか」から逆算した（根拠は docs/slo.md）
export const SLOS = [
  { key: 'web', label: '画面が開く（可用性）', target: 0.995, target_id: 'web', good: (r) => r.ok },
  { key: 'data', label: 'データ基盤に繋がる（可用性）', target: 0.995, target_id: 'data', good: (r) => r.ok },
  { key: 'speed', label: '画面が速い（1秒以内）', target: 0.95, target_id: 'web', good: (r) => r.ok && r.ms < 1000 },
]

// 燃焼率（バジェットを何倍の速さで使っているか）のしきい値。Google SRE本の考え方を、小さい規模に合わせて簡略化
export const BURN = { fast: { windowMs: 60 * 60 * 1000, rate: 14.4 }, slow: { windowMs: 6 * 60 * 60 * 1000, rate: 6 } }
export const MIN_SAMPLES = 5 // これ未満は「判定できない」（少ない測定で騒がない）

const within = (records, id, from, to) => records.filter((r) => r.id === id && r.t > from && r.t <= to)

function ratio(slo, rows) {
  const good = rows.filter(slo.good).length
  return { total: rows.length, good, bad: rows.length - good }
}

export function evaluate(records, now, slo) {
  const month = ratio(slo, within(records, slo.target_id, now - WINDOW_MS, now))
  const allowedBad = month.total * (1 - slo.target) // この測定数のうち、悪くてよい回数 = エラーバジェット
  const sli = month.total ? month.good / month.total : null
  const budgetLeft = allowedBad > 0 ? 1 - month.bad / allowedBad : month.bad === 0 ? 1 : -Infinity

  const burn = (w) => {
    const r = ratio(slo, within(records, slo.target_id, now - w.windowMs, now))
    return { total: r.total, rate: r.total ? r.bad / r.total / (1 - slo.target) : 0 }
  }
  const fast = burn(BURN.fast)
  const slow = burn(BURN.slow)

  let status = 'ok'
  let action = '通常運転'
  if (month.total < MIN_SAMPLES) {
    status = 'nodata'
    action = '測定が少なく判定不能'
  } else if (fast.total >= MIN_SAMPLES && fast.rate >= BURN.fast.rate) {
    status = 'page'
    action = '今すぐ対応（1時間でバジェットを使い切る速さ）'
  } else if (budgetLeft < 0) {
    status = 'freeze'
    action = 'バジェット超過: 新機能のリリースを止め、信頼性の修正だけ行う'
  } else if ((slow.total >= MIN_SAMPLES && slow.rate >= BURN.slow.rate) || budgetLeft < 0.25) {
    status = 'warn'
    action = '今日中に原因を調べる。リリースは慎重に'
  }
  return { ...slo, ...month, sli, allowedBad, budgetLeft, fast, slow, status, action }
}

export const evaluateAll = (records, now) => SLOS.map((s) => evaluate(records, now, s))

export const pct = (x, digits = 2) => (x == null ? '—' : `${(x * 100).toFixed(digits)}%`)
export const STATUS_LABEL = { ok: '正常', warn: '注意', page: '緊急', freeze: '凍結', nodata: 'データ不足' }
