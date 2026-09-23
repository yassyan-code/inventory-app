-- 第47回（独り立ち編）: 外部公開APIの合鍵（チームごとのAPIトークン）
--
-- 外部のアプリ/AIが叩く /api/items は、ログインユーザーのJWTではなく
-- チームごとに発行した固定トークンで認証する。トークンから逆引きした
-- team_id で products を絞り込むのが唯一のテナント分離手段になるため
-- （/api/items は service_role で叩くのでRLSは効かない。手動フィルタが必須）。
--
-- 適用順序: staging(rhowcziknvabdranlhvf) → production(noygjyxinkriupwequvt)

alter table teams add column if not exists api_token text unique;

-- 動作確認用に自分のチームへトークンを発行する例（1行だけ・本番では各自のteam_idに差し替え）:
-- update teams set api_token = encode(gen_random_bytes(24), 'hex') where id = '<your team id>';
