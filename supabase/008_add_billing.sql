-- 課金①: teams に Stripe サブスクリプションの状態を持たせる
--
-- 課金対象は「チーム(テナント)」。teams 1行につき 1サブスク。
-- プランは 'free' / 'pro' の2つ。無料は商品登録 50件まで(下のトリガーで強制)。
--
-- 書き込みは Stripe Webhook(api/stripe-webhook.js)が service_role で行うので
-- RLS ポリシーの追加は不要(service_role は RLS を貫通する)。
-- メンバーは既存の "members can read own teams" で plan 列を読める。
--
-- 適用順序: ① staging(rhowcziknvabdranlhvf) → ② production(noygjyxinkriupwequvt)

alter table teams add column if not exists plan text not null default 'free';
alter table teams add column if not exists plan_status text;              -- Stripe subscription.status をそのまま格納
alter table teams add column if not exists stripe_customer_id text;
alter table teams add column if not exists stripe_subscription_id text;
alter table teams add column if not exists current_period_end timestamptz;

create index if not exists idx_teams_stripe_customer_id on teams (stripe_customer_id);
create index if not exists idx_teams_stripe_subscription_id on teams (stripe_subscription_id);

-- ============================================================
-- 無料プランの商品登録上限(50件)を DB 側で強制する
--   画面側でもボタンを出し分けるが、本当の防御はこのトリガー。
--   Pro に上げれば即座に上限が外れる。
-- ============================================================
create or replace function public.enforce_free_plan_product_limit()
returns trigger as $$
declare
  team_plan text;
  cnt int;
begin
  select plan into team_plan from teams where id = new.team_id;

  if team_plan is null or team_plan = 'free' then
    select count(*) into cnt from products where team_id = new.team_id;
    if cnt >= 50 then
      raise exception 'free plan product limit reached (50)'
        using errcode = 'check_violation',
              hint = 'upgrade to Pro to add more products';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_free_plan_product_limit on products;
create trigger trg_free_plan_product_limit
  before insert on products
  for each row execute function public.enforce_free_plan_product_limit();

-- ============================================================
-- ロールバック
-- ============================================================
-- drop trigger if exists trg_free_plan_product_limit on products;
-- drop function if exists public.enforce_free_plan_product_limit();
-- alter table teams drop column if exists plan;
-- alter table teams drop column if exists plan_status;
-- alter table teams drop column if exists stripe_customer_id;
-- alter table teams drop column if exists stripe_subscription_id;
-- alter table teams drop column if exists current_period_end;
