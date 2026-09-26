// /api/chat を悪用から守るための部品（認証・入力チェック・回数制限）。
// api/ 直下の「_」始まりのフォルダは Vercel が関数として公開しない。

export const MAX_MESSAGES = 20
export const MAX_CONTENT_LENGTH = 2000 // フロント(ChatPanel)の上限と揃える

// 入力を検証し、role と content だけに絞った配列を返す。
// 想定外の role(system 等)・巨大な入力・不正な型は拒否する。
export function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: 'messages is required' }
  }
  if (messages.length > MAX_MESSAGES) {
    return { ok: false, error: `messages は${MAX_MESSAGES}件以内にしてください` }
  }

  const cleaned = []
  for (const m of messages) {
    const role = m?.role
    const content = m?.content
    if (role !== 'user' && role !== 'assistant') {
      return { ok: false, error: 'invalid role' }
    }
    if (typeof content !== 'string' || content.trim() === '') {
      return { ok: false, error: 'invalid content' }
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      return { ok: false, error: `content は${MAX_CONTENT_LENGTH}文字以内にしてください` }
    }
    cleaned.push({ role, content })
  }

  if (cleaned[cleaned.length - 1].role !== 'user') {
    return { ok: false, error: 'last message must be from user' }
  }
  return { ok: true, messages: cleaned }
}

// ユーザーごとの回数制限（メモリ上）。
// サーバーレスはインスタンスごとに状態が別なので「完全な上限」ではなく、
// 連打・ループによる大量消費を抑えるための最低限の防波堤。
export function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const hits = new Map() // key -> [timestamp, ...]
  return {
    allow(key) {
      const t = now()
      const recent = (hits.get(key) ?? []).filter((ts) => t - ts < windowMs)
      if (recent.length >= limit) {
        hits.set(key, recent)
        return false
      }
      recent.push(t)
      hits.set(key, recent)
      return true
    },
  }
}

// Authorization ヘッダーの Supabase アクセストークンを Supabase Auth に検証してもらい、
// 正しければユーザーIDを返す。それ以外はすべて null（安全側に倒す）。
export async function getUserId(authHeader, { url, anonKey, fetchImpl = fetch }) {
  const match = /^Bearer\s+(\S+)$/.exec(authHeader ?? '')
  if (!match || !url || !anonKey) return null

  try {
    const res = await fetchImpl(`${url}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${match[1]}` },
    })
    if (!res.ok) return null
    const user = await res.json()
    return user?.id ?? null
  } catch {
    return null
  }
}
