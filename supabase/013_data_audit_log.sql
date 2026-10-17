-- 監査ログ（第67課題：誰が・いつ・何を変えたかを、DB側で必ず記録する）
--
-- 背景（脅威モデリングで見つけた穴）:
--   ① メンバーは stock_items.quantity を直接更新できる。履歴(stock_movements)の記録は
--      アプリ(inventory.js)が別リクエストでやっているだけなので、API を直接叩けば
--      「数量だけ変えて履歴を残さない」ことができる（改ざん＋否認）。
--   ② 商品マスタ（名前・カテゴリ・非表示）の変更は、誰がやったか残らない。
--   ③ stock_movements.created_by / products.created_by は、クライアントが他人の ID を
--      書いて insert できる（なりすまし）。
--
-- 対策:
--   ・products / stock_items / team_members の変更を、トリガーで data_audit_log に自動記録する。
--     アプリの実装に依存しない（API 直叩きでも、必ず記録される）。
--   ・data_audit_log は追記専用。アプリのキー（anon / authenticated）からは insert / update / delete できない。
--     書けるのは SECURITY DEFINER のトリガーだけ。閲覧は、そのチームの owner だけ。
--   ・created_by は、ログイン中のユーザーなら必ず auth.uid() に上書きする（申告を信用しない）。
--
-- 名前について:
--   テーブル名を audit_log にしないのは、staging には未マージの課金ブランチ(feature/billing-stripe)の
--   011_security_hardening.sql が適用済みで、別設計の audit_log(actor_user_id/action/target/meta)と
--   同名トリガー trg_audit_products が既にあるため。同名だと create table が黙ってスキップされ、
--   索引作成で「column "at" does not exist」になる。別名にして、既存の仕組みには触れない。
--
-- 適用順序: ① staging(rhowcziknvabdranlhvf) → ② production(noygjyxinkriupwequvt)
-- 検証: scripts/security/audit-log.test.js（ローカルのPostgresでRLSごと再現して確かめる）

create table if not exists data_audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  team_id    uuid,               -- どのチームの出来事か（閲覧権限の判定に使う）
  actor      uuid,               -- 実行者 auth.uid()。null = サービスロール／SQLエディタなどシステム側
  table_name text not null,
  op         text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  row_id     text,
  old_data   jsonb,              -- UPDATE は「変わった列」だけ。DELETE は行全体
  new_data   jsonb               -- INSERT は行全体。UPDATE は「変わった列」だけ
);

create index if not exists data_audit_log_team_at_idx on data_audit_log (team_id, at desc);

alter table data_audit_log enable row level security;

-- 閲覧: そのチームの owner だけ（is_team_owner は 007 で定義済み）
drop policy if exists "owners read data_audit_log" on data_audit_log;
create policy "owners read data_audit_log" on data_audit_log
  for select to authenticated
  using (public.is_team_owner(team_id));

-- 追記専用: insert / update / delete のポリシーは作らない。権限自体も外す（二重の防御）
revoke all on data_audit_log from anon, authenticated;
grant select on data_audit_log to authenticated;

-- 記録するトリガー関数。SECURITY DEFINER なので、呼び出した人に data_audit_log の書き込み権限がなくても記録できる
create or replace function public.data_audit_row()
returns trigger as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
    v_old := v_row;
  elsif tg_op = 'INSERT' then
    v_row := to_jsonb(new);
    v_new := v_row;
  else
    v_row := to_jsonb(new);
    -- 変わった列だけを残す（updated_at は毎回変わるので除く）
    select jsonb_object_agg(o.key, o.value), jsonb_object_agg(o.key, v_row -> o.key)
      into v_old, v_new
      from jsonb_each(to_jsonb(old)) o
      where v_row -> o.key is distinct from o.value
        and o.key <> 'updated_at';
    if v_old is null then
      return null; -- 実質的な変更なし（記録しない）
    end if;
  end if;

  insert into data_audit_log (team_id, actor, table_name, op, row_id, old_data, new_data)
  values (
    (v_row ->> 'team_id')::uuid,
    auth.uid(),
    tg_table_name,
    tg_op,
    coalesce(v_row ->> 'id', v_row ->> 'user_id'), -- team_members は複合キーなので user_id で代用
    v_old,
    v_new
  );
  return null;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- 記録する対象: 商品マスタ・在庫数・チームの所属／ロール
drop trigger if exists trg_data_audit_products on products;
create trigger trg_data_audit_products
  after insert or update or delete on products
  for each row execute function public.data_audit_row();

drop trigger if exists trg_data_audit_stock_items on stock_items;
create trigger trg_data_audit_stock_items
  after insert or update or delete on stock_items
  for each row execute function public.data_audit_row();

drop trigger if exists trg_data_audit_team_members on team_members;
create trigger trg_data_audit_team_members
  after insert or update or delete on team_members
  for each row execute function public.data_audit_row();

-- created_by の上書き（なりすまし防止）。ログイン中のユーザーなら、申告された値は捨てて auth.uid() にする
create or replace function public.force_created_by()
returns trigger as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$ language plpgsql set search_path = public, pg_temp;

drop trigger if exists trg_products_created_by on products;
create trigger trg_products_created_by
  before insert on products
  for each row execute function public.force_created_by();

drop trigger if exists trg_stock_movements_created_by on stock_movements;
create trigger trg_stock_movements_created_by
  before insert on stock_movements
  for each row execute function public.force_created_by();

-- 確認用クエリ（owner としてログインした状態、または SQL エディタで）:
--   select at, actor, table_name, op, row_id, old_data, new_data from data_audit_log order by at desc limit 50;
--
-- ロールバック:
--   drop trigger if exists trg_data_audit_products on products;
--   drop trigger if exists trg_data_audit_stock_items on stock_items;
--   drop trigger if exists trg_data_audit_team_members on team_members;
--   drop trigger if exists trg_products_created_by on products;
--   drop trigger if exists trg_stock_movements_created_by on stock_movements;
--   drop function if exists public.data_audit_row();
--   drop function if exists public.force_created_by();
--   drop table if exists data_audit_log;
