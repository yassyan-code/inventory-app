-- 第21回: SaaS セキュリティ堅牢化
--   ① テナント越境の抜け道を詰める（force RLS）
--   ② レート制限（DB 固定ウィンドウ方式。サーバーレスでも共有できる）
--   ③ 監査ログ（誰が・いつ・何をしたか）
--
-- 適用順序: ① staging(rhowcziknvabdranlhvf) → ② production(noygjyxinkriupwequvt)

-- ============================================================
-- ① force row level security
--   RLS「有効」だけだとテーブル所有者ロールや security definer 関数から
--   ポリシーを素通りできる余地が残る。force で所有者にも必ず適用する。
--   （service_role は BYPASSRLS 権限で従来どおり通れる＝Webhook 等は影響なし）
-- ============================================================
alter table teams            force row level security;
alter table team_members     force row level security;
alter table products         force row level security;
alter table stock_items      force row level security;
alter table stock_movements  force row level security;
alter table usage_counters   force row level security;

-- ============================================================
-- ② レート制限
--   key ごとに time window 内のヒット数を数え、上限超で false を返す。
-- ============================================================
create table if not exists rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);
alter table rate_limits enable row level security;
alter table rate_limits force row level security;
-- 直接アクセスは不可。RPC(security definer)経由のみ。

create or replace function public.check_rate_limit(
  p_key text,
  p_max int,
  p_window_seconds int
) returns boolean as $$
declare
  v_window timestamptz := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );
  v_count int;
begin
  insert into rate_limits (key, window_start, count)
    values (p_key, v_window, 1)
    on conflict (key, window_start)
      do update set count = rate_limits.count + 1
    returning count into v_count;

  -- 古いウィンドウの掃除（ベストエフォート）
  delete from rate_limits where window_start < now() - interval '1 day';

  return v_count <= p_max;
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.check_rate_limit(text, int, int) to authenticated, anon;

-- ============================================================
-- ③ 監査ログ
-- ============================================================
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  team_id uuid references teams(id) on delete set null,
  actor_user_id uuid,             -- auth.users.id（トリガー経由なら auth.uid()）
  action text not null,           -- 'product.create' など
  target text,                    -- 対象の識別子（商品IDなど）
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_log_team_created on audit_log (team_id, created_at desc);

alter table audit_log enable row level security;
alter table audit_log force row level security;

-- チームのメンバーは自分のチームのログを読める（改ざんはできない）
drop policy if exists "team members read audit_log" on audit_log;
create policy "team members read audit_log" on audit_log
  for select using (
    team_id in (select team_id from team_members where user_id = auth.uid())
  );
-- 書き込みポリシーは作らない → トリガー / service_role / 下の RPC のみ

-- アプリ内アクションを明示的に記録する RPC（呼び出し元のチームに紐づく）
create or replace function public.write_audit(p_action text, p_target text, p_meta jsonb)
returns void as $$
declare
  v_team uuid;
begin
  select team_id into v_team from team_members where user_id = auth.uid() limit 1;
  if v_team is null then
    return; -- 未所属からの記録は捨てる
  end if;
  insert into audit_log (team_id, actor_user_id, action, target, meta)
    values (v_team, auth.uid(), p_action, p_target, p_meta);
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.write_audit(text, text, jsonb) to authenticated;

-- ---- 自動記録トリガー（クライアントを信用せずDB側で残す） ----

create or replace function public.audit_products() returns trigger as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (team_id, actor_user_id, action, target, meta)
      values (new.team_id, auth.uid(), 'product.create', new.id::text,
              jsonb_build_object('barcode', new.barcode, 'name', new.name));
  elsif tg_op = 'UPDATE' then
    if new.archived_at is distinct from old.archived_at then
      insert into audit_log (team_id, actor_user_id, action, target, meta)
        values (new.team_id, auth.uid(),
                case when new.archived_at is null then 'product.unarchive' else 'product.archive' end,
                new.id::text, jsonb_build_object('name', new.name));
    end if;
    if new.category is distinct from old.category then
      insert into audit_log (team_id, actor_user_id, action, target, meta)
        values (new.team_id, auth.uid(), 'product.category_change', new.id::text,
                jsonb_build_object('from', old.category, 'to', new.category));
    end if;
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_audit_products on products;
create trigger trg_audit_products
  after insert or update on products
  for each row execute function public.audit_products();

create or replace function public.audit_role_change() returns trigger as $$
begin
  if new.role is distinct from old.role then
    insert into audit_log (team_id, actor_user_id, action, target, meta)
      values (new.team_id, auth.uid(), 'member.role_change', new.user_id::text,
              jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_audit_role_change on team_members;
create trigger trg_audit_role_change
  after update on team_members
  for each row execute function public.audit_role_change();

-- ============================================================
-- ロールバック
-- ============================================================
-- drop trigger if exists trg_audit_products on products;
-- drop trigger if exists trg_audit_role_change on team_members;
-- drop function if exists public.audit_products();
-- drop function if exists public.audit_role_change();
-- drop function if exists public.write_audit(text, text, jsonb);
-- drop function if exists public.check_rate_limit(text, int, int);
-- drop table if exists audit_log;
-- drop table if exists rate_limits;
-- alter table teams no force row level security;  -- 他テーブルも同様
