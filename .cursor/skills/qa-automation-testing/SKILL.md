---
name: qa-automation-testing
description: Planejamento QA, matriz requisito ↔ teste e cobertura por camada no review-recorder.
---

# QA Automation Testing

## Quando usar

- Planejar suite para módulo novo (sessão, timeline, browser, voz).
- Auditar lacunas de cobertura vs MVP_VALIDATION.

## Passos

1. Ler requisitos em [AGENTS.md](../../AGENTS.md) e [docs/MVP_VALIDATION.md](../../docs/MVP_VALIDATION.md).
2. Mapear AC-001 a AC-040 em `acceptance.test.ts`.
3. Matriz requisito × camada (unit / e2e).
4. Identificar lacunas explícitas.
5. Priorizar golden path E2E (`recorder-flow.spec.ts`).

## Camadas

| Camada | Onde | Comando |
|--------|------|---------|
| Unit | `server/test/unit/` | `npm test` |
| E2E | `server/test/e2e/` | `npm run test:e2e` |

## Saída

- Matriz de rastreabilidade
- Lista de testes a implementar
- Comandos de validação executados

Rules: `60-qa-testing`
Playbooks: `playbook-testes`, `playbook-qa`
