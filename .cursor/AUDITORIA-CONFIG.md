# Auditoria da configuração `.cursor` — review-recorder

## Origem

Adaptado do padrão operacional do projeto **interview** (`C:\Users\felip\Desenvolvimento\interview\.cursor`), ajustado para stack Fastify + Playwright + React (sem Next.js, PostgreSQL ou RAG).

## Mapa rules × skills (evitar duplicação)

| Par | Sobreposição | Ação |
| --- | --- | --- |
| `60-qa-testing` × `qa-automation-testing` | Princípios QA | Rule enxuta; skill só workflow |
| `40-session-timeline` × `session-workflow` | Pipeline sessão | Rule referência técnica; skill operacional |
| `30-playwright-browser` × `browser-playwright-hud` | HUD/captura | Rule políticas; skill onde editar |
| `50-voice-transcription` × `voice-transcription` | Transcrição | Rule políticas; skill operacional |
| `project-standards` × `00-general` | Princípios gerais | `project-standards` = bridge AGENTS.md; `00` = qualidade/fluxo |

## Regras específicas review-recorder

| Arquivo | Propósito |
| --- | --- |
| `10-server-fastify` | Backend Fastify, ESM, rotas |
| `20-ui-react` | Control UI React |
| `30-playwright-browser` | HUD, screenshots, E2E |
| `40-session-timeline` | Sessão, timeline, export |
| `50-voice-transcription` | Voz, OpenAI, FakeTranscriber |
| `60-qa-testing` | Vitest + Playwright |

## Regras reutilizadas (adaptadas do interview)

| Arquivo | Adaptação |
| --- | --- |
| `00`, `05`, `07`–`09` | Paths server/ui, router tipos review-recorder |
| `project-standards` | Bridge para AGENTS.md + tabela de rules |

## Excluído (não aplicável)

- Next.js, PostgreSQL, pgvector, RAG, BullMQ
- Domínios de entrevista/aprendizagem
- Observabilidade avançada, feature toggles
- Backlog `docs/notas/*-correcoes.md`

## Playbooks

- Índice: [playbooks-operacionais-review-recorder.md](playbooks/playbooks-operacionais-review-recorder.md)
- Específico: `playbook-session-debug.md`, `playbook-discovery.md`

## Fontes de produto

- [AGENTS.md](../AGENTS.md) — arquitetura e comandos
- [docs/MVP_VALIDATION.md](../docs/MVP_VALIDATION.md) — critérios de aceite

## Checklist contínuo

- [ ] Rules alwaysApply objetivas e sem redundância
- [ ] Router `07` aponta para playbooks existentes
- [ ] AGENTS.md inventário sincronizado com `.cursor/`
- [ ] Comandos `npm test` / `test:e2e` atualizados quando `package.json` mudar
