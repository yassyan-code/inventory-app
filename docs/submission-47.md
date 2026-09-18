# 第47課題 提出：”使う側”から”作る側”へ（API設計）

## 1. 作ったエンドポイント

**`GET /api/items`** — チームの商品一覧（バーコード・名前・カテゴリ・在庫数）をJSONで返す、外部のアプリ/AIから叩ける公開API。

これまでの`api/`配下は、ログイン中の人のSupabase JWTを検証する`getUserTeam()`（`api/_lib/clients.js`）で守られていた。しかし「外部のアプリ/AI」はログインしたユーザーではないので、この仕組みは使えない。今回はチームごとに固定トークン（合鍵）を発行し、それで認証する仕組みを新設した。

- `supabase/014_api_token.sql`：`teams.api_token`（unique）を追加
- `api/items.js`：`Authorization: Bearer <token>` を受け取り、トークンから逆引きしたチームの商品一覧を返す

```js
// api/items.js（要点抜粋）
const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
if (!token) return res.status(401).json({ error: 'missing token' })

const { data: team } = await db.from('teams').select('id, name').eq('api_token', token).maybeSingle()
if (!team) return res.status(401).json({ error: 'invalid token' })

const { data: products } = await db
  .from('products')
  .select('id, barcode, name, category, stock_items(quantity)')
  .eq('team_id', team.id)
  .is('archived_at', null)
```

## 2. 鍵で守る（トークン認証）

**なぜユーザーのJWTではなくチームごとの固定トークンにしたか**：JWTはログインした「人」に紐づく短命の証明書。外部のアプリ/AIは人としてログインしないので、代わりに「このチームの代表として長期間使える合鍵」を発行する方式にした（Stripeの秘密鍵と同じ発想）。

**なぜservice_role接続で手動フィルタが必須か**：`/api/items`はservice_role（RLSを貫通する権限）でDBに接続するため、ユーザー向けの画面のようにRLSがテナント分離を守ってくれない。**トークン→team_idの解決**と**`products.eq('team_id', team.id)`の手動フィルタ**が、他チームのデータが漏れないための唯一の防衛線になっている。この設計判断をコードのコメントにも明記した。

## 3. 叩いて確認

staging（`rhowcziknvabdranlhvf`）の実データに対し、Vercelの認証保護を経由しない方法（ローカルからハンドラーを直接実行し、実際のSupabase接続情報で検証）で3パターンを確認した。

| ケース | 結果 |
|---|---|
| トークンなし | `401 {"error":"missing token"}` |
| 不正なトークン | `401 {"error":"invalid token"}` |
| 正しいトークン（tenant-a） | `200` で該当チームの商品2件（Aりんご／test-a）のみがJSONで返る |

正しいトークンでも、そのトークンに紐づくチームの商品**だけ**が返り、他チーム（デフォルトチーム／tenant-b）のデータは混ざらないことも確認した。テナント分離が意図通り機能している。

## 4. 見つけて直したバグ（設計判断の一言）

動作確認の過程で、`api/_lib/clients.js`が**モジュール読み込み時に**`new Stripe(process.env.STRIPE_SECRET_KEY)`を実行しており、`STRIPE_SECRET_KEY`が無い環境ではStripeを一切使わない`/api/items`まで巻き添えでクラッシュ（`FUNCTION_INVOCATION_FAILED`）する結合バグを発見した。Stripeクライアントを`Proxy`による遅延初期化に変え、実際に`stripe.xxx`へアクセスするまで初期化を遅らせることで解消した。既存の課金系コード（`checkout.js`等）は呼び出し方を変えずに直せた。

「新しいAPIを1本足すだけ」のつもりが、既存コードの隠れた前提（全関数がStripe環境変数の存在を暗黙に要求していた）を壊すことがある、という気付きが今回の一番の学びだった。
