-- 商品に自由記入メモ欄を追加するマイグレーション
-- Supabaseダッシュボード > SQL Editor に貼り付けて実行してください
--
-- 安全性:
--   - NULL許容・デフォルト値なし → 既存の全行に影響を与えない(既存行はnoteがNULLになるだけ)
--   - 参照制約や既存カラムの変更を伴わない単純な追加のみ
--   - ロールバックは `alter table products drop column if exists note;` で可能
--
-- 適用順序: ① staging(rhowcziknvabdranlhvf)で先に実行して確認
--          ② 問題なければ production(noygjyxinkriupwequvt)で実行

alter table products add column if not exists note text;
