# 課金①（第18回）— プラン設計と Stripe 決済

## プラン設計

課金対象は **チーム（テナント）** 単位。`teams` 1行につき 1サブスク。

| | 無料プラン | Pro プラン |
|---|---|---|
| 月額 | ¥0 | **¥1,980**（税込・Stripe テストモードでは通貨JPY） |
| 商品登録 | **50件まで**（DBトリガーで強制） | 無制限 |
| チームメンバー | 制限なし（招待フロー自体が未実装） | 制限なし |
| 在庫の入出庫・一覧・CSV・AIチャット | 使える | 使える |
| アップグレード操作 | チームの管理者（owner）のみ | — |

- 差別化は当面「商品登録の件数上限」1点に絞る。増やすのは後から `008` のトリガーと `PlanControls` を触るだけ。
- 無料上限の判定は **DB トリガー `enforce_free_plan_product_limit`**（`supabase/008_add_billing.sql`）。画面側の文言表示は補助で、API を直接叩いても 50 件で `check_violation` になる。

## データモデル

`teams` に追加（`008_add_billing.sql`）:

| 列 | 用途 |
|---|---|
| `plan` | `'free'` / `'pro'`。アプリはこれだけ見ればよい |
| `plan_status` | Stripe の `subscription.status` をそのまま（`active` / `past_due` / `canceled` …） |
| `stripe_customer_id` | Stripe 顧客 |
| `stripe_subscription_id` | Stripe サブスク |
| `current_period_end` | 現在の課金期間の終わり |

書き込みは **Webhook が service_role で行う**（RLS 貫通）。メンバーは既存の SELECT ポリシーで `plan` を読める。

## サーバー関数（`api/`）

| ファイル | 役割 |
|---|---|
| `api/checkout.js` | 管理者が「Proにアップグレード」→ Stripe Checkout セッションを作成し URL を返す |
| `api/stripe-webhook.js` | Stripe からのイベントで `teams.plan` 等を更新。署名検証あり（生ボディ必要なので `bodyParser: false`） |
| `api/billing-portal.js` | Pro の管理者が支払い方法変更・解約（Stripe カスタマーポータル）へ |
| `api/_lib/clients.js` | Stripe / Supabase クライアントとトークン検証の共有コード（`_` 始まりなので関数ルートにならない） |

## 必要な環境変数（サーバー専用・`VITE_` なし）

`.env`（ローカル）と Vercel 本番/プレビューの両方に設定:

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_ID=price_...            # Pro プランの月額 recurring Price
STRIPE_WEBHOOK_SECRET=whsec_...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...         # Supabase > Project Settings > API の service_role
```

## Stripe セットアップ手順（テストモード）

### 1. アカウント作成
1. https://dashboard.stripe.com/register でメール・パスワードだけ登録（本人確認は不要。テストモードは即使える）
2. ダッシュボード右上のトグルが **「テスト環境」** になっていることを常に確認

### 2. 商品と価格を作る
1. 左メニュー **商品カタログ** → 「商品を追加」
2. 名前: `在庫管理アプリ Pro` / 料金体系: **継続** / 金額: `1980` / 通貨: `JPY` / 請求期間: 月次
3. 保存後、その価格の **API ID（`price_...`）** をコピー → `STRIPE_PRICE_ID`

### 3. シークレットキー
1. 左メニュー **開発者** → **APIキー**
2. 「シークレットキー」（`sk_test_...`）をコピー → `STRIPE_SECRET_KEY`

### 4. Webhook
**ローカル開発（推奨）**: Stripe CLI
```
stripe login
stripe listen --forward-to localhost:3000/api/stripe-webhook
```
表示される `whsec_...` を `STRIPE_WEBHOOK_SECRET` に。`vercel dev` でローカルサーバーを 3000 で起動しておく。

**デプロイ環境**: ダッシュボード **開発者 → Webhook** → エンドポイント追加
- URL: `https://<デプロイURL>/api/stripe-webhook`
- 送信イベント: `checkout.session.completed` / `customer.subscription.updated` / `customer.subscription.deleted`
- 作成後の「署名シークレット」を `STRIPE_WEBHOOK_SECRET` に（環境ごとに違う値）

### 5. テスト決済
- カード番号 `4242 4242 4242 4242` / 期限は未来の任意 / CVC 任意 / 郵便番号任意
- Checkout 完了 → `/?checkout=success` に戻る → Webhook が `teams.plan='pro'` に更新 → ヘッダーが「Pro」に変わり、商品 50 件超の登録が通るようになる

## マイグレーション適用順

`supabase/008_add_billing.sql` を ① staging（`rhowcziknvabdranlhvf`）→ ② production（`noygjyxinkriupwequvt`）の順で SQL Editor で実行。

## 継続課金の運用（第19回）

### 状態モデル

`teams.plan_status` に Stripe の `subscription.status` をそのまま入れ、`teams.plan`（`free`/`pro`）は「機能が使えるか」の判定用に落とし込む。

| plan_status | 意味 | teams.plan | アプリの挙動 |
|---|---|---|---|
| `active` / `trialing` | 正常 | `pro` | Pro 機能フル |
| `past_due` | 支払い失敗・**猶予中**（Stripe が自動リトライ） | `pro` | Pro 機能は使える＋赤い警告バナー |
| `unpaid` / `canceled` | 停止 | `free` | 無料プラン扱い（商品50件上限が再適用） |

`cancel_at_period_end = true` … 期末解約が予約された状態。期末までは `active` のまま Pro、期末に `customer.subscription.deleted` が飛んで `free` に落ちる。

判定ロジックは `api/_lib/billing-state.js`（`planFromStatus` / `patchFromSubscription`）に集約。フロントは `getMyMembership()` が返す `isPro` / `pastDue` / `scheduledCancel` を見る。

### Webhook が処理するイベント

| イベント | 処理 |
|---|---|
| `checkout.session.completed` | 初回 Pro 化（保険。通常は `checkout-sync` が先） |
| `customer.subscription.created` / `updated` | `patchFromSubscription` で status・`cancel_at_period_end`・期末日を反映 |
| `customer.subscription.deleted` | `free` / `canceled` に停止、`stripe_subscription_id` クリア |
| `invoice.payment_succeeded` / `invoice.paid` | `active` に復帰 |
| `invoice.payment_failed` | `past_due`（猶予）。Pro は維持 |

### 解約フローとデータの扱い

- 解約は Stripe カスタマーポータル（「プラン管理」ボタン）から。既定は**期末解約**。
- 期末までは Pro のまま。ヘッダーに「解約予定」バッジ＋「◯月◯日まで利用できます」バナー。
- 期末に `subscription.deleted` → `free` へ。**データは削除しない**。無料枠（50件）を超える商品があっても既存分は閲覧・編集・在庫増減とも可能で、`products` への**新規 insert だけ**トリガーで拒否される。

### ローカルで Webhook を試す

`vercel dev` は `bodyParser: false` を無視して署名検証が通らない。ローカル検証時のみ `.env` に

```
STRIPE_WEBHOOK_SKIP_VERIFY=1
```

を置くと署名検証をスキップし、`req.body`（パース済み）をそのままイベントとして扱う。**本番には絶対に設定しない。**

```
# ターミナル1: ローカルサーバー
npx vercel dev --listen 3000
# ターミナル2: Stripe→ローカルへ転送
stripe listen --api-key sk_test_... --forward-to localhost:3000/api/stripe-webhook
# ターミナル3: イベントを発火
stripe trigger invoice.payment_failed --api-key sk_test_...
stripe trigger customer.subscription.deleted --api-key sk_test_...
```

本番では `STRIPE_WEBHOOK_SKIP_VERIFY` を設定せず、Stripe ダッシュボードで登録した Webhook エンドポイントの署名シークレット（`whsec_...`）を `STRIPE_WEBHOOK_SECRET` に入れる。

## マイグレーション適用順（第19回分）

`supabase/009_billing_lifecycle.sql`（`teams.cancel_at_period_end` 追加）を ① staging → ② production の順で実行。
