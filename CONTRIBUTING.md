# Contribuindo

Obrigado por contribuir com o **review-recorder**!

## Antes de começar

1. Leia [AGENTS.md](AGENTS.md) — guia para humanos e agentes de IA
2. Leia [docs/GITFLOW.md](docs/GITFLOW.md) — modelo de branches
3. Configure o ambiente:

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

## Fluxo de trabalho

1. Crie issue ou discuta a mudança
2. Branch a partir de `develop`: `feature/<descricao-curta>`
3. Implemente com testes quando aplicável
4. Rode `npm test` e `npm run lint`
5. Abra PR para `develop` usando o template
6. Aguarde review e CI verde

### Exceções

- **Hotfix** → branch de `main`, PR para `main` (merge back em `develop`)
- **Release** → branch `release/x.y.z` de `develop`

## Padrões de código

- TypeScript strict; ESM no server (imports com `.js`)
- ESLint + Prettier (rodar `npm run format` se necessário)
- Testes unitários em Vitest (`server/src/**/*.test.ts`)
- E2E em Playwright (`server/tests/e2e/`)

## Commits

[Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): descrição imperativa curta

Corpo opcional com contexto.
```

## PRs

- Título no formato Conventional Commits
- Descreva o **porquê**, não só o quê
- Inclua plano de teste
- Screenshots se mudar UI

## Agentes de IA

Se usar Cursor, Claude Code, Codex ou similar:

- Siga [AGENTS.md](AGENTS.md)
- Skills do projeto em `.cursor/skills/`
- Não commite `.env`, `sessions/` ou `data/`
