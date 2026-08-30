# AGENTS.md — Guia para agentes de IA

> Instruções **agnósticas de ferramenta** (Cursor, Claude Code, Codex, Copilot, etc.).
> Leia este arquivo antes de modificar o repositório.

## Projeto

**review-recorder** — ferramenta local para revisão de aplicações web com navegação real (Playwright), comentários por voz e timeline semântica exportável para LLMs.

| Pacote | Caminho | Stack |
|--------|---------|-------|
| Monorepo root | `/` | npm workspaces, ESLint, Prettier |
| Backend | `server/` | Fastify, Playwright, Vitest, TypeScript ESM |
| Frontend | `ui/` | React 19, Vite, TypeScript |

## Comandos essenciais

```bash
npm install
npx playwright install chromium
cp .env.example .env          # configure OPENAI_API_KEY

npm run dev:server              # backend :3000
npm run dev:ui                  # control UI :5179
npm test                        # unitários (Vitest)
npm run test:e2e                # e2e (Playwright)
npm run lint
npm run compile -- <sessionId>  # recompilar sessão
```

## Arquitetura

```
server/src/
├── app/          # rotas HTTP + WebSocket
├── browser/      # Playwright, screenshots, interações in-page
├── session/      # ciclo de vida da sessão (CREATED → COMPLETED)
├── timeline/     # redução de eventos → timeline semântica
├── voice/        # transcrição (OpenAI, fake, offline)
├── export/       # REVIEW.md + review.json
├── persistence/  # EventStore, SessionRepository
└── shared/       # types, config, events

ui/src/           # Control UI (React)
fixtures/         # app demo para testes
sessions/         # artefatos gerados (gitignored)
```

### Fluxo de sessão

1. UI cria sessão → `SessionManager.start()`
2. Playwright abre browser com HUD in-page
3. Eventos (cliques, navegação, fala) → `EventStore` (JSONL)
4. `finalize` → `SessionCompiler` → `REVIEW.md` + `review.json`

### Tipos centrais

- `SessionStatus`: CREATED → STARTING → RECORDING → … → COMPLETED | FAILED | RECOVERABLE
- `TranscriptSegmentRecord`: fala correlacionada a tela/elemento; durante fala contínua, cada CLICK emite um bloco via `TranscriptAssembler.flushAtClick` (split em fronteira de palavra)
- `ScreenStateRecord`: snapshot semântico de cada tela

## Regras de código

1. **Escopo mínimo** — altere só o necessário; não refatore sem pedido.
2. **ESM** — imports com extensão `.js` no server (`import x from './foo.js'`).
3. **Sem secrets** — nunca commitar `.env`; usar `.env.example`.
4. **Testes** — rodar `npm test` após mudanças no server; e2e se tocar browser/session.
5. **Idioma** — código/comentários em inglês; docs de usuário em português.
6. **Formatação** — seguir ESLint + Prettier existentes.

## Git Flow

Branch principal de integração: `develop`. Produção: `main`.

| Prefixo | Uso | Base | Merge em |
|---------|-----|------|----------|
| `feature/*` | nova funcionalidade | `develop` | `develop` |
| `release/*` | preparar versão | `develop` | `main` + `develop` |
| `hotfix/*` | correção urgente em prod | `main` | `main` + `develop` |

Commits: [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `docs:`, `test:`, `chore:`.

Detalhes: [docs/GITFLOW.md](docs/GITFLOW.md) e [CONTRIBUTING.md](CONTRIBUTING.md).

## Skills do projeto

Skills em `.cursor/skills/` (Cursor) ou equivalente na sua ferramenta:

| Skill | Quando usar |
|-------|-------------|
| `review-recorder-dev` | desenvolvimento geral no monorepo |
| `session-workflow` | sessões, timeline, export |
| `git-flow` | branches, releases, PRs |
| `browser-playwright-hud` | HUD, screenshots, E2E browser |
| `voice-transcription` | transcrição e correlação fala-tela |
| `qa-automation-testing` | planejamento de testes e cobertura |
| `qa-correcao-testes-segura` | corrigir testes sem bypass |

## Agents (Cursor)

Agents em `.cursor/agents/` — escalonar só para tarefas complexas:

| Agent | Quando usar |
|-------|-------------|
| `fullstack-architect` | arquitetura cross-cutting, refactors estruturais |
| `session-engineer` | debug de sessão, timeline, export |
| `browser-automation` | Playwright, HUD, captura de eventos |
| `qa-test-fixer` | testes quebrados, regressão |

## Rules e playbooks (Cursor)

| Tipo | Caminho |
|------|---------|
| Rules | `.cursor/rules/` — router em `07-workflow-router` |
| Playbooks | `.cursor/playbooks/` — índice em `playbooks-operacionais-review-recorder.md` |
| Auditoria | `.cursor/AUDITORIA-AGENTS-RULES-SKILLS.md` |

Rules por contexto: `10-server-fastify`, `20-ui-react`, `30-playwright-browser`, `40-session-timeline`, `50-voice-transcription`, `60-qa-testing`.

## Arquivos sensíveis (não modificar sem pedido)

- `sessions/`, `data/`, `server/data/` — runtime, gitignored
- `.env` — credenciais locais

## Checklist antes de finalizar

- [ ] `npm test` passa
- [ ] `npm run lint` passa (se alterou TS)
- [ ] Sem `.env` ou dados de sessão no diff
- [ ] Commit message segue Conventional Commits
- [ ] PR aponta para `develop` (exceto hotfix/release)
