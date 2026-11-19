# 在庫管理アプリ

バーコードを読み込むと商品名と数量を登録・管理できるアプリです。小さな店のスタッフが、スマホやPCから複数人で使うことを想定しています。

- スマホ: カメラでバーコード読み取り
- PC: 市販のバーコードスキャナー（USB/Bluetooth接続、キーボードエミュレーション型）で読み取り
- データはSupabase（クラウド）に保存され、複数端末・複数人で共有可能
- 未登録のバーコードはYahoo!ショッピング商品検索APIで商品名を自動取得（未設定時は手入力）

| 項目 | 内容 |
|---|---|
| 作り | Vite + React（PWA対応）。データ操作はフロントから直接Supabase（Postgres + Auth）を呼ぶ |
| 本番 | Railway。Dockerfile（ビルド後にnginxで静的配信）。`master` へのpushで自動デプロイ |
| 補助 | Vercel（SSO保護で一般ユーザーは不可）。AIチャット（`api/`）はこちらでのみ動く。本番ではタブごと非表示 |
| 動作環境 | Node.js 24（`.nvmrc`） |

## 最短で動かす（約30分）

初めての方は [docs/onboarding.md](docs/onboarding.md)（手順と、詰まりやすい所）も見てください。

### 1. 依存パッケージのインストール

```bash
npm install
```

1分ほどかかります。止まったように見えても待ってください。`deprecated` の警告は無視して大丈夫です。

### 2. Supabaseプロジェクトの作成

1. https://supabase.com にアクセスし、無料アカウントを作成
2. 新規プロジェクトを作成
3. ダッシュボード左メニュー「SQL Editor」を開き、このリポジトリの `supabase/schema.sql` の内容を貼り付けて実行（テーブルとポリシーが作成されます。`schema.sql` に入っているのは基本部分です。監査ログ・エラーログなどは `supabase/` の `007`〜`013` の番号付きSQLを順に実行すると追加されます）
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

`.env` は秘密を含むので、Gitに入れません（`.gitignore` 済み）。`.env.example` には変数の名前だけを書きます。

### 5. 起動

```bash
npm run dev
```

表示されたURL（例: http://localhost:5173）をブラウザで開きます。

初回はアカウント作成（メールアドレス+パスワード）が必要です。Supabaseの確認メールが届くので、リンクを開いてからログインしてください。

### 6. スマホから使う場合

同じネットワーク内のスマホでPCのIPアドレス+ポート（例: http://192.168.x.x:5173）にアクセスするか、デプロイしたURLをスマホのブラウザで開いてください。「ホーム画面に追加」でアプリのように使えます（PWA対応）。

## 使い方

1. 「スキャン登録」タブでカメラ or 外部スキャナーを選ぶ
2. バーコードを読み取る
   - 登録済み商品 → 現在の在庫数が表示され、「＋1（入庫）」「−1（出庫）」で数量を増減
   - 未登録商品 → 商品名（自動取得 or 手入力）と初期数量を入力して登録
3. 「在庫一覧」タブで全商品の一覧・検索・数量調整が可能

## 変更するとき（開発者向け）

| やること | コマンド |
|---|---|
| 静的チェック | `npm run lint` |
| テスト | `npm test` |
| ビルド | `npm run build` |
| PR前の一括チェック（git status → lint → test → build） | `bash scripts/pre-pr-check.sh` |
| 依存を変えたあと、著作権表示（`public/THIRD-PARTY-NOTICES.txt`）を作り直す | `npm run notices` |

1. `master` から作業用ブランチを切る
2. 変更して、PR前の一括チェックを通す
3. PRを作る（説明に「何を・なぜ」を書く）。CIが通ったらマージ。マージ後は本番デプロイの成功も確認する

やること・バグ・要望は [GitHubのIssue](https://github.com/yassyan-code/inventory-app/issues) に書きます。何を・どこに残すかのルールは [docs/team-conventions.md](docs/team-conventions.md) の4章にあります。

## ディレクトリ構成

```
src/
  components/               画面の部品
    Auth.jsx                  ログイン・アカウント作成
    CameraScanner.jsx         スマホカメラでのバーコード読取
    HardwareScannerInput.jsx  PC用スキャナー入力
    RegisterPanel.jsx         スキャン→登録・入出庫のメイン画面
    InventoryList.jsx         在庫一覧・検索・CSVエクスポート
    ChatPanel.jsx             AIチャット（本番では非表示）
  lib/                      データ処理（Supabase呼び出し・CSV・商品名の自動取得など。*.test.js がテスト）
api/                        AIチャットなどのサーバー関数（Vercel Functions）
supabase/                   テーブル定義（schema.sql）と、番号付きの追加SQL
scripts/                    補助スクリプト（PR前チェック、SLO計測、著作権表示の生成など）
docs/                       ドキュメント
public/                     静的ファイル（アイコン、THIRD-PARTY-NOTICES.txt）
.github/workflows/          CI・本番デプロイの確認・SLO計測
Dockerfile, nginx.conf.template   本番（Railway）の配信設定
```

## 付属ドキュメント

| 読む人 | ドキュメント |
|---|---|
| 使う人 | [使い方マニュアル](docs/manual.md) |
| 作る人 | [オンボーディング](docs/onboarding.md)、[仕様書](docs/spec.md)、[引き継ぎメモ](docs/handover.md)、[チーム規約](docs/team-conventions.md) |
| 設計を知りたい人 | [アーキテクチャ概要](docs/architecture-overview.md)、[設計判断（ADR）](docs/adr/) |
| 運用する人 | [SLO](docs/slo.md)、[障害対応の手順](docs/incident-runbook.md)、[DBのバックアップと復元](docs/db-backup-restore.md)、[脅威モデル](docs/threat-model.md) |

`docs/` にある `〇〇-NN.md`（例: `estimation-84.md`）は、学習課題の成果物です。アプリの仕様ではありません。

## 今後の拡張

候補は [仕様書の5章](docs/spec.md) と、GitHubのIssueで管理しています。
