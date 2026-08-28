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

## 次回（第19回）

継続課金の運用：請求失敗（`invoice.payment_failed`）・解約・復活を Webhook で正しく回す。`plan_status` の `past_due` ハンドリング、猶予期間など。
