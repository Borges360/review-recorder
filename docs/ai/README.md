# Infraestrutura para IA

Este diretório complementa [AGENTS.md](../AGENTS.md) com detalhes sobre como diferentes ferramentas consomem o contexto do projeto.

## Arquivos agnósticos (qualquer agente)

| Arquivo | Propósito |
|---------|-----------|
| [AGENTS.md](../AGENTS.md) | Instruções principais — leia sempre |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Fluxo humano + Git Flow |
| [docs/GITFLOW.md](../GITFLOW.md) | Branches e releases |
| [docs/MVP_VALIDATION.md](../MVP_VALIDATION.md) | Critérios de aceite do MVP |

## Cursor

| Caminho | Propósito |
|---------|-----------|
| `.cursor/rules/` | Regras persistentes por escopo (router: `07-workflow-router`) |
| `.cursor/skills/` | Workflows especializados |
| `.cursor/agents/` | Personas para tarefas complexas |
| `.cursor/playbooks/` | Fluxos operacionais por tipo de tarefa |
| `.cursor/AUDITORIA-*.md` | Matriz rules × skills × agents |

Índice de playbooks: `.cursor/playbooks/playbooks-operacionais-review-recorder.md`

## Outras ferramentas

| Ferramenta | Como usar AGENTS.md |
|------------|---------------------|
| **Claude Code** | `CLAUDE.md` referencia `AGENTS.md` |
| **OpenAI Codex** | Apontar `AGENTS.md` nas instruções do projeto |
| **GitHub Copilot** | Copilot lê `AGENTS.md` automaticamente em repos compatíveis |
| **Windsurf / Continue** | Adicionar `AGENTS.md` como context file |

## Skills disponíveis

| Skill | Descrição |
|-------|-----------|
| `review-recorder-dev` | Desenvolvimento no monorepo |
| `session-workflow` | Sessões, timeline, export |
| `git-flow` | Branches e releases |
| `browser-playwright-hud` | HUD, screenshots, E2E |
| `voice-transcription` | Transcrição e correlação |
| `qa-automation-testing` | Planejamento de testes |
| `qa-correcao-testes-segura` | Correção segura de testes |

## Agents disponíveis

| Agent | Descrição |
|-------|-----------|
| `fullstack-architect` | Arquitetura monorepo |
| `session-engineer` | Sessão, timeline, export |
| `browser-automation` | Playwright e HUD |
| `qa-test-fixer` | Testes quebrados |

## Princípios

1. **Uma fonte de verdade** — lógica de domínio em `AGENTS.md`, não duplicada
2. **Regras curtas** — cada rule/skill < 500 linhas
3. **Agnóstico** — evitar menções a APIs proprietárias de um único vendor
4. **Acionável** — comandos copy-paste, checklists, tabelas de mapeamento
