-- マルチテナント化: teams / team_members を新設し、
-- products / stock_items / stock_movements を team_id で分離する
-- Supabaseダッシュボード > SQL Editor に貼り付けて実行してください
--
-- 適用順序: ① staging(rhowcziknvabdranlhvf)で先に実行して確認
--          ② 問題なければ production(noygjyxinkriupwequvt)で実行
--
-- 安全性:
--   - 既存データは「デフォルトチーム」を新設してそこに全件・全ユーザーを紐づける(データ欠損なし)
--   - 新規サインアップは自動でトリガーが専用チームを作る(以後は自己完結でテナントが増える)
--   - ロールバックする場合は本ファイル末尾のコメントを参照

-- ============================================================
-- 1. teams / team_members テーブル
-- ============================================================

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists idx_team_members_user_id on team_members (user_id);

alter table teams enable row level security;
alter table team_members enable row level security;

create policy "members can read own teams" on teams
  for select using (
    id in (select team_id from team_members where user_id = auth.uid())
  );

create policy "members can read own membership" on team_members
  for select using (user_id = auth.uid());

-- ============================================================
-- 2. 既存データを「デフォルトチーム」に紐づける
-- ============================================================

do $$
declare
  default_team_id uuid;
begin
  insert into teams (name) values ('デフォルトチーム')
    returning id into default_team_id;

  insert into team_members (team_id, user_id, role)
    select default_team_id, id, 'owner' from auth.users
    on conflict do nothing;

  alter table products add column if not exists team_id uuid references teams(id);
  update products set team_id = default_team_id where team_id is null;
  alter table products alter column team_id set not null;

  alter table stock_items add column if not exists team_id uuid references teams(id);
  update stock_items set team_id = default_team_id where team_id is null;
  alter table stock_items alter column team_id set not null;

  alter table stock_movements add column if not exists team_id uuid references teams(id);
  update stock_movements set team_id = default_team_id where team_id is null;
  alter table stock_movements alter column team_id set not null;
end $$;

create index if not exists idx_products_team_id on products (team_id);
create index if not exists idx_stock_items_team_id on stock_items (team_id);
create index if not exists idx_stock_movements_team_id on stock_movements (team_id);

-- バーコードのunique制約がグローバルになっていたのを、チーム単位のunique制約に直す
-- (別テナントの顧客が同じバーコードの商品を登録できないと、実運用で必ず衝突するため)
alter table products drop constraint if exists products_barcode_key;
alter table products add constraint products_team_barcode_unique unique (team_id, barcode);

-- ============================================================
-- 3. 新規サインアップ時に専用チームを自動作成するトリガー
-- ============================================================

create or replace function public.handle_new_user_team()
returns trigger as $$
declare
  new_team_id uuid;
begin
  insert into teams (name) values (coalesce(new.email, 'マイチーム'))
    returning id into new_team_id;

  insert into team_members (team_id, user_id, role)
    values (new_team_id, new.id, 'owner');

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created_team on auth.users;
create trigger on_auth_user_created_team
  after insert on auth.users
  for each row execute function public.handle_new_user_team();

-- ============================================================
-- 4. RLSポリシーをteam_id単位に差し替え
-- ============================================================

drop policy if exists "authenticated read products" on products;
drop policy if exists "authenticated write products" on products;
drop policy if exists "authenticated update products" on products;
drop policy if exists "authenticated read stock_items" on stock_items;
drop policy if exists "authenticated write stock_items" on stock_items;
drop policy if exists "authenticated update stock_items" on stock_items;
drop policy if exists "authenticated read stock_movements" on stock_movements;
drop policy if exists "authenticated write stock_movements" on stock_movements;

create policy "team members read products" on products
  for select using (team_id in (select team_id from team_members where user_id = auth.uid()));
create policy "team members write products" on products
  for insert with check (team_id in (select team_id from team_members where user_id = auth.uid()));
create policy "team members update products" on products
  for update using (team_id in (select team_id from team_members where user_id = auth.uid()));

create policy "team members read stock_items" on stock_items
  for select using (team_id in (select team_id from team_members where user_id = auth.uid()));
create policy "team members write stock_items" on stock_items
  for insert with check (team_id in (select team_id from team_members where user_id = auth.uid()));
create policy "team members update stock_items" on stock_items
  for update using (team_id in (select team_id from team_members where user_id = auth.uid()));

create policy "team members read stock_movements" on stock_movements
  for select using (team_id in (select team_id from team_members where user_id = auth.uid()));
create policy "team members write stock_movements" on stock_movements
  for insert with check (team_id in (select team_id from team_members where user_id = auth.uid()));

-- ============================================================
-- ロールバック手順(必要な場合、手動で個別に実行する)
-- ============================================================
-- drop trigger if exists on_auth_user_created_team on auth.users;
-- drop function if exists public.handle_new_user_team();
-- 旧ポリシー(authenticated read/write/update ...)をschema.sqlから再作成
-- alter table products drop constraint products_team_barcode_unique;
-- alter table products add constraint products_barcode_key unique (barcode);
-- team_id列は残しておいて問題ない(NOT NULLを外せば無害化できる)
