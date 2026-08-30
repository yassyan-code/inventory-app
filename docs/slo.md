# SLO と監視・アラート（第22回）

顧客がいる前提で「止まったら顧客より先に気づく」ための取り決め。

## SLO（サービスレベル目標）

| 指標 | 目標 | 測り方 |
|---|---|---|
| 稼働率（可用性） | **月 99.5%** | `/api/health` が 200 を 5 秒以内に返した割合（1分間隔で計測） |
| API 成功率 | 月 99% | 5xx 応答の割合（Vercel のログ／Analytics） |
| 主要операーション応答 | p95 < 1.5 秒 | 在庫一覧・スキャン確認の応答時間 |

- **エラーバジェット**: 月 99.5% = ダウン許容 **約 3.6 時間/月**。これを超えたら新機能を止めて信頼性回復を優先する。
- 「稼働」の定義: トップページではなく **`/api/health` が `status:"ok"` で 200**。DB 疎通と必須環境変数までチェックするので、「ページは出るが DB が死んでいる」を検知できる。

## ヘルスチェック `/api/health`

- 認証なし・秘密情報は返さない。
- 返り値: `{ status: "ok" | "degraded", checks: { db, config }, ts }`
- `status:"ok"` なら 200、依存が壊れていれば **503**。
- Cache-Control: no-store（監視が古い結果を掴まない）。

```
curl -s https://<本番URL>/api/health
# {"status":"ok","checks":{"db":{"ok":true,"ms":42},"config":{"ok":true,"missing":[]}},"ts":"..."}
```

## 監視とアラートの設定

既に Railway 上に **Uptime Kuma**（第15回、`https://uptime-kuma-production-faaa.up.railway.app`）が動いている。これを使う。

1. Kuma にログイン → 対象モニターを開く（または新規追加）
2. **Monitor Type**: HTTP(s) / **URL**: `https://<本番URL>/api/health`
3. **Heartbeat Interval**: 60 秒 / **Retries**: 2 / **Accepted Status Codes**: `200`
4. （任意）**Keyword** に `"status":"ok"` を設定すると、200 でも中身が degraded なら落として扱える
5. **Notifications** を1つ以上追加してモニターに紐付ける:
   - 手軽なのは Discord Webhook（サーバー設定 → 連携サービス → ウェブフック → URL を Kuma に貼る）
   - または SMTP（Gmail アプリパスワード）でメール通知
6. **Down** で即時通知、**Up** で復旧通知が飛ぶことをテスト（一度 URL をわざと間違える → 直す）

## アラートが鳴ったら

`docs/incident-runbook.md` の手順に従う（気づく → 切り分け → ロールバック → 復旧確認 → 振り返り）。
`/api/health` の `checks` を見れば DB か設定かの切り分けが早い。

## 今後

- Vercel の Log Drains / Analytics で API 成功率・p95 を継続計測（現状は手動確認）。
- 監査ログ（`audit_log`）の異常検知（短時間の大量ロール変更・大量解約など）は未実装。
