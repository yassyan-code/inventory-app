-- テナント越境テスト（SQL Editorで直接RLSを検証する）
-- staging専用。tenant-a / tenant-b のUUIDは lookup で取得済みの値を埋め込み済み

-- 1. tenant-aになりすまして見えるデータを確認
select set_config('request.jwt.claims', '{"sub":"66f8ccaa-465b-4964-9593-6a0b9fc91735","role":"authenticated"}', true);
set local role authenticated;
select id, name, team_id from products;
-- 期待結果: 「Aのりんご」だけが返る
reset role;

-- 2. tenant-bになりすまして見えるデータを確認
select set_config('request.jwt.claims', '{"sub":"e6695e84-aa3e-4f37-bcab-ca9cfbdf9b28","role":"authenticated"}', true);
set local role authenticated;
select id, name, team_id from products;
-- 期待結果: 「Bのバナナ」だけが返る
reset role;

-- 3. tenant-aがtenant-bのチームへ越境インサートを試みる(拒否されるはず)
select set_config('request.jwt.claims', '{"sub":"66f8ccaa-465b-4964-9593-6a0b9fc91735","role":"authenticated"}', true);
set local role authenticated;
insert into products (barcode, name, team_id)
values ('9999999999999', '越境テスト', 'a65aaaf9-4979-421d-adb2-287eb2a57e22');
-- 期待結果: new row violates row-level security policy でエラーになる（これが正しい挙動）
reset role;

-- ============================================================
-- 第21回: 新テーブルもテナント越境ゼロを確認
-- ============================================================

-- 4. tenant-a から見える stock_items / stock_movements / usage_counters / audit_log
select set_config('request.jwt.claims', '{"sub":"66f8ccaa-465b-4964-9593-6a0b9fc91735","role":"authenticated"}', true);
set local role authenticated;
select count(*) as si_visible,
       count(*) filter (where team_id <> (select team_id from team_members where user_id = auth.uid() limit 1)) as si_foreign
  from stock_items;
select count(*) as sm_visible,
       count(*) filter (where team_id <> (select team_id from team_members where user_id = auth.uid() limit 1)) as sm_foreign
  from stock_movements;
select count(*) as uc_visible,
       count(*) filter (where team_id <> (select team_id from team_members where user_id = auth.uid() limit 1)) as uc_foreign
  from usage_counters;
select count(*) as al_visible,
       count(*) filter (where team_id <> (select team_id from team_members where user_id = auth.uid() limit 1)) as al_foreign
  from audit_log;
-- 期待結果: *_foreign はすべて 0
reset role;

-- 5. tenant-a が rate_limits / audit_log を直接読めない（RPC 経由のみのはず）
select set_config('request.jwt.claims', '{"sub":"66f8ccaa-465b-4964-9593-6a0b9fc91735","role":"authenticated"}', true);
set local role authenticated;
select count(*) from rate_limits;   -- 期待: 0 行（読めない）
reset role;

-- 6. tenant-a が audit_log に直接 INSERT を試みる（拒否されるはず）
select set_config('request.jwt.claims', '{"sub":"66f8ccaa-465b-4964-9593-6a0b9fc91735","role":"authenticated"}', true);
set local role authenticated;
insert into audit_log (team_id, action, target)
values ((select team_id from team_members where user_id = auth.uid() limit 1), 'tamper', 'x');
-- 期待結果: row-level security policy でエラー（書き込みポリシーが無い）
reset role;
