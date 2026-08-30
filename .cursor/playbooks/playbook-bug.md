# Playbook Bug — review-recorder

Corrigir divergência entre **esperado** (AGENTS/MVP) e **atual** (código/testes/sessão).

```markdown
Use o playbook BUG do review-recorder.
Bug: [descrição].
Esperado: [AGENTS/MVP/AC].
Evidência: [teste, sessão, log].
```

## Regras base

- `00`–`09`, `60-qa-testing` quando tocar testes

---

## 1) Fluxo obrigatório

### Passo A — Reproduzir

1. Menor cenário que reproduz o bug.
2. Passos exatos registrados.
3. Se sessão: inspecionar `sessions/<id>/raw/events.jsonl` e `REVIEW.md`.

### Passo B — Comparar

Fontes (ordem):

1. [AGENTS.md](../../AGENTS.md), [MVP_VALIDATION.md](../../docs/MVP_VALIDATION.md)
2. `acceptance.test.ts` (AC-xxx)
3. Código (evidência)

- **Esperado:** citação doc
- **Atual:** teste/log/sessão
- **Gap:** divergência objetiva

### Passo C — Classificar

| Tipo | Ação |
| --- | --- |
| Bug produto | Corrigir código + regressão |
| Bug teste | Skill `qa-correcao-testes-segura` |
| Doc desatualizada | Atualizar docs |
| Dúvida | 1 pergunta objetiva |

### Passo D — Corrigir

1. Causa raiz na camada correta (session, timeline, browser, voice, ui).
2. Regressão na camada adequada.
3. Testes alvo executados.

---

## 2) Reporte

Incluir bloco "Instruções consideradas" + comandos pass/fail.
