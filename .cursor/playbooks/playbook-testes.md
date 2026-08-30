# Playbook Testes — review-recorder

Criar ou ajustar specs unit e e2e com rastreabilidade ao MVP.

```markdown
Use o playbook TESTES do review-recorder.
Escopo: [módulo ou AC-xxx].
Camada: [unit | e2e].
```

## Regras base

- `60-qa-testing`, `09-doc-test-code-sync`
- Skill `qa-automation-testing`

---

## 1) Decidir camada

| Camada | Quando | Onde |
| --- | --- | --- |
| Unit | Lógica pura, engines, state | `server/test/unit/` |
| E2E | Jornada completa, API+browser | `server/test/e2e/` |

Regras de timeline/correlação → unit.
Golden path recorder → e2e (`recorder-flow.spec.ts`).

## 2) Rastreabilidade

- AC-001 a AC-040 → `acceptance.test.ts`
- Novo critério MVP → atualizar MVP_VALIDATION.md + acceptance

## 3) Padrões

- `FakeTranscriber` em todos os testes automatizados
- Sem `sleep()` — waits Playwright/Vitest
- Fixtures em `fixtures/` para navegação

## 4) Validação

```bash
npm test
npm run test:e2e --workspace=server
```

## 5) Reporte

Testes criados/alterados + regra documentada que validam.
