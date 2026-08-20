# 引き継ぎメモ

次にこのアプリを開発・保守する人向けのメモです。全体構成・主要ファイル・触るときの注意点をまとめています。

## 1. 全体構成

- **フロントエンド**: Vite + React（PWA対応）。SPA、ルーティングライブラリは使わずタブ切り替えのみ
- **バックエンド**: Vercel Functions（`api/chat.js`のみ。それ以外のデータ操作はフロントから直接Supabaseを呼んでいる）
- **DB/認証**: Supabase（Postgres + Auth）
- **デプロイ**: Vercel。GitHub連携済みで、`master`へのpushで本番自動デプロイ、他ブランチ/PRはプレビューデプロイ

```
inventory-app/
  src/
    App.jsx                  タブ切り替え・ログイン状態の出し分け
    components/
      Auth.jsx                ログイン・アカウント作成フォーム
      CameraScanner.jsx       スマホカメラでのバーコード読取
      HardwareScannerInput.jsx  PC用スキャナー入力（キーボードエミュレーション型）
      RegisterPanel.jsx       スキャン→登録・入出庫のメイン画面（バリデーションもここ）
      InventoryList.jsx       在庫一覧・検索・並び替え・CSVエクスポート
      ChatPanel.jsx            AIチャットUI
    lib/
      supabaseClient.js       Supabaseクライアント初期化
      inventory.js             在庫データのCRUD（DBアクセスはここに集約）
      productLookup.js         JANコード→商品名の自動取得（Yahoo! API）
      csv.js                   CSV変換・ダウンロード処理
  api/
    chat.js                    Claude APIを呼ぶサーバーレス関数（APIキーはここだけで使用）
  supabase/
    schema.sql                 新規構築用の完全なテーブル定義
    002_add_category.sql       追加マイグレーション（カテゴリ列）
    003_add_archived.sql       追加マイグレーション（非表示フラグ）
  docs/
    manual.md / spec.md / handover.md  この3点セット
```

## 2. ローカル開発の始め方

READMEの「セットアップ手順」参照。要点だけ書くと:

1. `npm install`
2. Supabaseプロジェクトを作り、`supabase/schema.sql`をSQL Editorで実行（新規構築の場合。既存DBに追いつく場合は`002_`, `003_`も順に実行）
3. `.env.example`をコピーして`.env`を作成し、Supabase・Yahoo!・Anthropicの各キーを入れる
4. `npm run dev`

## 3. データの流れ・設計判断

- **在庫データは`products`と`stock_items`の1:1構成**。分けている理由は「商品マスタ」と「現在数」を分離し、`stock_movements`（入出庫履歴）で変動を追跡できるようにするため
- **論理削除（`archived_at`）を使っている**。物理削除にすると`stock_movements`の履歴が親を失って壊れるため、あえて残す設計
- **RLSは「ログイン済みなら誰でも読み書き可」の簡易ポリシー**。チームごとにデータを分けたい場合は`team_id`列を追加し、ポリシーを`created_by`や`team_id`で絞る必要がある（現状は未対応、[仕様書](spec.md)の「今後の拡張候補」参照）
- **`stock_items`はSupabaseの結合結果が配列で返ることも単一オブジェクトで返ることもある**（`product_id`にunique制約があるため環境によって挙動が違う）。`inventory.js`の`extractQuantity()`で両対応しているので、ここを消さないこと

## 4. 触るときに注意してほしい箇所

| 箇所 | 注意点 |
|---|---|
| `main.jsx` | `StrictMode`を意図的に外している。カメラ(`getUserMedia`)の二重初期化でエラーになるため。React 19以降で直った場合は戻せるか要確認 |
| `RegisterPanel.jsx` の入力バリデーション | `MAX_NAME_LENGTH`等の定数で上限を管理。DBのカラム長制限とは連動していないので、DB側の制約を変えたらここも合わせて見直す |
| `api/chat.js` | フロント側でメッセージ長は制限しているが、APIを直接叩かれた場合のサーバー側の入力上限・レート制限は未実装。公開アプリとして本格運用するなら追加を検討 |
| `App.css` の `.category-edit-trigger` | 過去に`background: none`だけだと背景色が透明にならずPCで文字が見えなくなる不具合があった。`background-color: transparent`を明示している。安易に消さないこと |
| Vercel環境変数 | `.env`はgit管理外。ローカルとVercel本番の両方に`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_YAHOO_APP_ID`（任意） / `ANTHROPIC_API_KEY`（VITE_プレフィックスなし、サーバー専用）を設定する必要がある |
| LAN内IPアドレスでのアクセス | `http://192.168.x.x`はブラウザがセキュアコンテキストと見なさずカメラが動かない。動作確認は本番URL（https）かローカルの`https://localhost`を使う |

## 5. デプロイ・運用フロー

- 機能ごとにブランチを切り、PRを作成 → レビュー（コメント） → `master`にマージ → 自動で本番デプロイ
- コンフリクトが起きた場合は、コンフリクト側のブランチで`git merge origin/master`しローカルで解消してからpush（過去の対応例: [関門⑧のPR #1, #2](https://github.com/yassyan-code/inventory-app/pulls?q=is%3Apr+is%3Aclosed)参照）
- 手動デプロイしたい場合は `npx vercel --prod`

## 6. 既知の未対応・積み残し

- 入出庫履歴（`stock_movements`）の閲覧画面がない（データは記録されているのでUIを足すだけで実現可能）
- `team_id`によるデータ分離がなく、ログインした人は全員同じ在庫を見る
- 在庫のしきい値通知なし
- `api/chat.js`にサーバー側の入力上限・レート制限なし

質問があれば[仕様書](spec.md)・[使い方マニュアル](manual.md)も合わせて確認してください。
