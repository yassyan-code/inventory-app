-- 在庫管理アプリ用スキーマ（マルチテナント対応版）
-- Supabaseダッシュボード > SQL Editor に貼り付けて実行してください
-- 既存データベースへの適用は 002〜006 の番号付きマイグレーションを順に使ってください

-- チーム（テナント）
create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index idx_team_members_user_id on team_members (user_id);

-- 商品マスタ（バーコードはチーム内でのみユニーク）
create table products (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id),
  barcode text not null,
  name text not null,
  category text,
  archived_at timestamptz,
  note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_team_barcode_unique unique (team_id, barcode)
);

create index idx_products_team_id on products (team_id);
create index idx_products_category on products (category);
create index idx_products_archived_at on products (archived_at);

-- 在庫（商品ごとの現在数量）
create table stock_items (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id),
  product_id uuid not null references products(id) on delete cascade unique,
  quantity integer not null default 0,
  updated_at timestamptz not null default now()
);

create index idx_stock_items_team_id on stock_items (team_id);

-- 入出庫履歴
create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id),
  product_id uuid not null references products(id) on delete cascade,
  change integer not null, -- 入庫は正の数、出庫は負の数
  note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create index idx_stock_movements_team_id on stock_movements (team_id);

-- 更新日時を自動更新するトリガー
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_products_updated_at
  before update on products
  for each row execute function set_updated_at();

create trigger trg_stock_items_updated_at
  before update on stock_items
  for each row execute function set_updated_at();

-- 新規サインアップ時に専用チームを自動作成するトリガー
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

create trigger on_auth_user_created_team
  after insert on auth.users
  for each row execute function public.handle_new_user_team();

-- RLS（行レベルセキュリティ）を有効化
alter table teams enable row level security;
alter table team_members enable row level security;
alter table products enable row level security;
alter table stock_items enable row level security;
alter table stock_movements enable row level security;

-- 自分が所属するチームの行だけ読み書き可能（テナント分離の要）
create policy "members can read own teams" on teams
  for select using (id in (select team_id from team_members where user_id = auth.uid()));

create policy "members can read own membership" on team_members
  for select using (user_id = auth.uid());

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
