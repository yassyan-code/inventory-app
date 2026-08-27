# 独自ドメイン＋SSLの設定手順（ドメイン取得後にすぐ使える版）

2026-08-27時点でinventory-appは独自ドメインをまだ取得していない。取得したら以下の手順でそのまま適用できる。

## 前提

- Railway productionサービス: `inventory-app`（プロジェクト`6787a41e-fe11-42a2-9adf-b8296a706072`）
- 現在の本番URL: `https://inventory-app-production-64fe.up.railway.app`

## 手順

1. お名前.com / Cloudflare / Google Domains等で独自ドメインを取得する（例: `inventory.example.com`のようなサブドメインで運用するのがおすすめ。ルートドメインより設定がシンプル）
2. Railwayダッシュボード → `inventory-app`サービス → Settings → Networking → 「Custom Domain」で取得したドメイン(例: `inventory.example.com`)を入力
3. Railwayが表示する **CNAMEレコード**（`xxxx.up.railway.app`のような値）を、ドメインのDNS管理画面で追加する
   - タイプ: `CNAME`
   - ホスト名: `inventory`（サブドメイン部分）
   - 値: Railwayが表示したターゲット
4. DNS反映を待つ（数分〜数時間、TTLによる）
5. RailwayがDNSを検知すると**自動でSSL証明書(Let's Encrypt)を発行**する。追加作業は不要
6. `https://inventory.example.com` で鍵マーク付きアクセスができれば完了

## なぜCNAMEで動くのか（仕組みの理解）

```
ブラウザ → inventory.example.com を名前解決
        → DNSがCNAMEでRailwayのアドレスを教える
        → Railwayのエッジが証明書を提示 → SSL成立
        → Railwayが実際のコンテナにルーティング
```

独自ドメインは「見た目の入口」を変えるだけで、裏側の Railway のインフラ・SSL終端はそのまま。
ドメインの所有権(DNS)さえ渡せば、アプリ側のコード変更は一切不要。

## 注意

- ドメイン取得は有料（年額）。購入操作はユーザー自身が行う（Claudeは代行しない）
- Vercel側にも同様の仕組みがあるため、Vercel本番にも独自ドメインを付けたい場合は同じ要領でVercelダッシュボードから設定する
