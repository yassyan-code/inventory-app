// Supabase Auth が返す英語エラーを、利用者向けの日本語文言に変換する。
// マッチしない場合は原文を添えて返す（サポート問い合わせ時の手がかりになるため）。
const RULES = [
  [/invalid login credentials/i, 'メールアドレスかパスワードが違います。'],
  [/email not confirmed/i, 'メール確認がまだ完了していません。確認メールのリンクを開いてください。'],
  [/user already registered/i, 'このメールアドレスは既に登録されています。ログインしてください。'],
  [/password should be at least/i, 'パスワードが短すぎます（6文字以上にしてください）。'],
  [/for security purposes.*(\d+) seconds/i, '短時間に繰り返し実行されました。しばらく待って再度お試しください。'],
  [/rate limit|too many requests/i, '試行回数が多すぎます。しばらく待って再度お試しください。'],
  [/token has expired|invalid.*token/i, 'リンクの有効期限が切れています。もう一度手続きをやり直してください。'],
  [/new password should be different/i, '現在と同じパスワードは使えません。別のパスワードにしてください。'],
  [/unable to validate email address/i, 'メールアドレスの形式が正しくありません。'],
  [/network|fetch failed/i, '通信に失敗しました。電波状況を確認して再度お試しください。'],
]

export function toJapaneseAuthError(error) {
  const raw = typeof error === 'string' ? error : error?.message || '不明なエラー'
  for (const [pattern, message] of RULES) {
    if (pattern.test(raw)) return message
  }
  return `エラーが発生しました（${raw}）`
}
