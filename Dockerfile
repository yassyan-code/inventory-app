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
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
