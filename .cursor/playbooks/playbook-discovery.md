# Playbook Discovery — review-recorder

Produzir discovery/PRD **acionável** para handoff de implementação — **sem implementar código** nesta fase.

```markdown
Use o playbook DISCOVERY do review-recorder.
Tema/feature: [nome].
Objetivo: discovery/PRD para handoff de implementação.
Contexto: [módulo, gap no MVP, ideia nova].
```

## Regras base (sempre)

- `@.cursor/rules/00-general.mdc` … `09-doc-test-code-sync.mdc`
- `@.cursor/rules/project-standards.mdc`
- Skill: `review-recorder-dev` (contexto) | Agent: `fullstack-architect` (se escopo cross-cutting)

**Proibido nesta fase:** commits de código de produto, specs novas, alteração de `server/` ou `ui/` (apenas planejamento e documentação).

---

## 1) Escopo da discovery

### Passo A — Contextualizar

1. Identificar **problema/JTBD** (ex.: revisor precisa X durante gravação; LLM não entende Y no REVIEW.md).
2. Ler [AGENTS.md](../../AGENTS.md) como fonte de arquitetura.
3. Ler [docs/MVP_VALIDATION.md](../../docs/MVP_VALIDATION.md) para critérios já cobertos (AC-001 a AC-040).
4. Mapear domínio afetado: **Sessão** | **Browser/HUD** | **Timeline** | **Voz** | **Export** | **Control UI**.

### Passo B — Estado atual

| Status | Significado |
| --- | --- |
| **Já feito** | Existe e atende ao critério |
| **Parcial** | Incompleto ou inconsistente |
| **Falta** | Não implementado |
| **Melhorar** | UX, performance ou manutenção inadequados |

Evidências obrigatórias: arquivo, rota, teste (`acceptance.test.ts`) ou artefato de sessão — **não suposição**.

### Passo C — Delimitar escopo

- **Dentro:** RFs P0 mínimos para entregar valor.
- **Fora:** explicitar o que **não** será feito nesta entrega.
- **Dependências:** OpenAI/voz, Playwright, formato REVIEW.md, WebSocket, filesystem de sessões.

---

## 2) Inventário técnico (antes de propor solução)

| Camada | Onde investigar |
| --- | --- |
| API/sessão | `server/src/app/routes.ts`, `SessionManager` |
| Browser/HUD | `server/src/browser/` |
| Timeline | `server/src/timeline/` |
| Voz | `server/src/voice/` |
| Export | `server/src/export/` |
| UI | `ui/src/App.tsx`, `ui/src/api.ts` |
| Tipos/eventos | `server/src/shared/types.ts`, `events.ts` |
| Testes | `server/test/unit/acceptance.test.ts`, `server/test/e2e/` |

Registrar oportunidades de **reuso** (`08-reuse-first`) antes de sugerir módulos novos.

---

## 3) Entregável mínimo

Salvar em: `docs/discovery/YYYY-MM-DD-<tema>.md`

Use o template abaixo. Criar a pasta `docs/discovery/` se não existir.

```markdown
# Discovery — <tema>

**Data:** YYYY-MM-DD  
**Status:** rascunho | revisão | aprovado  
**Domínio(s):** Sessão | Browser | Timeline | Voz | Export | UI

## 1. Contexto e objetivo

[Problema em 2–3 frases. Objetivo mensurável.]

## 2. JTBD / Persona

- **Quando** [situação], **quero** [ação], **para** [resultado].

## 3. Escopo

### Dentro
- RF-01: ...

### Fora
- ...

## 4. Gap atual (com evidências)

| RF | Status | Evidência (arquivo/teste/sessão) |
|----|--------|----------------------------------|
| RF-01 | Parcial | `server/src/...` |

## 5. Requisitos funcionais

### RF-01 — [título]
- **Given** ...
- **When** ...
- **Then** ...

## 6. Requisitos não funcionais

- Performance, offline, privacidade, formato LLM, etc.

## 7. Priorização

| ID | Prioridade | Justificativa |
|----|------------|---------------|
| RF-01 | P0 | ... |

## 8. Impacto técnico

| Área | Mudança provável |
|------|------------------|
| API | ... |
| Eventos/timeline | ... |
| REVIEW.md / review.json | ... |
| Testes | unit / e2e / AC-xxx |

## 9. Plano de testes (shift-left)

| RF | Camada | Cenário |
|----|--------|---------|
| RF-01 | unit | ... |

## 10. Riscos e decisões pendentes

- [ ] Decisão 1: ...

## 11. Handoff para implementação

Próximo playbook: `playbook-feature.md`  
Pré-requisitos: RFs P0 aprovados, testes planejados.
```

---

## 4) Critérios de qualidade

Antes de considerar a discovery pronta:

- [ ] Cada RF tem Given/When/Then testável
- [ ] Gap atual citado com evidência de código ou teste
- [ ] Impacto em `REVIEW.md` / `review.json` avaliado (se afeta export para LLM)
- [ ] Plano de testes indica camada (unit vs e2e) e se usa `FakeTranscriber`
- [ ] Escopo fora explícito
- [ ] Nenhum código de produto alterado nesta fase

---

## 5) Fluxo após discovery

```text
playbook-discovery → (aprovação) → playbook-feature → playbook-testes → validação
```

Se escopo incerto durante `playbook-feature`: **parar** e voltar a este playbook.

---

## 6) Reporte

```markdown
## Instruções consideradas
- **Tipo/playbook:** discovery → playbook-discovery.md
- **Rules:** 00, 05, 07, 08, 09, project-standards
- **Agent:** fullstack-architect (se escalado)
- **Skills:** review-recorder-dev
- **Docs consultadas:** AGENTS.md, MVP_VALIDATION.md, ...
- **Validação:** documento salvo em docs/discovery/, sem código alterado
```
