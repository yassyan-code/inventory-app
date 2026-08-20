-- 商品の「非表示（アーカイブ）」機能用マイグレーション
-- Supabaseダッシュボード > SQL Editor に貼り付けて実行してください

alter table products add column if not exists archived_at timestamptz;

create index if not exists idx_products_archived_at on products (archived_at);
