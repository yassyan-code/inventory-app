// DB 固定ウィンドウ方式のレート制限。サーバーレスの複数インスタンス間でも
// カウントを共有できる（インメモリだとインスタンスごとに別勘定になる）。
//
// 使い方:
//   const rl = await enforceRateLimit(auth.anon, `chat:${auth.user.id}`, 10, 60)
//   if (!rl.ok) { res.status(429).json({ error: 'rate_limited', retryAfter: rl.retryAfter }); return }

export async function enforceRateLimit(client, key, max, windowSeconds) {
  const { data, error } = await client.rpc('check_rate_limit', {
    p_key: key,
    p_max: max,
    p_window_seconds: windowSeconds,
  })
  if (error) {
    // 制限の確認自体が失敗したら、可用性を優先して通す（ログは残す）
    console.error('[ratelimit] rpc error:', error.message)
    return { ok: true }
  }
  return { ok: data === true, retryAfter: windowSeconds }
}
