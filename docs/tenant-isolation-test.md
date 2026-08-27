# テナント越境テスト（顧客Aのデータが顧客Bに見えないことの確認）

**必ずstaging（`rhowcziknvabdranlhvf`）で実施する。productionでは行わない。**

## 準備: テストユーザーを2人作る

1. staging appを開く: https://inventory-app-staging-bbe4.up.railway.app
2. サインアップで `tenant-a@example.com` を作成（パスワードは任意）
3. 同様に `tenant-b@example.com` を作成
4. `006_add_multitenancy.sql` のトリガー（`on_auth_user_created_team`）により、
   サインアップした瞬間に**それぞれ別のチームが自動で作られる**（ここが自己完結ポイント）

## テスト①: アプリ操作での確認（一番わかりやすい）

1. `tenant-a@example.com` でログイン →「スキャン登録」タブで商品を1件登録（例: 商品名「Aのりんご」、バーコード `1111111111111`）
2. ログアウトし、`tenant-b@example.com` でログイン
3. 「在庫一覧」を開く → **「Aのりんご」が表示されないこと**を確認
4. `tenant-b`側でも商品を1件登録（例: 商品名「Bのバナナ」、バーコード `2222222222222`）
5. 再度 `tenant-a` でログインし直し、「在庫一覧」に **「Bのバナナ」が表示されないこと**を確認

## テスト②: SQL EditorでRLSを直接検証する

アプリ経由だと「本当にDBレベルで防いでいる」のか「たまたま表示していないだけ」なのか区別しづらいため、
Supabase SQL EditorでPostgresのセッションにJWTクレームを模擬的にセットし、RLSそのものを検証する。

```sql
-- 0. 管理者視点(RLSを意識せず)で、2チームにデータが分かれていることを確認
select p.name, p.team_id, t.name as team_name
from products p join teams t on t.id = p.team_id
order by t.name;

-- 1. tenant-aのユーザーUUIDを確認（Authentication > Usersからコピー）
-- 2. tenant-aになりすまして見えるデータを確認
set local role authenticated;
set local request.jwt.claims = '{"sub":"<tenant-aのUUID>","role":"authenticated"}';
select id, name, team_id from products;
-- 期待結果: 「Aのりんご」だけが返る

reset role;

-- 3. tenant-bへの越境インサートを試みる（拒否されることを確認）
set local role authenticated;
set local request.jwt.claims = '{"sub":"<tenant-aのUUID>","role":"authenticated"}';
insert into products (barcode, name, team_id)
values ('9999999999999', '越境テスト', '<tenant-bのteam_id>');
-- 期待結果: new row violates row-level security policy でエラーになる

reset role;
```

## 判定基準

- テスト①: 互いの商品がアプリ上で一切見えない
- テスト②-2: `select`が自分のチームの行だけを返す
- テスト②-3: 他チームへの`insert`が RLS違反でエラーになる

上記3つがすべて成立すれば、越境ゼロが設計として保証されている。
