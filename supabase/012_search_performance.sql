-- 第43回（独り立ち編）: 検索の計算量を落とす
--   listStock() の検索は `ilike '%text%'`（前方に % が付く部分一致）。
--   通常の btree インデックス（idx_products_category 等）は前方一致(text%)にしか効かず、
--   部分一致では使われない → データが増えるほど products 全件を毎回スキャンする(O(n))。
--   pg_trgm の GIN インデックスなら部分一致でも索引が効き、実質 O(log n) に近づく。
--
-- 適用順序: staging(rhowcziknvabdranlhvf) → production(noygjyxinkriupwequvt)
-- Supabaseダッシュボード > SQL Editor で実行、または `supabase db push`

create extension if not exists pg_trgm;

create index if not exists idx_products_name_trgm
  on products using gin (name gin_trgm_ops);

create index if not exists idx_products_barcode_trgm
  on products using gin (barcode gin_trgm_ops);
