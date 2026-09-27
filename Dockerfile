# ---- ビルド用の箱 ----
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# VITE_ 変数はビルド時にコードへ埋め込まれるため、build引数として受け取る
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_YAHOO_APP_ID
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_YAHOO_APP_ID=$VITE_YAHOO_APP_ID

RUN npm run build

# ---- 配布用の箱（ビルド結果だけを積み替える） ----
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# .template + /etc/nginx/templates/ 配置により、起動時にnginx公式イメージの
# entrypointスクリプトが${PORT}をenvsubstで実際の値に置き換えてから起動する
# （Railway等、実行時にランダムなPORTを割り当てるPaaS向け。ローカルDockerでは
# 下のENVの既定値80が使われる）。
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# RailwayがPORTを注入しなかった場合(ローカルdocker run等)の既定値
ENV PORT=80
EXPOSE 80
