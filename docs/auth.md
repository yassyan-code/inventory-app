# 認証基盤（第17回）

SaaS 品質の認証まわりの構成メモ。

## 実装済みの機能

| 機能 | 場所 |
|---|---|
| サインアップ（メール確認あり） | `src/components/Auth.jsx` |
| ログイン / ログアウト / セッション復元 | `Auth.jsx` / `App.jsx` |
| 確認メールの再送（未確認でログイン失敗した時に導線が出る） | `Auth.jsx` `handleResend` |
| パスワード再設定メール送信 | `Auth.jsx` `MODE.FORGOT` |
| 再設定リンクから新パスワード設定 | `src/components/ResetPassword.jsx`（`App.jsx` が `type=recovery` を検知して表示） |
| 認証エラーの日本語化 | `src/lib/authErrors.js` |
| 所属チーム名・ロール表示 | `App.jsx` ヘッダー（`getMyMembership()`） |
| ロールによる画面出し分け | 下記 |

## ロール（権限）

`team_members.role` が `owner` = 管理者、それ以外 = 一般ユーザー。

| 操作 | 管理者(owner) | 一般(member) |
|---|---|---|
| 在庫一覧の閲覧・CSVエクスポート | ○ | ○ |
| 在庫数の ±（入出庫） | ○ | ○ |
| 新規商品の登録 | ○ | ×（依頼メッセージを表示） |
| カテゴリ編集 | ○ | ×（テキスト表示のみ） |
| 商品の非表示 / 復元 | ○ | ×（ボタン非表示） |

- 画面側の出し分けは利便性のため。**本当の防御は RLS**（`supabase/007_role_write_policies.sql`）。
  API を直接叩かれても owner 以外は `products` の insert/update ができない。
- 新規サインアップ時はトリガーで本人が `owner` のチームが作られる（第16回）。
  同じチームに 2人目以降を member として追加する招待フローは未実装（積み残し）。

## Supabase 側の設定（重要）

パスワード再設定・メール確認のリンク先を Supabase が許可している必要がある。

1. Supabase ダッシュボード > Authentication > URL Configuration
2. **Site URL**: 本番URL（例 `https://<本番ドメイン>`）
3. **Redirect URLs** に以下を追加:
   - `https://<本番ドメイン>/`
   - `https://<プレビュー/staging URL>/`
   - `http://localhost:5173/`（ローカル開発）

未設定だと再設定メールのリンクが `otp_expired` 等で弾かれる。

## パスワードの扱い

パスワードのハッシュ化・保管は Supabase Auth（GoTrue）側で完結。
アプリのコードは平文パスワードを DB に保存していないし、ログにも出していない。
`api/chat.js` など自前のサーバー関数もパスワードを扱わない。

## マイグレーション適用順

`supabase/007_role_write_policies.sql` を
① staging(`rhowcziknvabdranlhvf`) → ② production(`noygjyxinkriupwequvt`) の順で SQL Editor に貼って実行。
