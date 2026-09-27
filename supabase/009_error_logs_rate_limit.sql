-- error_logs の直接insertを禁止し、関数経由のみに絞る（脅威モデリング#3）
--
-- 背景: anon key は公開情報（JSバンドルに埋め込まれる）なので、
-- フロントを直さなくても攻撃者は Supabase の REST API を直接叩ける。
-- 「1セッション20件まで」のような制限はブラウザ側にしかなく、
-- 直接APIを叩かれると無制限にinsertされ、DBを圧迫できてしまう。
--
-- 対策: テーブルへの直接insertポリシーを外し（＝全拒否）、
-- 検証とレート制限を行う関数 log_client_error() 経由でのみ書き込めるようにする。
--
-- 適用順序: ① staging(rhowcziknvabdranlhvf) で実行して確認
--          ② 問題なければ production(noygjyxinkriupwequvt) で実行

-- ============================================================
-- 1. 直接insertを禁止（既存ポリシーを外すだけで、RLSにより既定で全拒否になる）
-- ============================================================
drop policy if exists "anyone can insert error_logs" on error_logs;

-- ============================================================
-- 2. 全クライアント合算のレート制限用カウンタ（1行だけの表）
-- ============================================================
create table if not exists error_logs_rate_window (
  id smallint primary key default 1,
  window_start timestamptz not null default now(),
  count integer not null default 0,
  constraint error_logs_rate_window_singleton check (id = 1)
);

insert into error_logs_rate_window (id) values (1) on conflict (id) do nothing;

alter table error_logs_rate_window enable row level security;
-- ポリシー無し = anon/authenticatedからは読み書き不可（関数(security definer)経由のみ操作）

-- ============================================================
-- 3. 書き込み用関数（検証 + レート制限 + insert）
-- ============================================================
create or replace function public.log_client_error(
  p_source text,
  p_message text,
  p_stack text default null,
  p_url text default null,
  p_user_agent text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  window_seconds constant int := 60;
  max_per_window constant int := 120; -- 全クライアント合計で1分120件まで
  current_count int;
begin
  -- テーブルのCHECK制約と同じ内容をここでも検証する（直接呼び出しからも守るため）
  if p_source is null or char_length(p_source) = 0 or char_length(p_source) > 50 then
    raise exception 'invalid source';
  end if;
  if p_message is null or char_length(p_message) = 0 or char_length(p_message) > 2000 then
    raise exception 'invalid message';
  end if;
  if p_stack is not null and char_length(p_stack) > 8000 then
    raise exception 'invalid stack';
  end if;
  if p_url is not null and char_length(p_url) > 2000 then
    raise exception 'invalid url';
  end if;
  if p_user_agent is not null and char_length(p_user_agent) > 500 then
    raise exception 'invalid user_agent';
  end if;

  update error_logs_rate_window
    set count = case when now() - window_start > make_interval(secs => window_seconds) then 1
                 else count + 1 end,
        window_start = case when now() - window_start > make_interval(secs => window_seconds) then now()
                        else window_start end
    where id = 1
    returning count into current_count;

  if current_count > max_per_window then
    raise exception 'rate limit exceeded';
  end if;

  -- user_id はクライアントの申告を信用せず、JWTから取得する（なりすまし防止）
  insert into error_logs (source, message, stack, url, user_agent, user_id)
    values (p_source, p_message, p_stack, p_url, p_user_agent, auth.uid());
end;
$$;

revoke all on function public.log_client_error(text, text, text, text, text) from public;
grant execute on function public.log_client_error(text, text, text, text, text) to anon, authenticated;

-- ============================================================
-- ロールバック
-- ============================================================
-- revoke execute on function public.log_client_error(text, text, text, text, text) from anon, authenticated;
-- drop function if exists public.log_client_error(text, text, text, text, text);
-- drop table if exists error_logs_rate_window;
-- create policy "anyone can insert error_logs" on error_logs
--   for insert to anon, authenticated
--   with check (user_id is null or user_id = auth.uid());
