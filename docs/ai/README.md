# Infraestrutura para IA

Este diretório complementa [AGENTS.md](../AGENTS.md) com detalhes sobre como diferentes ferramentas consomem o contexto do projeto.

## Arquivos agnósticos (qualquer agente)

| Arquivo | Propósito |
|---------|-----------|
| [AGENTS.md](../AGENTS.md) | Instruções principais — leia sempre |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Fluxo humano + Git Flow |
| [docs/GITFLOW.md](GITFLOW.md) | Branches e releases |

## Cursor

| Caminho | Propósito |
|---------|-----------|
| `.cursor/rules/` | Regras persistentes por escopo |
| `.cursor/skills/` | Workflows especializados (dev, sessões, git flow) |

## Outras ferramentas

| Ferramenta | Como usar AGENTS.md |
|------------|---------------------|
| **Claude Code** | `CLAUDE.md` pode symlink ou referenciar `AGENTS.md` |
| **OpenAI Codex** | Apontar `AGENTS.md` nas instruções do projeto |
| **GitHub Copilot** | Copilot lê `AGENTS.md` automaticamente em repos compatíveis |
| **Windsurf / Continue** | Adicionar `AGENTS.md` como context file |

### CLAUDE.md (opcional)

Para Claude Code, crie na raiz:

```markdown
# Claude

Siga as instruções em [AGENTS.md](./AGENTS.md).
```

## Skills disponíveis

| Skill | Descrição |
|-------|-----------|
| `review-recorder-dev` | Desenvolvimento no monorepo |
| `session-workflow` | Sessões, timeline, export |
| `git-flow` | Branches e releases |

## Princípios

1. **Uma fonte de verdade** — lógica de domínio em `AGENTS.md`, não duplicada
2. **Regras curtas** — cada rule/skill < 500 linhas
3. **Agnóstico** — evitar menções a APIs proprietárias de um único vendor
4. **Acionável** — comandos copy-paste, checklists, tabelas de mapeamento
