#!/usr/bin/env bash
# PRを出す前のチェックを1本にまとめたスクリプト。
# 使い方: bash scripts/pre-pr-check.sh
# 手でやっていた「git status → lint → test → build」を順に流し、どこかで失敗したら止まる。
# 秘密や本番には触らない(ローカルのコードを調べるだけ)。

set -euo pipefail  # 失敗で止まる / 未定義の変数はエラー / パイプの途中の失敗も拾う

# どこから呼んでも動くように、プロジェクトの直下へ移動する
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

step "1/4 いまの場所と変更(git status)"
echo "ブランチ: $(git branch --show-current)"
git status --short

step "2/4 lint"
npm run lint

step "3/4 テスト"
npm test

step "4/4 ビルド"
npm run build

printf '\n\033[32m全部通りました。PRを出せます。\033[0m\n'
