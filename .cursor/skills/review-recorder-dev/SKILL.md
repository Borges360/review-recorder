---
name: review-recorder-dev
description: Desenvolve no monorepo review-recorder (Fastify, Playwright, React). Use ao implementar features, corrigir bugs, rodar testes ou entender a arquitetura do gravador de revisões web.
---

# review-recorder — desenvolvimento

Leia [AGENTS.md](../../AGENTS.md) primeiro.
Router: `.cursor/rules/07-workflow-router.mdc` | Playbooks: `.cursor/playbooks/`

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

## Dev

```bash
npm run dev:server   # :3000
npm run dev:ui       # :5179
```

## Verificação

```bash
npm test
npm run lint
npm run test:e2e     # se alterou browser/session
```

## Onde editar

| Mudança | Arquivo(s) |
|---------|------------|
| Nova rota API | `server/src/app/routes.ts` |
| WebSocket | `server/src/app/websocket.ts` |
| Ciclo de sessão | `server/src/session/SessionManager.ts` |
| Timeline | `server/src/timeline/` |
| Export REVIEW.md | `server/src/export/` |
| Control UI | `ui/src/App.tsx`, `ui/src/api.ts` |
| Config | `server/src/shared/config.ts`, `.env.example` |

## Branch

Criar `feature/<nome>` a partir de `develop`. Ver [docs/GITFLOW.md](../../docs/GITFLOW.md).

## Rules e agents

| Contexto | Rule | Agent (se complexo) |
|----------|------|---------------------|
| Server | `10-server-fastify` | `fullstack-architect` |
| UI | `20-ui-react` | `fullstack-architect` |
| Browser | `30-playwright-browser` | `browser-automation` |
| Sessão | `40-session-timeline` | `session-engineer` |
| Voz | `50-voice-transcription` | — |
| QA | `60-qa-testing` | `qa-test-fixer` |
