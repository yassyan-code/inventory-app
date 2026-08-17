-- 在庫管理アプリ用スキーマ
-- Supabaseダッシュボード > SQL Editor に貼り付けて実行してください

-- 商品マスタ（バーコード1件につき1商品）
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  barcode text not null unique,
  name text not null,
  category text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_category on products (category);

-- 在庫（商品ごとの現在数量）
create table if not exists stock_items (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade unique,
  quantity integer not null default 0,
  updated_at timestamptz not null default now()
);

-- 入出庫履歴
create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  change integer not null, -- 入庫は正の数、出庫は負の数
  note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- 更新日時を自動更新するトリガー
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_products_updated_at on products;
create trigger trg_products_updated_at
  before update on products
  for each row execute function set_updated_at();

drop trigger if exists trg_stock_items_updated_at on stock_items;
create trigger trg_stock_items_updated_at
  before update on stock_items
  for each row execute function set_updated_at();

-- RLS（行レベルセキュリティ）を有効化
alter table products enable row level security;
alter table stock_items enable row level security;
alter table stock_movements enable row level security;

-- ログイン済みユーザーなら誰でも読み書き可能（同じチームで共有する想定の簡易ポリシー）
-- 必要に応じて team_id 列を追加してより厳密に分離してください
create policy "authenticated read products" on products
  for select using (auth.role() = 'authenticated');
create policy "authenticated write products" on products
  for insert with check (auth.role() = 'authenticated');
create policy "authenticated update products" on products
  for update using (auth.role() = 'authenticated');

create policy "authenticated read stock_items" on stock_items
  for select using (auth.role() = 'authenticated');
create policy "authenticated write stock_items" on stock_items
  for insert with check (auth.role() = 'authenticated');
create policy "authenticated update stock_items" on stock_items
  for update using (auth.role() = 'authenticated');

create policy "authenticated read stock_movements" on stock_movements
  for select using (auth.role() = 'authenticated');
create policy "authenticated write stock_movements" on stock_movements
  for insert with check (auth.role() = 'authenticated');
