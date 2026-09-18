# 第37課題 提出：HTTPS・通信の暗号化

## 1. 鍵マーク・証明書が見えている画面

**ブラウザでの見方**：`https://inventory-app-topaz-iota.vercel.app` を開く → アドレス欄の🔒をクリック →「この接続は保護されています」→「証明書は有効です」をクリック → 下の内容が表示される。

**実際に取得した証明書の中身（openssl で確認）**

```
■ Vercel 本番  inventory-app-topaz-iota.vercel.app
  発行先 (Subject)     : CN = *.vercel.app
  発行者 (Issuer)      : Google Trust Services / CN = WR1   ← ブラウザが信頼するCA
  有効期間            : 2026-08-29 〜 2026-11-27（約90日・自動更新）
  対象ホスト名 (SAN)  : DNS:*.vercel.app
  検証結果            : Verify return code: 0 (ok)
  プロトコル / 暗号   : TLS 1.3 / TLS_AES_128_GCM_SHA256

■ Railway 本番  inventory-app-production-64fe.up.railway.app
  発行先 (Subject)     : CN = *.up.railway.app
  発行者 (Issuer)      : Let's Encrypt / CN = YE1
  有効期間            : 2026-07-29 〜 2026-10-27（約90日・自動更新）
  対象ホスト名 (SAN)  : DNS:*.up.railway.app, DNS:up.railway.app
```

**読み方**：証明書は「このドメインの持ち主だと CA が確認済み」という身分証。中身の暗号化は TLS 1.3 が担当。Vercel・Railway とも公開時に自動で取得・更新される。

## 2. http と https の違いの図

```
【http】＝ ハガキ  ── 文面が丸見えのまま各中継を通過
 あなた ─「email=y@… / password=nyaan-2026」→ カフェWi-Fi → プロバイダ → 中継 → サーバー
                          ▲ 経路上の誰でも「読める」「書き換えられる」

【https】＝ 鍵つき封筒  ── 中身は暗号。開けられるのは宛先だけ
 あなた ─「9f3a2b7e c41d 8a05 …（暗号文）」───────────────────────→ サーバー
                          ▲ 盗んでも意味不明／改ざんすると壊れて検知される
```

| 観点 | http | https |
|---|---|---|
| 中身 | 平文でそのまま流れる | 暗号文になる |
| 経路上の第三者（カフェWi-Fi・プロバイダ等） | 全部読める | 読めない |
| 改ざん | こっそり書き換え可能 | 壊れて検知され拒否 |
| 相手が本物か | 確認できない（偽サイトにすり替え可） | 証明書で確認できる |
| アドレス欄 | 🔒なし／「保護されていません」 | 🔒あり |

**まとめ**：🔒 ＝「中身が暗号で守られている＋相手が本物」の印。パスワードや個人情報を送るなら https が必須。

## 3. 知らなかった点

証明書の有効期間がたった約90日で、しかも Vercel / Railway が勝手に自動更新していること。「証明書は1年ごとに手で買って入れ替えるもの」というイメージだった。
