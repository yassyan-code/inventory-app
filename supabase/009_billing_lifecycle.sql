-- 課金②: 継続課金の運用（支払い失敗・猶予・解約予定）
--
-- teams.plan_status は Stripe の subscription.status をそのまま入れる:
--   active / trialing        → Pro 有効
--   past_due                 → 猶予期間（Stripe が自動リトライ中）。Pro は使えるが警告表示
--   unpaid / canceled        → 停止（アプリ側は plan='free' に落とす）
-- 解約は「期末で解約」が基本。cancel_at_period_end で予約状態を持つ。
--
-- 適用順序: ① staging(rhowcziknvabdranlhvf) → ② production(noygjyxinkriupwequvt)

alter table teams add column if not exists cancel_at_period_end boolean not null default false;

-- ロールバック:
-- alter table teams drop column if exists cancel_at_period_end;
