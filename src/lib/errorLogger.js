// アプリ内エラーを Supabase の error_logs テーブルに記録する。
// 記録の失敗でアプリ本体を壊さないよう、ここで起きた例外はすべて握りつぶす。

import { supabase } from './supabaseClient'

const MAX_PER_SESSION = 20 // 無限ループ等で DB を叩き続けないための上限
const DEDUPE_MS = 10_000 // 同じエラーの連投を間引く時間

const lastSeen = new Map()
let sentCount = 0

function clip(value, max) {
  if (value == null) return null
  const text = String(value)
  return text.length > max ? text.slice(0, max) : text
}

export function buildErrorRecord(error, source) {
  const isError = error instanceof Error
  return {
    source: clip(source, 50),
    message: clip(isError ? error.message : String(error), 2000) || '(no message)',
    stack: isError ? clip(error.stack, 8000) : null,
    url: clip(globalThis.location?.href, 2000),
    user_agent: clip(globalThis.navigator?.userAgent, 500),
  }
}

export async function logError(error, source = 'unknown') {
  try {
    const record = buildErrorRecord(error, source)

    const key = `${record.source}:${record.message}`
    const now = Date.now()
    if (now - (lastSeen.get(key) ?? 0) < DEDUPE_MS) return
    if (sentCount >= MAX_PER_SESSION) return
    lastSeen.set(key, now)
    sentCount += 1

    const { data } = await supabase.auth.getSession()
    record.user_id = data?.session?.user?.id ?? null

    await supabase.from('error_logs').insert(record)
  } catch {
    // 記録できなくても何もしない（エラー記録がエラーを生むのを避ける）
  }
}

// window 全体の未処理エラーを拾う。React の描画エラーは ErrorBoundary が担当。
export function installGlobalErrorHandlers(target = window) {
  target.addEventListener('error', (event) => {
    logError(event.error ?? event.message, 'window.onerror')
  })
  target.addEventListener('unhandledrejection', (event) => {
    logError(event.reason, 'unhandledrejection')
  })
}

// テスト用: 間引き・上限の内部状態を初期化する
export function resetErrorLoggerState() {
  lastSeen.clear()
  sentCount = 0
}
