-- カテゴリ列を追加するマイグレーション
-- Supabaseダッシュボード > SQL Editor に貼り付けて実行してください
-- （schema.sql は新規構築用。既存データベースにはこちらを適用します）

alter table products add column if not exists category text;

-- カテゴリでの絞り込みを高速化するインデックス（任意だが推奨）
create index if not exists idx_products_category on products (category);
