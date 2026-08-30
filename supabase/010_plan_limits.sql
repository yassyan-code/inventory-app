-- 第20回: プラン制限とメータリング
--
-- 機能ゲート(CSVエクスポート=Pro専用)は teams.plan を見るだけなので DB 変更なし。
-- ここで作るのは「使用量制限（メータリング）」の土台:
--   AIチャット … 無料は月20回まで / Pro は無制限（回数は可視化用に数える）
--
-- 適用順序: ① staging(rhowcziknvabdranlhvf) → ② production(noygjyxinkriupwequvt)

-- チーム×指標×月 ごとの使用回数
create table if not exists usage_counters (
  team_id uuid not null references teams(id) on delete cascade,
  metric text not null,                       -- 'ai_chat' など
  period text not null,                       -- 'YYYY-MM'
  count int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (team_id, metric, period)
);

alter table usage_counters enable row level security;

-- メンバーは自分のチームの使用量を読める（画面表示用）
drop policy if exists "team members read usage" on usage_counters;
create policy "team members read usage" on usage_counters
  for select using (
    team_id in (select team_id from team_members where user_id = auth.uid())
  );
-- 書き込みは下の RPC(security definer)経由のみ。直接の insert/update ポリシーは作らない。

-- ============================================================
-- AIチャットの利用枠を1回消費する（チェックと加算を1トランザクションで）
--   戻り値: { allowed, count, limit, plan }
--   Pro は limit=null（無制限）。無料は 20。
-- ============================================================
create or replace function public.use_ai_chat_quota(p_team_id uuid)
returns jsonb as $$
declare
  v_plan text;
  v_period text := to_char(now(), 'YYYY-MM');
  v_limit int;
  v_count int;
begin
  -- 呼び出し元が本当にそのチームのメンバーか確認
  if not exists (
    select 1 from team_members where team_id = p_team_id and user_id = auth.uid()
  ) then
    return jsonb_build_object('allowed', false, 'count', 0, 'limit', 0, 'plan', 'none');
  end if;

  select plan into v_plan from teams where id = p_team_id;

  if v_plan = 'pro' then
    insert into usage_counters (team_id, metric, period, count)
      values (p_team_id, 'ai_chat', v_period, 1)
      on conflict (team_id, metric, period)
        do update set count = usage_counters.count + 1, updated_at = now()
      returning count into v_count;
    return jsonb_build_object('allowed', true, 'count', v_count, 'limit', null, 'plan', 'pro');
  end if;

  v_limit := 20;

  select count into v_count from usage_counters
    where team_id = p_team_id and metric = 'ai_chat' and period = v_period;
  v_count := coalesce(v_count, 0);

  if v_count >= v_limit then
    return jsonb_build_object('allowed', false, 'count', v_count, 'limit', v_limit, 'plan', 'free');
  end if;

  insert into usage_counters (team_id, metric, period, count)
    values (p_team_id, 'ai_chat', v_period, 1)
    on conflict (team_id, metric, period)
      do update set count = usage_counters.count + 1, updated_at = now()
    returning count into v_count;

  return jsonb_build_object('allowed', true, 'count', v_count, 'limit', v_limit, 'plan', 'free');
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.use_ai_chat_quota(uuid) to authenticated;

-- ============================================================
-- ロールバック
-- ============================================================
-- drop function if exists public.use_ai_chat_quota(uuid);
-- drop table if exists usage_counters;
