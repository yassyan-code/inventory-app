# 第45課題 提出：インデックスとトランザクションでDBをプロ仕様に

## 1. インデックスの点検（barcode単独インデックスの追加）

**見つけた問題**
`findByBarcode()`（バーコードスキャンのたびに毎回呼ばれる検索）は `barcode` 列だけで絞り込む。しかし既存の索引は `unique (team_id, barcode)` という複合索引のみだった。

複合索引は先頭列（`team_id`）を条件に含まない検索には使われにくいという性質があり、`WHERE barcode = ?` だけの検索では索引が効かず、実質フルスキャンになっていた。スキャン操作のたびに呼ばれる検索なので、商品数が増えるほど遅くなる箇所。

**対処**

```sql
create index if not exists idx_products_barcode
  on products (barcode);
```

`barcode` 単独の索引を追加し、複合索引に依存せず直接引けるようにした（`supabase/013_transactions_and_barcode_index.sql`）。staging → production の順で `supabase db push` を適用。

## 2. トランザクション化（lost update と半端な書き込みの防止）

**見つけた問題**
これまでの在庫増減・商品登録は、JS側で「読む→計算→書く→履歴insert」という複数のDB呼び出しに分かれていた。

- 在庫増減：2人が同時に `+1` すると、両方が同じ「読んだ時点の数量」を元に計算して書き込むため、後勝ちで片方の増減が消える（lost update）。
- 商品登録：`products` → `stock_items` → `stock_movements` の3件insertがバラバラなので、途中で失敗すると「`stock_items` の無い商品」が残り得る（`listStock` 等は `stock_items` の埋め込みを前提にしているため画面が壊れる）。

**対処**
DB側にplpgsql関数を2つ追加し、複数手順を1回のRPC呼び出し＝1トランザクションにまとめた。

- `adjust_stock(product_id, change, note, team_id)`：`quantity = quantity + change` を行ロックの上で計算・更新し、`stock_movements` への履歴insertまでを1トランザクションで実行。途中で失敗すれば在庫更新も含めて全部なかったことになるため、半端な書き込みが起きない。同時更新でも行ロックで取りこぼしが起きない。
- `create_product_with_stock(team_id, barcode, name, category, initial_quantity)`：`products`・`stock_items`・(数量ありなら)`stock_movements` への3件insertを1トランザクションにまとめた。

`src/lib/inventory.js` の `createProduct` / `adjustQuantity` は、これらのDB関数への `.rpc()` 呼び出しに置き換え、JS側の複数手順ロジックを削除した。

## 3. 正規化点検（あえて直さなかった箇所）

以下2点は点検した上で、現状維持と判断した。

| 点検項目 | 判断 | 理由 |
|---|---|---|
| `team_id` が `products` / `stock_items` / `stock_movements` に重複して持たれている | 現状維持 | 各テーブル単独でRLS（行レベルセキュリティ）の条件判定ができるようにするため。正規化してJOIN経由でしか`team_id`を辿れない形にすると、RLSポリシーの評価コストが上がる |
| `category` が `products` に非正規化（別テーブルに切り出していない）で持たれている | 現状維持 | カテゴリのマスタ管理が必要になるほどの規模・要件が今のところない小規模データのため、JOINを増やすコストに見合わない |

「正規化＝常に正しい」ではなく、RLS性能や実際のデータ規模とのトレードオフで判断する、という考え方を採った。

## 4. 一番の学び

インデックスは「あれば効く」わけではなく、複合索引の先頭列が条件に含まれない検索には効かないという点。今回のバグは「索引はあるのに遅い」状態で、EXPLAINで実行計画を見ないと気づけない類のものだった。

また、トランザクションは「失敗したら全部なかったことにする」だけでなく、`UPDATE ... SET quantity = quantity + change` のように行ロック下で計算することで同時更新の取りこぼし（lost update）自体を防げる、という点も実装して初めて腹落ちした。
