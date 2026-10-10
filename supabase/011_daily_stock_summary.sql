-- 日次の入出庫サマリ（第61課題：データエンジニアリング）
--
-- 入出庫履歴(stock_movements)は「1操作1行」の生データで、そのままでは
-- 「先週よく出た商品は？」「今月の入庫はいくつ？」に答えるたびに全件を数え直すことになる。
-- そこで、夜に1日分を集計・整形して daily_stock_summary に貯める（バッチ）。
--
-- 流れ:  集める(stock_movements + products) → 整える(クレンジング) → 貯める(daily_stock_summary)
--
-- 整えるルール:
--   ・change = 0 の行は捨てる（意味のない操作）
--   ・日付は日本時間(Asia/Tokyo)で区切る（UTCだと日本の夜が前日に混ざる）
--   ・商品名の前後の空白を除く
--   ・カテゴリが空/未設定なら「未分類」にそろえる
--   ・入庫(in_qty)と出庫(out_qty)を分ける。out_qty は正の数で持つ
--
-- 再実行しても結果が変わらない（冪等）:
--   直近 p_days 日分を「消して作り直す」。遅れて届いた履歴も、次の夜に正しく反映される。
--
-- 権限:
--   ・読む: 自分のチームの行だけ（RLS）
--   ・書く: 関数(refresh_daily_stock_summary)だけ。アプリ(anon/authenticated)は書けない
--
-- 適用順序: ① staging(rhowcziknvabdranlhvf) で実行して確認
--          ② 問題なければ production(noygjyxinkriupwequvt) で実行

-- ============================================================
-- 1. 貯める先のテーブル
-- ============================================================

create table if not exists daily_stock_summary (
  team_id        uuid not null references teams(id) on delete cascade,
  product_id     uuid not null references products(id) on delete cascade,
  day            date not null,            -- 日本時間の日付
  barcode        text not null,
  product_name   text not null,
  category       text not null,
  in_qty         integer not null,         -- その日の入庫合計
  out_qty        integer not null,         -- その日の出庫合計（正の数）
  net_change     integer not null,         -- in_qty - out_qty
  movement_count integer not null,         -- その日の操作回数
  aggregated_at  timestamptz not null default now(),
  primary key (team_id, product_id, day)
);

create index if not exists idx_daily_stock_summary_team_day
  on daily_stock_summary (team_id, day desc);

alter table daily_stock_summary enable row level security;

drop policy if exists "team members read daily_stock_summary" on daily_stock_summary;
create policy "team members read daily_stock_summary" on daily_stock_summary
  for select using (team_id in (select team_id from team_members where user_id = auth.uid()));
-- insert / update / delete のポリシーは作らない（= アプリからは書けない）

-- ============================================================
-- 2. 集計・整形して貯める関数（パイプライン本体）
-- ============================================================

create or replace function refresh_daily_stock_summary(p_days integer default 3)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_day date;
  v_from_ts  timestamptz;
  v_rows     integer;
begin
  if p_days is null or p_days < 1 or p_days > 3650 then
    raise exception 'p_days は 1〜3650 で指定してください: %', p_days;
  end if;

  -- 今日(日本時間)を含めて p_days 日分
  v_from_day := (now() at time zone 'Asia/Tokyo')::date - (p_days - 1);
  v_from_ts  := v_from_day::timestamp at time zone 'Asia/Tokyo';

  -- 作り直す範囲を一度消す（同じ範囲を何度実行しても結果は同じ）
  delete from daily_stock_summary where day >= v_from_day;

  insert into daily_stock_summary
    (team_id, product_id, day, barcode, product_name, category,
     in_qty, out_qty, net_change, movement_count)
  select
    m.team_id,
    m.product_id,
    (m.created_at at time zone 'Asia/Tokyo')::date,
    p.barcode,
    btrim(p.name),
    coalesce(nullif(btrim(p.category), ''), '未分類'),
    sum(greatest(m.change, 0)),
    sum(greatest(-m.change, 0)),
    sum(m.change),
    count(*)
  from stock_movements m
  join products p on p.id = m.product_id and p.team_id = m.team_id
  where m.created_at >= v_from_ts
    and m.change <> 0
  group by m.team_id, m.product_id, (m.created_at at time zone 'Asia/Tokyo')::date,
           p.barcode, btrim(p.name), coalesce(nullif(btrim(p.category), ''), '未分類');

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- 関数を実行できるのはデータベースの管理側だけ（アプリ・ログイン前の人には開けない）
revoke all on function refresh_daily_stock_summary(integer) from public, anon, authenticated;

-- ============================================================
-- 3. 夜に自動で動かす（pg_cron が使える環境だけ）
-- ============================================================
-- 毎日 17:00 UTC = 日本時間 02:00 に、直近3日分を作り直す。
-- pg_cron が無い環境ではお知らせだけ出して、手動実行（下のコメント）で代用する。

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'refresh-daily-stock-summary';
    perform cron.schedule(
      'refresh-daily-stock-summary',
      '0 17 * * *',
      'select public.refresh_daily_stock_summary(3)'
    );
  else
    raise notice 'pg_cron が使えないため、自動実行は設定しませんでした。手動で select refresh_daily_stock_summary(3); を実行してください';
  end if;
end $$;

-- ============================================================
-- 使い方（ダッシュボードの SQL エディタで実行）
-- ============================================================
-- 初回だけ、過去分をまとめて貯める（例: 過去1年）:
--   select refresh_daily_stock_summary(365);
-- 出力データを見る:
--   select day, product_name, category, in_qty, out_qty, net_change, movement_count
--   from daily_stock_summary order by day desc, product_name limit 50;
-- 自動実行の登録と履歴を見る:
--   select jobname, schedule, active from cron.job;
--   select status, start_time, return_message from cron.job_run_details order by start_time desc limit 5;
--
-- ロールバック:
--   select cron.unschedule('refresh-daily-stock-summary');
--   drop function if exists refresh_daily_stock_summary(integer);
--   drop table if exists daily_stock_summary;
