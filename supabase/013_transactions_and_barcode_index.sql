-- 第45回（独り立ち編）: インデックスとトランザクション
--
-- 1. barcode単独インデックス
--    findByBarcode() は barcode だけで検索するが、既存の索引は
--    unique (team_id, barcode) という複合索引のみ。複合索引は先頭列(team_id)を
--    条件に含まない検索には使われにくいため、毎スキャンで呼ばれるこの検索が
--    実質フルスキャンになっていた。barcode単独の索引を追加する。
--
-- 適用順序: staging(rhowcziknvabdranlhvf) → production(noygjyxinkriupwequvt)
-- Supabaseダッシュボード > SQL Editor で実行、または `supabase db push`

create index if not exists idx_products_barcode
  on products (barcode);

-- 2. adjust_stock: 在庫数の増減をトランザクションで安全にする
--    今までのJSコードは「読む→JSで計算→書く」→「履歴を書く」の4手順に分かれていて、
--    ・2人が同時に+1すると、後勝ちで片方の増減が消える(lost update)
--    ・在庫は更新できたが履歴insertだけ失敗する、という「半分だけ実行」が起こり得た
--    plpgsql関数は1回の呼び出し全体が1つのトランザクションになるため、
--    途中で失敗すれば在庫の更新も含めて全部なかったことになる。
--    また quantity = quantity + p_change は行ロックの上で計算するので、
--    同時更新でも取りこぼしが起きない。
create or replace function adjust_stock(
  p_product_id uuid,
  p_change integer,
  p_note text,
  p_team_id uuid
) returns integer as $$
declare
  v_new_quantity integer;
begin
  update stock_items
    set quantity = quantity + p_change
    where product_id = p_product_id
    returning quantity into v_new_quantity;

  if not found then
    raise exception '在庫レコードが見つかりません: product_id=%', p_product_id;
  end if;

  insert into stock_movements (product_id, change, note, team_id)
    values (p_product_id, p_change, p_note, p_team_id);

  return v_new_quantity;
end;
$$ language plpgsql security invoker;

-- 3. create_product_with_stock: 商品登録もトランザクションで安全にする
--    products・stock_items・(数量ありなら)stock_movementsへの3つのinsertが
--    バラバラだと、途中で失敗した時に「stock_itemsが無い商品」が残り得た。
--    (listStock等はstock_itemsの埋め込みを前提にしているため画面表示が壊れる)
create or replace function create_product_with_stock(
  p_team_id uuid,
  p_barcode text,
  p_name text,
  p_category text,
  p_initial_quantity integer
) returns products as $$
declare
  v_product products;
begin
  insert into products (team_id, barcode, name, category)
    values (p_team_id, p_barcode, p_name, nullif(p_category, ''))
    returning * into v_product;

  insert into stock_items (product_id, team_id, quantity)
    values (v_product.id, p_team_id, p_initial_quantity);

  if p_initial_quantity <> 0 then
    insert into stock_movements (product_id, team_id, change, note)
      values (v_product.id, p_team_id, p_initial_quantity, '初期登録');
  end if;

  return v_product;
end;
$$ language plpgsql security invoker;
