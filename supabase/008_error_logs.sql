-- アプリ内エラーの収集用テーブル（第53課題：監視と運用）
--
-- ブラウザで起きた未処理エラー・画面の描画エラーをここに記録する。
-- Uptime Kuma は「サイトが応答するか」しか見ないため、
-- 「画面が真っ白」「一部の操作だけ失敗」といったアプリ内の異常はこのテーブルで気づく。
--
-- 権限の考え方:
--   ・書き込み: 未ログイン(anon)でも可。ログイン前の画面で起きたエラーも拾いたいため。
--   ・閲覧   : 誰にも許可しない（select ポリシーなし）。Supabase ダッシュボード
--              (service role) からだけ見る。スタックトレースには内部情報が含まれるため。
--
-- 適用順序: ① staging(rhowcziknvabdranlhvf) で実行して確認
--          ② 問題なければ production(noygjyxinkriupwequvt) で実行

create table if not exists error_logs (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  source      text not null check (char_length(source) <= 50),
  message     text not null check (char_length(message) <= 2000),
  stack       text check (char_length(stack) <= 8000),
  url         text check (char_length(url) <= 2000),
  user_agent  text check (char_length(user_agent) <= 500),
  user_id     uuid
);

create index if not exists error_logs_created_at_idx on error_logs (created_at desc);

alter table error_logs enable row level security;

drop policy if exists "anyone can insert error_logs" on error_logs;

-- user_id は「null か、自分自身」だけ許可（他人になりすました記録を防ぐ）
create policy "anyone can insert error_logs" on error_logs
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

-- 確認用クエリ（ダッシュボードの SQL エディタで実行）:
--   select created_at, source, message, url from error_logs order by created_at desc limit 50;
