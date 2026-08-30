# Auditoria Agents / Rules / Skills — review-recorder

Matriz de conformidade: cada agent referencia rules/skills/playbooks aplicáveis.

## fullstack-architect

| Tipo | Artefatos |
| --- | --- |
| Rules | `10-server-fastify`, `20-ui-react`, `08-reuse-first`, `project-standards` |
| Skills | `review-recorder-dev` |
| Playbooks | `playbook-discovery`, `playbook-feature`, `playbook-refatoracao` |

## session-engineer

| Tipo | Artefatos |
| --- | --- |
| Rules | `40-session-timeline`, `50-voice-transcription` |
| Skills | `session-workflow`, `voice-transcription` |
| Playbooks | `playbook-session-debug`, `playbook-bug` |

## browser-automation

| Tipo | Artefatos |
| --- | --- |
| Rules | `30-playwright-browser`, `40-session-timeline` |
| Skills | `browser-playwright-hud` |
| Playbooks | `playbook-bug`, `playbook-testes` |

## qa-test-fixer

| Tipo | Artefatos |
| --- | --- |
| Rules | `60-qa-testing`, `09-doc-test-code-sync` |
| Skills | `qa-correcao-testes-segura`, `qa-automation-testing` |
| Playbooks | `playbook-qa`, `playbook-testes` |

## Skills transversais

| Skill | Rules | Playbooks |
| --- | --- | --- |
| `review-recorder-dev` | `project-standards`, `10`–`60` | todos (incl. `playbook-discovery`) |
| `session-workflow` | `40`, `50` | `playbook-session-debug` |
| `git-flow` | `project-standards` | — |
| `voice-transcription` | `50`, `40` | `playbook-session-debug` |
| `browser-playwright-hud` | `30` | `playbook-testes` |
| `qa-automation-testing` | `60` | `playbook-testes`, `playbook-qa` |
| `qa-correcao-testes-segura` | `60`, `09` | `playbook-qa` |

## Verificação

- [x] 4 agents documentados
- [x] 7 skills documentadas
- [x] 12 rules com frontmatter (inclui `project-standards`)
- [x] 8 arquivos em playbooks/ (índice + 7 playbooks)
