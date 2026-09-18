# SaaS セキュリティ（第21回）

「顧客のデータとお金を扱う SaaS は常に狙われる」前提での守り。攻撃者の目で洗い出した脅威と、塞いだ対策。

## 脅威リスト（攻撃者の目）

| # | 脅威 | シナリオ | 深刻度 | 対策 |
|---|---|---|---|---|
| T1 | **テナント越境（読み取り）** | 他チームの `products` / `stock_*` / `usage_counters` / `audit_log` が見える | 最悪 | 全テナントテーブルに RLS + **force RLS**。`team_id in (select ... where user_id = auth.uid())` で統一。`011` で越境テスト再実施 |
| T2 | **テナント越境（書き込み）** | 他チームの `team_id` を指定して insert/update | 最悪 | INSERT は `with check`、UPDATE は `using` で team_id を検証。商品マスタ書き込みは owner のみ（`007`） |
| T3 | **サーバー関数の取り違え** | `service_role`（RLS 貫通）を使う API が team を絞らず他テナントを操作 | 高 | `api/_lib/clients.js` の `getUserTeam` / `getOwnerTeam` で「呼び出し元のチーム」しか触らせない。Webhook は署名検証後の `metadata.team_id` / `stripe_customer_id` 一致のみ |
| T4 | **Webhook 偽装** | 署名なしの偽イベントを POST して任意チームを Pro 化 / 解約 | 高 | `stripe.webhooks.constructEvent` で署名必須。`STRIPE_WEBHOOK_SKIP_VERIFY` は `VERCEL_ENV=production` では**無効化**（誤設定しても効かない） |
| T5 | **総当たり / 連打** | ログイン試行、パスワード再発行、AIチャット乱打（API コスト）、決済セッション乱造 | 中〜高 | 認証系は Supabase Auth 側でレート制限。自前 API は `check_rate_limit` RPC（DB 固定ウィンドウ、インスタンス跨ぎで共有）: chat 10/60s・checkout 5/300s・sync 20/60s・portal 10/300s |
| T6 | **権限の穴** | 一般ユーザーが管理操作（商品登録・カテゴリ編集・非表示・アップグレード） | 中 | `007` の owner 限定ポリシー + フロントの出し分け（第17回）。課金 API は `getOwnerTeam` |
| T7 | **入力の膨張** | 巨大な `messages` 配列 / 長文を `api/chat` に送って LLM コストを増やす | 中 | サーバー側で `MAX_MESSAGES=50` / `MAX_CHARS_PER_MESSAGE=4000` を強制（フロントの 2000 制限は信用しない） |
| T8 | **メータリングのすり抜け** | 無料枠 20 回を並列リクエストで超過 | 中 | `use_ai_chat_quota` が「確認＋加算」を1トランザクション（`010`）。二重カウントも取りこぼしも無し |
| T9 | **監査の不在** | 不正が起きても「誰が・いつ・何をしたか」を追えない | 中 | `audit_log` テーブル + DB トリガー（`products` の作成/非表示/カテゴリ変更、`team_members` のロール変更）+ サーバーからの明示記録（checkout 開始・plan 更新）。ログは RLS で自チームのみ読める・**書き込みポリシー無し＝改ざん不可** |
| T10 | **論理削除の破壊** | `stock_movements` の親 `products` を物理削除して履歴を壊す | 低 | 物理 DELETE ポリシーをどのテーブルにも作らない（RLS 有効時は既定拒否）。アプリは `archived_at` の論理削除のみ |

## 塞いだ対策（この回で実装）

### ① テナント越境の抜け道を詰める（`011_security_hardening.sql`）
- `teams` / `team_members` / `products` / `stock_items` / `stock_movements` / `usage_counters` に `force row level security`。
  RLS「有効」だけだとテーブル所有者ロールや security definer 関数からポリシーを素通りできる余地が残るため、`force` で所有者にも必ず適用。`service_role` は `BYPASSRLS` 権限で従来どおり通る（Webhook 等に影響なし）。
- 越境テストを `supabase/tenant_isolation_check.sql` で再実施（新テーブル含む）。

### ② レート制限（`011` + `api/_lib/ratelimit.js`）
- `rate_limits(key, window_start, count)` + `check_rate_limit(key, max, window_seconds)` RPC（`security definer`、固定ウィンドウ）。
- サーバーレスの複数インスタンス間でカウントを共有（インメモリだとインスタンスごとに別勘定になる）。
- 適用: `chat` 10/60s、`checkout` 5/300s、`checkout-sync` 20/60s、`billing-portal` 10/300s。キーは `endpoint:user_id`。
- 制限確認 RPC 自体が失敗したら可用性優先で通す（fail-open）＋ログ。

### ③ 監査ログ（`011`）
- `audit_log(team_id, actor_user_id, action, target, meta, created_at)`。RLS で自チームのみ読める、書き込みポリシー無し。
- 自動記録トリガー: `products`（create / archive / unarchive / category_change）、`team_members`（role_change）。
- 明示記録: `api/checkout.js`（`billing.checkout_started`）、`api/stripe-webhook.js`（`billing.plan_updated`、actor は null＝Stripe 起因）。
- アプリからの任意記録用に `write_audit(action, target, meta)` RPC。

### ④ Webhook / 入力の締め
- `STRIPE_WEBHOOK_SKIP_VERIFY` は本番無効化。
- `api/chat.js` にサーバー側の入力上限。

## テナント越境ゼロの再確認（③）

`supabase/tenant_isolation_check.sql` を staging の SQL Editor で実行し、tenant-a / tenant-b それぞれになりすまして:
- 自チームのデータしか SELECT できない（`products` / `stock_items` / `stock_movements` / `usage_counters` / `audit_log`）
- 他チームの `team_id` 指定 insert が `row-level security` で拒否される

を確認する。結果は同ファイル末尾の「実測ログ」に追記。

## マイグレーション適用順

`supabase/011_security_hardening.sql` を ① staging(`rhowcziknvabdranlhvf`) → ② production(`noygjyxinkriupwequvt`)。

## 残っている既知リスク（今後）

- 招待フロー未実装のため `team_members` への追加経路はサインアップ時トリガーのみ（現状は攻撃面が小さい）。招待を作るときは招待トークンの検証を厳格に。
- `api/chat.js` の IP ベースのレート制限は未実装（ユーザー単位のみ）。未認証で叩ける経路が増えたら追加。
- 監査ログの保持期間・エクスポート・アラートは未整備（第22回の監視で扱う）。
