# 本番DB バックアップ / 復元手順

対象: Supabase `production`プロジェクト（`noygjyxinkriupwequvt`）

pg_dump / psql をローカル環境にインストールしていないため、**Supabase純正の自動バックアップ**と、
**SQL Editorだけで完結する手動バックアップ**の2本立てで運用する。

## ① Supabase純正の自動バックアップ（確認のみ）

Supabaseは有効なプロジェクトに対して自動でバックアップを取得している。

1. https://supabase.com/dashboard/project/noygjyxinkriupwequvt/database/backups を開く
2. 保持期間・直近のバックアップ日時を確認する
3. 無料プラン(Free/Trial)は**物理バックアップからのポイントインタイム復元(PITR)は使えず、保持期間も短い**。
   確実に守りたいデータがある場合は②の手動エクスポートを併用する

⚠️ このダッシュボードからの「Restore」操作は**プロジェクト全体を巻き戻す不可逆な操作**。実行する前に必ずユーザー自身の判断で行う（Claudeはこの操作を代行しない）。

## ② 手動バックアップ（SQL Editorで実行、無料プランでも可能）

本番DBを変更する**直前**、または定期的に、以下をSupabase SQL Editorで実行する。

```sql
select jsonb_pretty(
  jsonb_build_object(
    'exported_at', now(),
    'products', (select jsonb_agg(to_jsonb(p)) from products p),
    'stock_items', (select jsonb_agg(to_jsonb(s)) from stock_items s),
    'stock_movements', (select jsonb_agg(to_jsonb(m)) from stock_movements m)
  )
);
```

実行結果（1セルに全データがJSONで表示される）を選択してコピーし、
`backup_YYYY-MM-DD.json` のようなファイル名でローカル(またはGoogle Drive等)に保存する。
コード上のCSVエクスポート機能（`src/lib/csv.js`）と役割は近いが、こちらは**3テーブルを1ファイルにまとめて丸ごと**保存する点が違う。

## ③ 復元手順

②で保存したJSONファイルから復元する場合、SQL Editorで以下を実行する
（`<<<バックアップJSON>>>`部分を、保存したファイルの中身に置き換える）。

```sql
-- 注意: 既存データがある状態で流すと重複・衝突する可能性がある。
-- 「全データが消えた」等の全面復旧を想定した手順。

with backup as (
  select '<<<バックアップJSON>>>'::jsonb as data
)
insert into products
select * from jsonb_populate_recordset(null::products, (select data->'products' from backup))
on conflict (id) do nothing;

with backup as (
  select '<<<バックアップJSON>>>'::jsonb as data
)
insert into stock_items
select * from jsonb_populate_recordset(null::stock_items, (select data->'stock_items' from backup))
on conflict (id) do nothing;

with backup as (
  select '<<<バックアップJSON>>>'::jsonb as data
)
insert into stock_movements
select * from jsonb_populate_recordset(null::stock_movements, (select data->'stock_movements' from backup))
on conflict (id) do nothing;
```

`on conflict (id) do nothing` により、既に存在する行は上書きせずスキップする（誤って二重実行しても壊れない）。

## 運用ルール

- **本番DBのスキーマを変更する前（列追加・削除など）は必ず②の手動バックアップを取る**
- 月1回など、変更がない期間も定期的に②を実施する（①だけに頼らない）
- 復元は「全データ消失」のような重大インシデント時のみ。通常の1行修正等はSQL Editorで直接直す
