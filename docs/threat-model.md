# 脅威モデル（第54課題）

「攻撃者ならどこを狙うか」の目で点検した結果。観点は 入力 / 認証 / 秘密 / 権限。
点検日: 2026-09-27。対象: フロント(React) + `api/chat.js` + Supabase(Auth/RLS) + nginx。

## 前提（守れている所）

- 商品・在庫・履歴は RLS で `team_id` 分離済み（`006`）。書き込みは `owner` 限定（`007`）。
- `teams` / `team_members` に insert/update ポリシーなし → 自分で owner に昇格できない。
- Claude API キーはサーバー専用（`VITE_` なし）。`.env` は git 管理外。
- 画面出力は React の自動エスケープのみ（`dangerouslySetInnerHTML` / `innerHTML` なし）。XSS の足場は現状なし。

## 脅威リスト（被害が大きい順）

| # | 脅威 | 観点 | 被害 | 状態 |
|---|------|------|------|------|
| 1 | `/api/chat` が**無認証・無制限**。URL を知れば誰でも Claude(Opus) を叩ける。巨大な `messages` を送れば課金を吸い上げられ、「一般質問にも答える」設定なので無料 AI として転用もされる | 認証・入力 | 高（金銭被害・APIキー枠の枯渇でチャット停止） | **対策済み（本課題）** |
| 2 | セキュリティヘッダー無し（Vercel本番 / nginx・Docker配信とも）。CSP なしで将来の XSS が致命的に、`X-Frame-Options` なしでクリックジャッキング | 入力 | 中 | **対策済み（本課題）** |
| 3 | `error_logs` は匿名 insert 可。上限はブラウザ側のみなので、直接 API を叩けば DB を無限に膨らませられる | 入力・権限 | 中（DB 容量枯渇→障害） | 未対策 |
| 4 | CSV 出力の数式インジェクション。商品名（Yahoo 由来や手入力）が `=` `+` `-` `@` で始まると、Excel で開いた時に数式として実行される | 入力 | 中〜低 | 未対策 |
| 5 | `stock_items` / `stock_movements` の insert/update が `product_id` の所属チームを検証しない。他チームの商品 ID を知っていれば、自チームの行から参照できてしまう（UUID 推測が必要で現実性は低い） | 権限 | 低 | 未対策 |
| 6 | `VITE_YAHOO_APP_ID` がブラウザに露出（設計上避けられない）。抜かれるとクォータを消費される | 秘密 | 低 | 許容（Yahoo 側でドメイン制限を推奨） |
| 7 | 新規サインアップが誰でも可能。1 人 1 チーム自動作成のため、大量作成でテーブルが増える | 認証 | 低 | Supabase 側の CAPTCHA / レート制限で対応可 |

## 塞いだ対策（#1）

1. **認証**: `Authorization: Bearer <Supabase access_token>` を必須にし、Supabase Auth (`/auth/v1/user`) に検証させる。偽造・期限切れ・未ログインは 401。
2. **入力チェック**: `role` は `user` / `assistant` のみ（`system` 注入を拒否）、`content` は文字列 2000 文字以内、20 件以内、最後は `user`。余計なフィールドは捨てる。
3. **回数制限**: 1 ユーザー 10 分に 20 回まで（超えたら 429）。サーバーレスのインスタンス単位なので完全ではなく、連打・ループ対策の防波堤。

実装: `api/_lib/chatGuard.js`（テスト: `chatGuard.test.js`）、`api/chat.js`、`src/components/ChatPanel.jsx`。

### 設計判断

- 「画面で隠す」ではなく**サーバー側で必ず検証**する（RLS と同じ考え方）。
- 判定に迷う失敗（通信エラー・設定不足）は**すべて拒否**に倒す。
- 回数制限を DB で厳密にやるとチャット 1 回ごとに書き込みが増えるため、まずは軽量なメモリ方式にした。強い制限が要るなら Upstash 等の外部ストアへ。

### デプロイ時の注意

Vercel の環境変数に `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`（既存）があれば、関数側でもそのまま読める。追加設定は不要。

## 塞いだ対策（#2）

Vercel が実際の本番配信経路（GitHub連携で `master` push → 自動デプロイ）なので、`vercel.json` にヘッダーを追加。
Docker/nginx 配信（自前ホスト向け）にも同内容を `nginx.conf` に追加し、経路によって守りが変わらないようにした。

- `Content-Security-Policy`: `default-src 'self'` を基本に、実接続先だけ許可（Supabase・Yahoo!ショッピングAPI）。ビルド後の `dist/index.html` を確認し、インライン script/style が無いことを確かめた上で `unsafe-inline` は付けていない。
- `X-Frame-Options: DENY` / `frame-ancestors 'none'`: クリックジャッキング対策（二重で指定）。
- `X-Content-Type-Options: nosniff`: MIME スニッフィングによる誤実行を防止。
- `Referrer-Policy: strict-origin-when-cross-origin`: 他サイトへ遷移する際にURLの中身を漏らしすぎない。
- `Permissions-Policy: camera=(self), microphone=(), geolocation=()`: バーコード読み取りに使うカメラだけ自オリジンに許可し、他は全部塞ぐ。

### 設計判断

- 配信経路が2つ（Vercel／Docker）あるので、**どちらか一方だけ直すと守りが抜ける**。両方に同じ内容を書いた。
- CSP は「まず全部禁止して、実際に使っている接続先だけ許可リストに足す」方式にした（ホワイトリスト方式）。

## 次に塞ぐ候補

#3（`error_logs` の insert 制限）→ #4（CSV の先頭文字エスケープ）の順。
