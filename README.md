# 在庫管理アプリ

バーコードを読み込むと商品名と数量を登録・管理できるアプリです。

> GitHub連携による自動デプロイ確認用の変更です。

- スマホ: カメラでバーコード読み取り
- PC: 市販のバーコードスキャナー（USB/Bluetooth接続、キーボードエミュレーション型）で読み取り
- データはSupabase（クラウド）に保存され、複数端末・複数人で共有可能
- 未登録のバーコードはYahoo!ショッピング商品検索APIで商品名を自動取得（未設定時は手入力）

## セットアップ手順

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. Supabaseプロジェクトの作成

1. https://supabase.com にアクセスし、無料アカウントを作成
2. 新規プロジェクトを作成
3. ダッシュボード左メニュー「SQL Editor」を開き、このリポジトリの `supabase/schema.sql` の内容を貼り付けて実行（テーブルとポリシーが作成されます）
4. ダッシュボード「Project Settings」→「API」から以下をメモ
   - Project URL
   - anon public key

### 3. Yahoo!ショッピング商品検索APIのアプリケーションID取得（任意・無料）

未登録バーコードの商品名を自動取得したい場合のみ必要です。設定しなくても手入力で利用できます。

1. https://e.developer.yahoo.co.jp/register でYahoo!デベロッパーネットワークに登録
2. アプリケーションを新規作成し、アプリケーションID（Client ID）を取得

### 4. 環境変数の設定

`.env.example` をコピーして `.env` を作成し、取得した値を入力してください。

```bash
cp .env.example .env
```

```
VITE_SUPABASE_URL=（SupabaseのProject URL）
VITE_SUPABASE_ANON_KEY=（Supabaseのanon public key）
VITE_YAHOO_APP_ID=（Yahoo!のアプリケーションID、任意）
```

### 5. 起動

```bash
npm run dev
```

表示されたURL（例: http://localhost:5173）をブラウザで開きます。

初回はアカウント作成（メールアドレス+パスワード）が必要です。Supabaseの確認メールが届くので、リンクを開いてからログインしてください。

### 6. スマホから使う場合

同じネットワーク内のスマホでPCのIPアドレス+ポート（例: http://192.168.x.x:5173）にアクセスするか、Vercel/Netlifyなどにデプロイしてスマホのブラウザで開いてください。「ホーム画面に追加」でアプリのように使えます（PWA対応）。

## 使い方

1. 「スキャン登録」タブでカメラ or 外部スキャナーを選ぶ
2. バーコードを読み取る
   - 登録済み商品 → 現在の在庫数が表示され、「＋1（入庫）」「−1（出庫）」で数量を増減
   - 未登録商品 → 商品名（自動取得 or 手入力）と初期数量を入力して登録
3. 「在庫一覧」タブで全商品の一覧・検索・数量調整が可能

## ディレクトリ構成

```
src/
  components/
    Auth.jsx              ログイン・アカウント作成
    CameraScanner.jsx     スマホカメラでのバーコード読取
    HardwareScannerInput.jsx  PC用スキャナー入力
    RegisterPanel.jsx     スキャン→登録・入出庫のメイン画面
    InventoryList.jsx     在庫一覧・検索
  lib/
    supabaseClient.js     Supabaseクライアント初期化
    inventory.js          在庫データのCRUD処理
    productLookup.js      JANコード→商品名の自動取得
supabase/
  schema.sql               Supabaseに作成するテーブル定義
```

## 付属ドキュメント

- [使い方マニュアル](docs/manual.md) — 初めて使う人向け
- [仕様書](docs/spec.md) — 機能・データモデルの詳細
- [引き継ぎメモ](docs/handover.md) — 次に開発する人向け

## 今後の拡張候補

- 入出庫履歴（`stock_movements`テーブルは既に作成済み）の閲覧画面
- チーム/店舗単位でのデータ分離（`team_id`列の追加）
- 在庫数のしきい値を下回ったときの通知

> staging環境デプロイ確認用の追記(2026-08-23)
