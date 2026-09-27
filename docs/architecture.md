# アーキテクチャ設計図（第55課題・作る前に全体像を描く）

作成日: 2026-09-27。既存の実装をもとに「今、実際にどう組み立っているか」を描き起こしたもの。
新規に何かを作る前に、まず現状の全体像を正しく描けるかを確認する回。

> **同日追記（重要な訂正）**: 作成直後、本番は実は**Railway**であり、以下の図で「本番」としていた
> Vercelは実際にはSSO保護がかかっていて一般ユーザーはアクセスできないことが判明した。
> `/api/chat`（Vercel Functions前提）はRailwayでは動かないため、現在チャット機能は無効化している。
> 以下の図・本文は誤りを含んだまま残し、実態は`docs/handover.md`を正とする
> （「図を描いても実物と照合しなければ誤りに気づけない」という教訓として、あえて修正せず残す）。

## 1. 全体構成図

```
                          ┌─────────────────────────┐
                          │        ブラウザ           │
                          │  React SPA (PWA) + Vite  │
                          │  タブ切替: スキャン登録/    │
                          │  在庫一覧/チャット          │
                          └───────────┬───────────────┘
                                      │
                 ┌────────────────────┼──────────────────────┐
                 │                    │                       │
                 ▼                    ▼                       ▼
      ┌─────────────────┐   ┌─────────────────┐    ┌──────────────────┐
      │ Supabase Auth    │   │ Supabase Postgres │   │ 自前サーバー(BFF)  │
      │ (メール+PW認証)   │   │ (RLSでチーム分離)  │   │ /api/chat (Vercel │
      │                  │   │ products/         │   │ Functions)        │
      │                  │   │ stock_items/       │   └─────────┬─────────┘
      │                  │   │ stock_movements/   │             │
      │                  │   │ error_logs/…       │             ▼
      └────────┬─────────┘   └─────────┬──────────┘   ┌──────────────────┐
               │                       │              │ Anthropic API     │
               │ JWT発行                │ REST/RPC      │ (Claude Opus)     │
               └───────────┬───────────┘ (フロントが直接)└──────────────────┘
                           │
                           ▼
                 チームごとに行が分離
                 (team_id + RLS)

      ┌─────────────────┐
      │ Yahoo!ショッピング  │◀── フロントから直接fetch（バーコード→商品名の自動取得、任意）
      │ 商品検索API        │
      └─────────────────┘

  デプロイ経路（2系統・どちらも同じビルド成果物を配る）
  ┌───────────────────────────┐   ┌───────────────────────────┐
  │ Vercel（本番・実運用）       │   │ Docker/nginx（自前ホスト用） │
  │ masterへのpushで自動デプロイ │   │ Dockerfileでビルド→配布      │
  │ vercel.json でヘッダー付与  │   │ nginx.conf でヘッダー付与    │
  └───────────────────────────┘   └───────────────────────────┘
```

## 2. レイヤーと責務

| レイヤー | 実体 | 責務 | 越えてはいけない境界 |
|---|---|---|---|
| UI | `src/components/*.jsx` | 入力・表示・画面ごとの出し分け | 「本当の権限チェック」をここに置かない（利便性の出し分けのみ） |
| ドメインロジック | `src/lib/inventory.js`, `csv.js`, `productLookup.js` | 在庫のCRUD、CSV変換、外部API呼び出しの薄いラッパー | DBの整合性はDB側(RLS)に必ず持たせる |
| 自前サーバー(BFF) | `api/chat.js`, `api/_lib/chatGuard.js` | 秘密鍵(Anthropicキー)を持つ処理**だけ**をここに閉じ込める | それ以外のデータ操作をここに増やさない（薄いBFFのまま保つ） |
| データ・権限 | Supabase (Postgres RLS, RPC関数) | テナント分離・書き込み権限・入力検証の最終防衛線 | フロントの検証だけに頼らない |
| 配信 | Vercel / nginx | 静的ファイル配信、セキュリティヘッダー付与 | ヘッダーは2経路とも同じ内容を保つ |

## 3. なぜこの形なのか（設計判断）

- **フロントから直接Supabaseを叩く設計**（BFFを挟まない）を基本にしている。理由は、Supabaseの売りである「RLSさえ正しければクライアントを信用しなくていい」を活かし、独自バックエンドの実装・保守コストを増やさないため。
- **`/api/chat`だけ例外的にサーバー関数を経由する**。理由はAnthropicの秘密鍵をブラウザに渡せないから。「秘密が必要な処理だけBFF」という線引きを崩さないようにしている（他の機能で安易にAPIルートを増やさない）。
- **`products` / `stock_items` / `stock_movements` を分けている**。商品マスタ・現在数・変動履歴を分離することで、「現在の状態」と「監査ログ（誰が・いつ・何を変えたか）」を両立させている。もし1テーブルにまとめていたら、在庫数を書き換えるたびに履歴が失われる。
- **論理削除（`archived_at`）**。物理削除にすると`stock_movements`が親を失って履歴が壊れるため。
- **マルチテナントは`team_id`列＋RLSで表現**（独立DBやスキーマ分割ではない）。理由は、契約数が数百〜数千規模を想定する初期フェーズでは、行レベル分離の方が運用コストが低いため（バックアップ・マイグレーションが1系統で済む）。

## 4. 主要ユースケースのデータフロー

### 4.1 バーコード登録（新規商品）
```
カメラ/スキャナー → CameraScanner/HardwareScannerInput
  → RegisterPanel（入力バリデーション: 文字数・数量範囲）
    → productLookup.js（Yahoo API, 任意）→ 商品名の自動補完
    → inventory.createProduct()
      → Supabase: products insert（RLS: owner + 自チームのみ）
      → Supabase: stock_items insert（RLS: owner + product_idが自チームか検証）
      → Supabase: stock_movements insert（初期登録、change=初期数量）
```

### 4.2 在庫の増減（既存商品）
```
InventoryList の +1/-1ボタン
  → inventory.adjustQuantity()
    → stock_items select → 現在数を取得
    → stock_items update（RLS: 自チームのproduct_idか再検証）
    → stock_movements insert（履歴に1行追加）
```

### 4.3 AIチャット
```
ChatPanel → fetch('/api/chat', Authorization: Bearer <Supabaseトークン>)
  → api/chat.js
    ① getUserId() でSupabase Authにトークン照会（未ログインは401）
    ② validateMessages() で入力検証（role/文字数/件数）
    ③ createRateLimiter() で1ユーザー10分20回まで
    → Anthropic API（Claude Opus）→ 応答を返す
```

### 4.4 アプリ内エラーの記録
```
window.onerror / unhandledrejection / ErrorBoundary
  → errorLogger.logError()（セッション内で件数上限・連投の間引き）
    → supabase.rpc('log_client_error', ...)
      → DB側でも文字数検証・全体レート制限（1分120件）→ error_logs insert
      → user_idはクライアント申告でなくJWT(auth.uid())から設定
```

## 5. セキュリティ境界（`docs/threat-model.md`との対応）

図の中で「越境してはいけない線」を明示する。

- **チーム間の境界**: `team_id` + RLS。`products`/`stock_items`/`stock_movements`すべてで、行そのものの`team_id`とJWTのユーザーが所属するチームを照合。加えて`stock_items`/`stock_movements`は「参照する`product_id`が本当にその`team_id`の商品か」まで検証（脅威#5）。
- **秘密の境界**: Anthropicキーは`api/chat.js`（サーバーのみ）から出さない。Supabaseの`anon key`は公開情報という前提で、DB側（RLS/RPC）にすべての防御を持たせる（脅威#1, #3）。
- **配信の境界**: Vercel・Docker(nginx)のどちらの経路でも同じセキュリティヘッダー（CSP等）を返す（脅威#2）。

## 6. 今の設計の限界とスケール時の課題

- **フロント直Supabase方式の限界**: 複雑な集計・トランザクションをまたぐ処理（例: 在庫の一括棚卸し）が増えると、RLSだけでは表現しづらくなる。その段階で「専用のBFF/Edge Function」への切り出しを検討する。
- **`/api/chat`のレート制限はサーバーレスのインスタンス単位のメモリ**。トラフィックが増えて複数インスタンスに分散されると、実質的な上限が緩くなる。本格運用するならUpstash Redis等の外部ストアに置き換える。
- **`error_logs`に保持期間の設計が無い**。エラーが多発する時期にテーブルが際限なく増える。定期削除（例: 90日以上前は自動削除）をpg_cron等で足すのが次の一手。
- **1ユーザー1チーム固定**。同じチームに2人目以降を招待するフローが未実装（`handover.md`にも記載）。将来「店舗を増やす」「担当を追加する」要求が来た時に、招待UIとロール管理の拡張が必要。
- **在庫のしきい値通知が無い**。「在庫が少なくなったら通知する」という要望が来たら、`stock_movements`のinsertトリガーやスケジュール実行(cron)から通知を飛ばす設計を追加する。

## 7. 設計判断の一言

「今動いているものを正しく図にできる」ことが、次に大きく作るための前提。
この構成の核は「フロントを信用せず、DB(RLS)を最終防衛線にする」という一貫した方針であり、
今回描いた図・境界線は、拡張するときに**どこにRLSの検証を足すべきか**を判断する土台になる。
