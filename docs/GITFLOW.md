# Git Flow

Este repositório segue [Git Flow](https://nvie.com/posts/a-successful-git-branching-model/) com branches permanentes `main` e `develop`.

## Branches

```
main ─────●─────────────●──────── hotfix/* ──●
           \           /                    /
            release/* ●                    /
                     /                    /
develop ──●──●──●──●──●──●── feature/* ──●
```

### Permanentes

| Branch | Propósito |
|--------|-----------|
| `main` | código em produção; sempre estável e taggeável |
| `develop` | integração contínua; base para features |

### Temporárias

| Padrão | Criada de | Merge em | Exemplo |
|--------|-----------|----------|---------|
| `feature/<nome>` | `develop` | `develop` | `feature/voice-offline-mode` |
| `release/<versão>` | `develop` | `main` + `develop` | `release/1.1.0` |
| `hotfix/<nome>` | `main` | `main` + `develop` | `hotfix/transcriber-crash` |

## Fluxos

### Feature

```bash
git checkout develop
git pull origin develop
git checkout -b feature/minha-feature

# ... commits ...

git push -u origin feature/minha-feature
# Abrir PR → develop
```

### Release

```bash
git checkout develop
git pull origin develop
git checkout -b release/1.2.0

# bump version, changelog, fixes finais
git commit -m "chore(release): prepare 1.2.0"

git checkout main
git merge --no-ff release/1.2.0
git tag -a v1.2.0 -m "v1.2.0"
git checkout develop
git merge --no-ff release/1.2.0
git branch -d release/1.2.0
git push origin main develop --tags
```

### Hotfix

```bash
git checkout main
git pull origin main
git checkout -b hotfix/critical-fix

# ... fix ...

git checkout main
git merge --no-ff hotfix/critical-fix
git tag -a v1.2.1 -m "v1.2.1"
git checkout develop
git merge --no-ff hotfix/critical-fix
git branch -d hotfix/critical-fix
git push origin main develop --tags
```

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(browser): add manual screenshot hotkey
fix(voice): handle empty audio chunks
docs: update AGENTS.md architecture section
test(timeline): cover correlation edge cases
chore(deps): bump playwright to 1.53
```

## Proteção de branches (recomendado no GitHub)

- `main`: require PR, status checks (CI), no direct push
- `develop`: require PR, status checks

## Setup inicial (já feito no repo)

```powershell
.\scripts\setup-git-flow.ps1
```

Ou manualmente:

```bash
git checkout -b develop
git push -u origin develop
```
