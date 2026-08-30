# Playbook Refatoração — review-recorder

Reestruturar código sem alterar comportamento observável.

```markdown
Use o playbook REFATORACAO do review-recorder.
Escopo: [módulos].
Motivo: [clareza, boundaries, duplicação].
```

## Regras base

- `08-reuse-first`, `09-doc-test-code-sync`
- Agent `fullstack-architect` se cross-cutting

---

## 1) Pré-requisitos

1. Testes existentes passando (`npm test`, `npm run test:e2e`).
2. Comportamento declarado como inalterado.
3. Mapa do fluxo atual documentado.

## 2) Fluxo

### Passo A — Mapear

```text
UI (api.ts) → routes → SessionManager → browser/timeline/voice → export → persistence
```

### Passo B — Refatorar incrementalmente

1. Uma camada ou módulo por vez.
2. Rodar testes após cada passo.
3. Não misturar refactor com feature/bugfix.

### Passo C — Validar

```bash
npm test
npm run test:e2e --workspace=server
npm run lint
```

## 3) Proibido sem declarar

- Mudar contrato de API
- Alterar formato de REVIEW.md/review.json
- Mudar transições de SessionStatus

## 4) Reporte

Mapa antes/depois + testes executados + reuso aplicado.
