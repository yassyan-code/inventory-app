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
