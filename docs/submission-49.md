# 第49課題 提出：計測して速くする（パフォーマンスとキャッシュ）

## 1. どこが遅いか計測

staging上の実クエリを直接計測し、以下が判明した。

| クエリ | 平均レイテンシ | 呼ばれ方 |
|---|---|---|
| `team_members`照会（`getCurrentTeamId()`） | 約245ms（コールドスタート時949ms） | `createProduct()` / `adjustQuantity()`が呼ばれる**たびに毎回** |
| `products.category`全件スキャン（`listCategories()`） | 約42ms | 在庫画面・登録画面を開く/更新するたびに毎回 |
| 在庫一覧（`listStock()`） | 約45ms | 画面表示のたびに（データが変わるので毎回必要） |

「勘」では在庫一覧（`listStock`）が一番怪しく見えたが、実測すると`listStock`と大差なく、むしろ**呼ばれる回数が多い**`getCurrentTeamId()`の方がトータルの無駄が大きかった。バーコードを1回スキャン→登録→また入出庫、という一連の操作の中で`team_id`は一度も変わらないのに、関数を呼ぶたび`auth.getUser()`＋`team_members`照会を丸ごとやり直していた。

## 2. キャッシュで速くする

**キャッシュさせたもの**

1. **`team_id`**（`getCurrentTeamId()`）：ログイン中は同じチームに所属し続ける前提のデータなので、初回取得した値をモジュール内変数に覚えておき、以降は即座に返す。
2. **カテゴリ一覧**（`listCategories()`）：全商品をスキャンして重複除去する処理を、商品登録・カテゴリ編集で実際にカテゴリの集合が変わる可能性のあるタイミング以外は使い回す。

**無効化のタイミング**（覚えたままだと古い値を返してしまう場合への対処）

- `supabase.auth.onAuthStateChange`の`SIGNED_OUT`/`SIGNED_IN`で両方のキャッシュを破棄（別ユーザーでログインし直した時に前の人のチームIDが残らないように）
- `createProduct()`（新しいカテゴリで登録され得る）と`updateCategory()`（カテゴリを変更）の直後にカテゴリキャッシュだけ破棄

```js
// src/lib/inventory.js（要点抜粋）
let cachedTeamId = null
let cachedCategories = null

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') {
    cachedTeamId = null
    cachedCategories = null
  }
})

export async function getCurrentTeamId() {
  if (cachedTeamId) return cachedTeamId
  // ...team_members照会...
  cachedTeamId = data.team_id
  return cachedTeamId
}
```

## 3. 効果を確かめる

「バーコードを5回スキャンして入出庫する」を想定し、キャッシュ導入前後で同じ処理を5回繰り返して比較した。

| | キャッシュ無し（5回合計） | キャッシュあり（5回合計） | 削減率 |
|---|---|---|---|
| team_id取得 | 316ms（1回ごとに約35〜163ms） | 57ms（初回のみDB、以降0ms） | 約82%削減 |
| カテゴリ一覧 | 274ms | 43ms | 約84%削減 |

初回（キャッシュがまだ無い1回目）はキャッシュ有無で同じ時間がかかるが、**2回目以降はほぼ0ms**になる。実際のアプリでは1回のセッション中に何度もスキャン・登録操作をするため、回数が増えるほど削減効果は大きくなる。

## 4. 設計判断の一言

キャッシュ対象を選ぶ基準は「**セッション中にほぼ変わらないのに、呼ばれるたびに取り直しているもの**」にした。逆に`listStock()`（在庫一覧）はキャッシュしていない——在庫数はユーザー自身の操作で頻繁に変わるため、キャッシュすると「さっき入庫したのに一覧が古いまま」というバグの方が実害として大きいと判断した。**キャッシュは「速くなる」より先に「古い値を返しても大丈夫か」を先に判断すべき**、という点が今回の一番の学び。
