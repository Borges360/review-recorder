---
name: git-flow
description: Aplica Git Flow no review-recorder — branches feature/release/hotfix, Conventional Commits e PRs. Use ao criar branches, preparar releases, hotfixes ou quando o usuário pedir versionamento/git flow.
---

# Git Flow — review-recorder

Referência completa: [docs/GITFLOW.md](../../docs/GITFLOW.md)

## Branches

- `main` — produção
- `develop` — integração (base para features)
- `feature/*`, `release/*`, `hotfix/*`

## Feature (padrão)

```bash
git checkout develop
git pull origin develop
git checkout -b feature/descricao-curta
# commits...
git push -u origin feature/descricao-curta
# PR → develop
```

## Commits

```
feat(scope): imperativo curto
fix(voice): handle empty chunk
docs: update AGENTS.md
test(timeline): add correlation case
chore(release): bump to 1.2.0
```

## Release

```bash
git checkout -b release/1.2.0 develop
# bump version in package.json files, changelog
git checkout main && git merge --no-ff release/1.2.0
git tag -a v1.2.0 -m "v1.2.0"
git checkout develop && git merge --no-ff release/1.2.0
```

## Hotfix

```bash
git checkout -b hotfix/descricao main
# fix...
# merge → main (tag) + develop
```

## Regras

- Nunca force-push em `main`/`develop`
- PRs de feature sempre para `develop`
- Hotfix PR para `main`
