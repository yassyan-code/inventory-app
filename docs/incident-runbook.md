# 障害復旧の型（Incident Runbook）

対象: inventory-app 本番環境（Railway production / Vercel production）

## 全体の流れ

```
① 気づく → ② 切り分け → ③ ロールバック → ④ 復旧確認 → ⑤ 振り返り
```

## ① 気づく

- Uptime Kumaの監視（https://uptime-kuma-production-faaa.up.railway.app）が本番URLへの疎通を定期チェックしている
- ダウンを検知したら通知が飛ぶよう、Uptime Kuma側の通知設定(Discord/Slack/Email等、任意のもの)を有効化しておく
- 手動での一次確認: `curl -o /dev/null -s -w "%{http_code}\n" https://inventory-app-production-64fe.up.railway.app`

## ② 切り分け

どこで壊れたかを順に確認する。

| 確認先 | コマンド/場所 | 見るもの |
|---|---|---|
| Railwayのデプロイ状況 | `railway deployment list --json` | 最新デプロイが`SUCCESS`か`FAILED`/`CRASHED`か |
| Railwayのランタイムログ | `railway logs --service inventory-app --lines 200` | エラーの内容(コード起因か、DB接続断か) |
| Supabase側 | https://supabase.com/dashboard/project/noygjyxinkriupwequvt | DB自体が落ちていないか、API制限に達していないか |
| Vercel側 | Vercelダッシュボード | Vercel本番も同時に落ちているか(→コード起因の可能性が高い) |
| GitHub Actions | `gh run list --branch master` | 直前のCIが本当に緑だったか(見落としがないか) |

**Railway/Vercelの両方が同時に落ちている → コード側の問題（直前のマージが疑わしい）**
**片方だけ落ちている → そのプラットフォーム固有の問題（インフラ障害・環境変数のズレ等）**

## ③ ロールバック

コード起因と判断したら、直前の正常な状態に戻す。

```bash
# 直前の正常だったコミットを確認
git log --oneline -10

# revertで安全に戻す(force pushしない。通常のPRフローで戻す)
git checkout -b hotfix/rollback-<日付>
git revert <壊れたコミットのハッシュ>
git push -u origin hotfix/rollback-<日付>
gh pr create --base master --title "hotfix: ロールバック" --body "..."
```

- masterはbranch protectionでCI必須なので、ロールバックのPRも通常通りCIを通してからマージする
- CIが通れば、第13回で組んだ`checkSuites`ゲートにより、Railwayが自動でロールバック後の状態を本番反映する
- 「直push」で急いで戻したくなるが、branch protectionにより直pushはできない設計にしてある（＝事故防止が優先）

DB起因（マイグレーションミス等）の場合は `docs/db-backup-restore.md` の復元手順を使う。

## ④ 復旧確認

```bash
curl -o /dev/null -s -w "%{http_code}\n" https://inventory-app-production-64fe.up.railway.app
```

- HTTP 200が返ることを確認
- 実際にアプリを開き、ログイン→在庫一覧表示→1件検索、が動くことを目視確認
- Uptime Kumaのステータスが緑に戻ったことを確認

## ⑤ 振り返り

- 何が起きたか、何分で気づき何分で戻したかを記録する
- 再発防止（テストケース追加、監視項目追加など）につながる場合はIssue化する
