-- 資料を「意味」で検索するためのテーブル（第64課題：RAGとベクトル検索）
--
-- docs/ の文書を見出しごとに切り（チャンク）、文章の意味を384個の数字（ベクトル）にして貯める。
-- 質問も同じ方法で数字にして、近いチャンクを探す（pgvector）。
--
--   取り込み: 文書 → チャンク → 埋め込み(multilingual-e5-small, 384次元) → doc_chunks
--   検索    : 質問 → 埋め込み → match_doc_chunks() → 近い順にチャンク
--
-- 権限: RLSを有効にしてポリシーは作らない（= アプリのAPIキーからは読み書きできない）。
--       運用資料が入るので、サーバー側(service role)からだけ使う想定。
--
-- 現状: scripts/rag/ のスクリプトが、ローカルの PGlite(pgvector入りのPostgres) にこのファイルをそのまま流して
--       動かしている。Supabase への適用は未実施（本番で動かすには、質問を埋め込む処理を
--       Edge Functions 側に置く必要がある。docs/rag.md 参照）。
--
-- 適用順序（Supabaseに入れる場合）: ① staging(rhowcziknvabdranlhvf) → ② production(noygjyxinkriupwequvt)

create extension if not exists vector;

create table if not exists doc_chunks (
  id         bigint generated always as identity primary key,
  source     text not null,                 -- 例: docs/spof.md
  heading    text not null,                 -- 例: 実際に起きた事例
  content    text not null,                 -- 原文（引用の確認に使う）
  embedding  vector(384) not null,
  created_at timestamptz not null default now()
);

-- 近さ(コサイン距離)で素早く探すための索引
create index if not exists doc_chunks_embedding_idx
  on doc_chunks using hnsw (embedding vector_cosine_ops);

alter table doc_chunks enable row level security;

-- 質問に近いチャンクを、近い順に返す（similarity は 1 に近いほど近い）
create or replace function match_doc_chunks(query_embedding vector(384), match_count int default 5)
returns table (id bigint, source text, heading text, content text, similarity float)
language sql stable
set search_path = public, extensions
as $$
  select c.id, c.source, c.heading, c.content,
         (1 - (c.embedding <=> query_embedding))::float as similarity
  from doc_chunks c
  order by c.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20)
$$;

-- ロールバック:
--   drop function if exists match_doc_chunks(vector, int);
--   drop table if exists doc_chunks;
