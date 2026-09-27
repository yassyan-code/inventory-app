-- stock_items / stock_movements が、自チームのproductsだけを参照するよう強制する（脅威モデリング#5）
--
-- 背景: これまでのinsert/updateポリシーは「team_idが自分の所属チームか」だけを見ており、
-- 「product_idがそのteam_idの商品か」までは検証していなかった。
-- product_idを直接指定してAPIを叩けば、他チームのproduct_idを自チームのteam_idと
-- 組み合わせて書き込める余地があった（stock_itemsはunique制約で実害は限定的だが、
-- stock_movementsには同種の制約が無く、他チームのproduct_idを参照する履歴行を
-- 作れてしまう）。設計上の整合性として、DBレベルで塞ぐ。
--
-- 適用順序: ① staging(rhowcziknvabdranlhvf) で実行して確認
--          ② 問題なければ production(noygjyxinkriupwequvt) で実行

-- product_id が team_id 配下の商品かどうかを判定するヘルパー
create or replace function public.product_in_team(p_product_id uuid, p_team_id uuid)
returns boolean as $$
  select exists (
    select 1 from products
    where id = p_product_id
      and team_id = p_team_id
  );
$$ language sql stable security definer set search_path = public;

-- ============================================================
-- stock_items: insert / update とも「product_idが自チームの商品であること」を追加検証
-- ============================================================
drop policy if exists "owners write stock_items" on stock_items;
drop policy if exists "team members update stock_items" on stock_items;

create policy "owners write stock_items" on stock_items
  for insert with check (
    public.is_team_owner(team_id)
    and public.product_in_team(product_id, team_id)
  );

create policy "team members update stock_items" on stock_items
  for update
  using (team_id in (select team_id from team_members where user_id = auth.uid()))
  with check (
    team_id in (select team_id from team_members where user_id = auth.uid())
    and public.product_in_team(product_id, team_id)
  );

-- ============================================================
-- stock_movements: insert に同様の検証を追加
-- ============================================================
drop policy if exists "team members write stock_movements" on stock_movements;

create policy "team members write stock_movements" on stock_movements
  for insert with check (
    team_id in (select team_id from team_members where user_id = auth.uid())
    and public.product_in_team(product_id, team_id)
  );

-- ============================================================
-- ロールバック
-- ============================================================
-- drop policy "owners write stock_items" on stock_items;
-- drop policy "team members update stock_items" on stock_items;
-- drop policy "team members write stock_movements" on stock_movements;
-- 007_role_write_policies.sql / schema.sql の該当ポリシーを再作成
-- drop function if exists public.product_in_team(uuid, uuid);
