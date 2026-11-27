---
name: qa-correcao-testes-segura
description: Corrige testes quebrados sem enfraquecer asserts — classifica falha e aplica regressão mínima.
---

# QA — Correção Segura de Testes

## Quando usar

- `npm test` ou `npm run test:e2e` falhou após mudança.
- Teste flaky ou desalinhado com documentação.

## Fluxo obrigatório

### 1) Reproduzir

```bash
npm test
npm run test:e2e --workspace=server
```

Registrar comando exato e output da falha.

### 2) Classificar

| Tipo | Sinal | Ação |
|------|-------|------|
| Bug produto | Código diverge de AGENTS/MVP | Corrigir código + manter teste |
| Bug teste | Assert errado ou fixture obsoleta | Corrigir teste |
| Comportamento mudou | Decisão deliberada documentada | Atualizar doc + teste |
| Infra/flaky | Timeout, race | Estabilizar wait/fixture |

### 3) Anti-bypass

Proibido sem justificativa documentada:

- `test.skip` / `test.only` permanente
- Remover asserts que validam regra de negócio
- Aumentar timeout sem corrigir causa
- Mockar o módulo sob teste para "passar"

### 4) Regressão

- Bugfix de produto → adicionar caso mínimo que falharia antes.
- Preferir unit para lógica; e2e só para jornada completa.

## Saída

- Classificação da falha
- Arquivos alterados
- Comandos pass/fail

Rules: `60-qa-testing`, `09-doc-test-code-sync`
Agent: `qa-test-fixer`
