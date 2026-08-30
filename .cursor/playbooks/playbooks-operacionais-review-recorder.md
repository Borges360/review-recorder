# Playbooks operacionais — review-recorder

Índice e **router** para escolher o playbook certo, reduzir contexto e manter entregas consistentes.

---

## Regras base (sempre)

- `@.cursor/rules/00-general.mdc`
- `@.cursor/rules/05-token-efficiency.mdc`
- `@.cursor/rules/07-workflow-router.mdc`
- `@.cursor/rules/08-reuse-first.mdc`
- `@.cursor/rules/09-doc-test-code-sync.mdc`
- `@.cursor/rules/project-standards.mdc`

---

## 1) Classificar a solicitação

| Tipo | Sinais | Playbook |
| --- | --- | --- |
| **Discovery** | Escopo incerto; PRD necessário; feature > 2 módulos sem spec | `@.cursor/playbooks/playbook-discovery.md` |
| **Bug** | Comportamento diverge de AGENTS/MVP; regressão | `@.cursor/playbooks/playbook-bug.md` |
| **Feature** | Capacidade nova; escopo ampliado | `@.cursor/playbooks/playbook-feature.md` |
| **Session-debug** | Timeline incompleta, RECOVERABLE, export errado | `@.cursor/playbooks/playbook-session-debug.md` |
| **QA** | Corrigir teste quebrado sem bypass | `@.cursor/playbooks/playbook-qa.md` |
| **Testes** | Criar/ajustar spec unit ou e2e | `@.cursor/playbooks/playbook-testes.md` |
| **Refatoração** | Estrutura sem mudar comportamento | `@.cursor/playbooks/playbook-refatoracao.md` |

---

## 2) Fluxo recomendado por cenário

### Bug isolado

```text
playbook-bug → testes (regressão) → validação
```

### Feature nova (escopo claro)

```text
playbook-feature → playbook-testes → validação (npm test + e2e)
```

### Feature nova (escopo incerto)

```text
playbook-discovery → (aprovação) → playbook-feature → playbook-testes → validação
```

### Sessão com artefatos ruins

```text
playbook-session-debug → playbook-bug (se bug) → recompilar
```

### CI vermelho

```text
playbook-qa → qa-correcao-testes-segura
```

---

## 3) Rules por contexto

| Contexto | Rules |
| --- | --- |
| Server/Fastify | `10-server-fastify` |
| Control UI | `20-ui-react` |
| Browser/HUD | `30-playwright-browser` |
| Sessão/timeline | `40-session-timeline` |
| Voz | `50-voice-transcription` |
| Testes/QA | `60-qa-testing` |

---

## 4) Agents e skills (escalonar só se necessário)

| Área | Agent | Skills |
| --- | --- | --- |
| Arquitetura | `fullstack-architect` | `review-recorder-dev` |
| Sessão/timeline | `session-engineer` | `session-workflow` |
| Browser | `browser-automation` | `browser-playwright-hud` |
| Voz | — | `voice-transcription` |
| QA | `qa-test-fixer` | `qa-correcao-testes-segura`, `qa-automation-testing` |
| Git | — | `git-flow` |

---

## 5) Reporte ao final

```markdown
## Instruções consideradas
- **Tipo/playbook:** ...
- **Rules:** ...
- **Agent:** ...
- **Skills:** ...
- **Docs consultadas:** ...
- **Validação:** ...
- **Reuso aplicado:** ...
```

Fonte de arquitetura: [AGENTS.md](../../AGENTS.md) | MVP: [docs/MVP_VALIDATION.md](../../docs/MVP_VALIDATION.md)
