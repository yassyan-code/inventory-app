# 市場リリース チェックリスト＆最終手順（第23回）

有料 SaaS として世に出すための、法務チェックと本番切替の「安全な順番」。

## A. 法務（公開前に必ず専門家確認）

たたき台は `src/lib/legalContent.js`（アプリの `/?legal=terms` `/?legal=privacy` `/?legal=tokushoho` で表示）。`{{ }}` を実在の事業者情報で埋める。

- [ ] **利用規約** … 料金・自動更新・解約の効力時期・返金なし・禁止事項・データ帰属・免責・管轄を記載
- [ ] **プライバシーポリシー** … 取得情報 / 利用目的 / 第三者提供・委託（Stripe / Vercel / Railway / Supabase / Anthropic）/ 国外移転 / 保管期間 / 安全管理措置 / 開示請求窓口
- [ ] **特定商取引法に基づく表記** … 販売事業者・責任者・所在地・電話・メール・価格・支払時期・提供時期・返品可否・動作環境（有料販売なら必須）
- [ ] サインアップ画面に「登録＝規約・プライバシーに同意」を明示し、各ページへリンク（実装済み）
- [ ] 特商法表記を決済前に到達できる場所（フッター）に常設（実装済み）
- [ ] **弁護士・税理士の確認を受けた**（このリポジトリの文面はたたき台）

## B. 本番切替の順番（stagingで最終確認 → production）

1. **staging で一連を通す**：登録 → Pro 課金（テストカード）→ 有料機能 → 解約 → 支払い失敗（`invoice.payment_failed`）まで確認済みにする。
2. **PR #15 を master にマージ**（第16〜23回まとめ）。CI 緑を確認。
3. **マイグレーション適用**（staging → production の順、SQL Editor）：`006`〜`011` のうち production 未適用分を順に実行。`pg_policies` / 列存在で確認。
4. **Supabase 本番の Auth 設定**：URL Configuration の Site URL / Redirect URLs を本番ドメインに。
5. **独自ドメイン + SSL**：`docs/custom-domain.md` の手順。DNS 反映 → Let’s Encrypt 自動発行 → `https://` で鍵マーク確認。
6. **Stripe 本番モード**：
   - ダッシュボード右上を「本番」に切替
   - 商品「在庫管理アプリ Pro」/ 価格 ¥1,980・月次（`price_...`）を**本番モードで**作成
   - `sk_live_...` を取得
   - Webhook エンドポイントを `https://<本番ドメイン>/api/stripe-webhook` に登録し、イベント（`checkout.session.completed` / `customer.subscription.created|updated|deleted` / `invoice.paid|payment_failed|payment_succeeded`）を選択、署名シークレット `whsec_...` を取得
7. **Vercel 本番の環境変数**（Production スコープ）：
   `STRIPE_SECRET_KEY`(sk_live) / `STRIPE_PRICE_ID`(本番price) / `STRIPE_WEBHOOK_SECRET`(本番whsec) / `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `ANTHROPIC_API_KEY` / `ADMIN_EMAILS`（自分の本番ログインメール）。
   **`STRIPE_WEBHOOK_SKIP_VERIFY` は設定しない。**
8. **監視**：Uptime Kuma の監視先を `https://<本番ドメイン>/api/health` に変更、通知（メール / Discord）を有効化。`/api/health` が `status:"ok"` を返すことを確認。
9. **`SUPPORT_EMAIL`** を実在の問い合わせ先に変更して再デプロイ。
10. **ローカル `.env` を戻す**：`cp .env.bak .env`、`STRIPE_WEBHOOK_SKIP_VERIFY` と `ADMIN_EMAILS`（テスト値）の行を削除。
11. **チャットに平文で貼った `sk_test_` キーをローテーション**（Stripe ダッシュボード）。

## C. 最初の1件を通す

12. 本番ドメインで、新規メールで**サインアップ**（メール確認）→ ログイン。
13. 商品を1件登録（オンボーディングガイドが消えることを確認）。
14. 「Proにアップグレード」→ Stripe 本番決済（自分のカード。少額なので即解約すれば実損は月額1回分、またはクーポンで0円）。
15. ヘッダーが「Pro」になり、Stripe ダッシュボード（本番）に支払い記録・サブスクが出ることを確認。
16. `/api/stripe-webhook` が本番で 200 を返し、`teams.plan='pro'` になっていることを確認（`checkout-sync` と Webhook の両方）。
17. 解約 → 期末まで Pro、`cancel_at_period_end=true` を確認。
18. 本番に残ったテストデータ・不要サブスクを整理。

## D. 完了の証拠（提出物）

- 稼働している有料 SaaS の URL（`https://` / 鍵マーク）
- 規約 / 特商法 / プライバシーの3ページが公開されている（スクショ）
- Stripe 本番の支払い1件（スクショ、金額・日時）
- 23回のふりかえり（`docs/retrospective.md`）
