# 第46課題 提出：複数の表をつなぐ（SQL応用：JOIN・集計・N+1回避）

## 1. JOINで一覧を作る（入出庫履歴に商品名を並べる）

`stock_movements`（入出庫履歴）は`product_id`しか持たず、商品名やバーコードは`products`側にしかない。2つの表を`product_id = id`でJOINし、履歴に商品名・バーコードを並べた一覧を作った。

```sql
select
  sm.id as movement_id,
  sm.created_at,
  sm.change,
  sm.note,
  p.name as product_name,
  p.barcode
from stock_movements sm
join products p on p.id = sm.product_id
order by sm.created_at desc
limit 20;
```

**staging実行結果**：4件の履歴（全て「初期登録」）に、対応する商品名（水A／B バナナ／A りんご／test-a）とバーコードが正しく並んだ。`stock_movements`単体では見えない情報が、JOINによって1回のクエリで補完できることを確認した。

## 2. 集計を足す（商品ごとの入出庫件数・累計増減）

上のJOINを土台に、商品ごとに`GROUP BY`して件数（`COUNT`）と合計増減（`SUM`）を出した。`stock_items`（現在庫）も`LEFT JOIN`し、「現在庫」と「履歴の累計増減」を並べて見比べられるようにした。

```sql
select
  p.id,
  p.name,
  p.barcode,
  coalesce(si.quantity, 0) as current_quantity,
  count(sm.id) as movement_count,
  coalesce(sum(sm.change), 0) as total_change
from products p
left join stock_items si on si.product_id = p.id
left join stock_movements sm on sm.product_id = p.id
group by p.id, p.name, p.barcode, si.quantity
order by movement_count desc;
```

**staging実行結果**：4商品とも`movement_count = 1`、`total_change = 1`、`current_quantity = 1`で一致（各商品を初期登録しただけの現状データと整合）。

**設計判断の一言**：`current_quantity`（`stock_items.quantity`＝現在の実数）と`total_change`（`stock_movements`の合計＝履歴から計算した理論値）を同じ行に並べたのは、両者がズレていたら「履歴に記録されない在庫変更が起きた」というバグ検知に使えると考えたため。`products`を起点に`LEFT JOIN`にしたのは、まだ一度も入出庫していない商品（履歴0件）も一覧から漏らさず出すため（`INNER JOIN`だと0件の商品が消える）。

## 3. N+1点検

**点検方法**：`src/lib/inventory.js`の一覧系関数と、`src/components/`配下でDB呼び出しをループしている箇所がないかを確認した。

**結果**：N+1問題は見つからなかった。

- `listStock()`・`findByBarcode()`はどちらも`products`テーブルの`.select()`に`stock_items(quantity)`をPostgRESTの埋め込み（embed）として含めており、商品が何件あっても**1回のクエリ**で在庫数まで一括取得している。内部的にはこの埋め込みがJOINとして実行される。
- 商品一覧を1件ずつループして`stock_items`を個別に問い合わせているコードは`src`配下に存在しない。

**もし直すとしたら**：もし`listStock()`が「まず商品一覧を取得 → 各商品のidでforループしてstock_itemsを個別に取得」という書き方だった場合、商品200件なら201回のクエリが飛ぶN+1になっていた。直し方は今回のJOIN・集計と同じ考え方で、`.select('..., stock_items(quantity)')`のように**1回のクエリにまとめる**（=関連データを埋め込みで一括取得する）こと。

## 4. 一番の学び

`stock_movements`だけを見ても「どの商品か」は分からない。JOINは「表を分けたことで失われた文脈を、クエリの時点で埋め戻す」操作だと理解した。また、集計を足すことで「現在庫（`stock_items`）」と「履歴の合計（`stock_movements`のSUM）」という、本来一致するはずの2つの値を並べて見比べられるようになり、集計は単に数を数えるだけでなく整合性チェックの手段にもなると分かった。
