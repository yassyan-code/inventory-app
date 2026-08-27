-- ロール（権限）による書き込み制限
--
-- 第16回で team_id 単位の RLS を張ったが、同じチーム内なら誰でも
-- 商品マスタの作成・更新ができる状態だった。
-- 第17回では「管理者(owner)だけが商品マスタを操作でき、
-- 一般(member)は在庫数の増減（stock_items / stock_movements）のみ」に絞る。
--
-- 画面側(App.jsx)でもボタンを出し分けているが、それは利便性のためで、
-- 本当の防御はこの RLS。API を直接叩かれても弾ける。
--
-- 適用順序: ① staging(rhowcziknvabdranlhvf) で実行して確認
--          ② 問題なければ production(noygjyxinkriupwequvt) で実行

-- 自分がそのチームの owner かどうかを判定するヘルパー
create or replace function public.is_team_owner(target_team_id uuid)
returns boolean as $$
  select exists (
    select 1 from team_members
    where team_id = target_team_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$ language sql stable security definer set search_path = public;

-- ============================================================
-- products: 参照は全メンバー、作成・更新は owner のみ
-- ============================================================
drop policy if exists "team members write products" on products;
drop policy if exists "team members update products" on products;

create policy "owners write products" on products
  for insert with check (public.is_team_owner(team_id));
create policy "owners update products" on products
  for update using (public.is_team_owner(team_id));

-- ============================================================
-- stock_items: owner は全操作、member は数量更新のみ許可
--   (insert は商品作成時に owner 側で行われる)
-- ============================================================
drop policy if exists "team members write stock_items" on stock_items;
drop policy if exists "team members update stock_items" on stock_items;

create policy "owners write stock_items" on stock_items
  for insert with check (public.is_team_owner(team_id));
create policy "team members update stock_items" on stock_items
  for update using (team_id in (select team_id from team_members where user_id = auth.uid()));

-- ============================================================
-- stock_movements: 入出庫履歴は全メンバーが追加できる（在庫作業そのもの）
--   既存の "team members write stock_movements" をそのまま利用するため変更なし
-- ============================================================

-- ============================================================
-- ロールバック
-- ============================================================
-- drop policy "owners write products" on products;
-- drop policy "owners update products" on products;
-- drop policy "owners write stock_items" on stock_items;
-- drop policy "team members update stock_items" on stock_items;
-- 006_add_multitenancy.sql の該当ポリシーを再作成する
-- drop function if exists public.is_team_owner(uuid);
