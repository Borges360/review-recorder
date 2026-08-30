#!/usr/bin/env bash
# Inicializa branches do Git Flow (main + develop).
set -euo pipefail

branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$branch" != "main" ]]; then
  echo "Checkout main primeiro (atual: $branch)..."
  git checkout main
fi

if ! git rev-parse --verify develop >/dev/null 2>&1; then
  echo "Criando branch develop..."
  git branch develop
else
  echo "Branch develop já existe."
fi

if git remote get-url origin >/dev/null 2>&1; then
  echo "Push develop → origin..."
  git push -u origin develop
else
  echo "Remote origin não configurado."
fi

echo ""
echo "Git Flow pronto."
git branch -a
