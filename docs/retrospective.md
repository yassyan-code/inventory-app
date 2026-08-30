# 23回のふりかえり — inventory-app を題材にした SaaS 構築

「作れる」から「売れるものを出せる」まで。全23回で inventory-app が積み上げたもの。

## Git×Railway 上級マスター（第1〜15回）

| 回 | 学び | 成果物 |
|---|---|---|
| 1–8（速習編） | Git の正体（コミット/HEAD/履歴）、Railway 接続、環境変数の安全な渡し方、staging 環境、ブランチ×環境の事故と復旧 | Railway に本番/staging、`staging` ブランチ運用 |
| 9–10 | きれいな歴史、reset / revert / reflog / stash を practice ブランチで実機体験 | — |
| 11 | protected branch とレビュー文化（PR 必須・直 push 禁止・force 禁止・enforce_admins） | master 保護 |
| 12 | GitHub Actions で lint→test→build を自動化、壊れた PR がマージブロックされる体験 | `.github/workflows/ci.yml`、Vitest |
| 13 | CI が緑になるまで Railway が本番デプロイを待つ直列ゲート | `source.checkSuites` |
| 14 | 本番 DB の運用：staging と production の DB 分離（別 Supabase プロジェクト）、staging 先行検証の手順、バックアップ/復元 | `inventory-app-staging` |
| 15 | 無停止デプロイ、Uptime Kuma で本番監視、障害復旧の型 | `docs/incident-runbook.md` |

## SaaS 本体編（第16〜23回）

| 回 | テーマ | 主な実装 |
|---|---|---|
| 16 | マルチテナント設計 | `teams` / `team_members`、全テーブルに `team_id`、RLS を team_id 単位に、サインアップで専用チーム自動生成、越境ゼロを SQL で実証 |
| 17 | 認証基盤 | パスワード再発行、確認メール再送、エラー日本語化、所属チーム＋ロール表示、ロール（owner/member）で画面と RLS を出し分け（`007`） |
| 18 | 課金① Stripe | Free / Pro（¥1,980/月）、Checkout、Webhook、無料は商品50件までを DB トリガーで強制。verify-on-return（`checkout-sync`）で Webhook 遅延に強く |
| 19 | 課金② 継続課金の運用 | `invoice.payment_failed`→past_due（猶予・Pro維持）、復活→active、期末解約→期末まで Pro→`deleted` で free。二重サブスク防止・解約イベントの取り違え防止も修正 |
| 20 | プラン制限とメータリング | CSVエクスポートを Pro 専用（機能ゲート）、AIチャット 無料20回/月（`use_ai_chat_quota` で確認＋加算を1トランザクション）、上限で `UpsellNote`（売上導線） |
| 21 | セキュリティ堅牢化 | 脅威リスト T1–T10、6テーブルに `force RLS`、DB 固定ウィンドウのレート制限、改ざん不可の監査ログ（トリガー＋書込ポリシー無し）、Webhook の本番 skip-verify 無効化 |
| 22 | 監視・信頼性・サポート | `/api/health`（DB疎通まで）、SLO 月99.5%、オンボーディング初回ガイド、運営用管理画面（`ADMIN_EMAILS` サーバー判定・MRR・監査ログ）、サポート導線 |
| 23 | 市場リリース | 利用規約・プライバシー・特商法のたたき＋アプリ内ページ、本番切替の安全な順番、最初の1件を通す手順 |

## 技術スタック（最終形）

- フロント: Vite + React（PWA、ルーターなしのタブ切替）
- サーバー: Vercel Functions（`api/chat` `api/checkout` `api/checkout-sync` `api/billing-portal` `api/stripe-webhook` `api/health` `api/admin-overview`）
- DB / 認証: Supabase（Postgres + Auth）、RLS でテナント分離＋ロール＋課金トリガー＋監査
- 決済: Stripe（サブスク、Checkout、カスタマーポータル、Webhook）
- デプロイ: Vercel（本番）/ Railway（本番・staging、Uptime Kuma 監視）
- CI: GitHub Actions（lint / test / build、master 保護＋必須チェック）

## この23回で身についた「型」

1. **staging で先に確かめてから production**。DB マイグレーションも Stripe も監視も同じ。
2. **強制はDB側、案内はフロント**。RLS・トリガー・RPC で越えられない線を引き、UI はその手前で親切にする。
3. **壊さず出す仕組み**：ブランチ保護 + CI ゲート + 無停止デプロイ + ロールバック手順 + 監視。
4. **SaaS は信頼商売**：テナント越境ゼロ・レート制限・監査ログ・法務は、出す前の必須装備。

## 次の道

ついたのは「作って・出して・回す」力。次は「**売る**」（顧客獲得・マーケ・グロース）。
