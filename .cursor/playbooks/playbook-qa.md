# Playbook QA — review-recorder

Corrigir testes quebrados sem bypass, com classificação de falha.

```markdown
Use o playbook QA do review-recorder.
Falha: [comando + output resumido].
Suspeita: [produto | teste | infra].
```

## Regras base

- `60-qa-testing`, `09-doc-test-code-sync`
- Skill `qa-correcao-testes-segura` | Agent `qa-test-fixer`

---

## 1) Fluxo

1. Reproduzir com comando exato.
2. Classificar (produto / teste / infra / comportamento mudou).
3. Consultar AGENTS.md e MVP antes de enfraquecer assert.
4. Corrigir na camada correta.
5. Rodar suite alvo + lint se TS alterado.

## 2) Anti-bypass

- Sem `skip` permanente
- Sem remover asserts de regra de negócio
- Sem mock que esconde bug real

## 3) Comandos

```bash
npm test
npm run test:e2e --workspace=server
npm run lint
```

## 4) Reporte

Classificação + arquivos + pass/fail.
