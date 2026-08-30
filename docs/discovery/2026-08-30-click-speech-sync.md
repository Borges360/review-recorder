# Discovery — Sync fala ↔ clique na timeline

**Data:** 2026-08-30  
**Status:** aprovado  
**Domínio(s):** Timeline | Voz | Export

## 1. Contexto e objetivo

Durante revisões com fala contínua e cliques frequentes, a transcrição inteira aparece em um único bloco no início da timeline (`00:00.000`), enquanto os cliques ficam intercalados mais adiante sem texto associado. O objetivo é que cada clique durante fala ativa gere um novo bloco de transcrição, posicionado temporalmente na timeline e correlacionado ao elemento clicado.

## 2. JTBD / Persona

- **Quando** reviso uma aplicação falando e clicando ao mesmo tempo, **quero** que cada trecho de fala fique ligado ao elemento que acabei de clicar, **para** que a LLM e eu entendam o contexto de cada observação sem reler um monólogo de 2 minutos.

## 3. Escopo

### Dentro

- RF-01: CLICK durante fala ativa → novo bloco de transcrição
- RF-02: Split só em fronteira de palavra (PT); palavra incompleta vai para o próximo bloco
- RF-03: Cada bloco usa `startedAtMs`/`endedAtMs` do intervalo entre cliques; timeline intercalada
- RF-04: Bloco após clique herda contexto do clique → `scope=ELEMENT`, `candidateElement` do alvo
- RF-05: Reconciliar `onFinal` (texto completo do item OpenAI) com blocos já emitidos via partial

### Fora

- Split por mudança de tela (`SCREEN_STATE_CHANGED`)
- Split por `INPUT_CHANGED` ou `FORM_SUBMITTED`
- Split proporcional só por tempo (sem partial text)
- Offline fallback multi-bloco (mantém bloco único)
- Trigger confirmado: **somente CLICK**

## 4. Gap atual (com evidências)

| RF | Status | Evidência (arquivo/teste/sessão) |
|----|--------|----------------------------------|
| RF-01 | Falta | `SessionManager.handleBrowserEvent` — cliques só chamam `recordAction` |
| RF-02 | Falta | Não existe helper de word boundary em `CorrelationEngine.ts` |
| RF-03 | Parcial | `SessionCompiler` ordena por `atMs`; falta emitir múltiplos `TRANSCRIPT_FINAL` |
| RF-04 | Parcial | `CorrelationEngine.recordAction` existe; contexto não aplicado por bloco |
| RF-05 | Falta | `onFinal` chama `finalize()` com texto integral, ignorando flushes |

## 5. Requisitos funcionais

### RF-01 — Split por clique

- **Given** fala ativa com partial text acumulado
- **When** ocorre evento CLICK
- **Then** emite `TRANSCRIPT_FINAL` para o trecho até a última palavra completa e reinicia fala ativa com o remainder

### RF-02 — Fronteira de palavra

- **Given** partial text `"botão irregu"` (palavra incompleta no final)
- **When** ocorre CLICK
- **Then** nenhum bloco é emitido; remainder continua `"botão irregu"`

- **Given** partial text `"botão irregu lar"`
- **When** ocorre CLICK
- **Then** bloco emitido com `"botão irregu"`; remainder `"lar"`

### RF-03 — Timeline intercalada

- **Given** múltiplos blocos com `startedAtMs` distintos
- **When** `SessionCompiler` compila
- **Then** observações aparecem intercaladas com cliques e telas, ordenadas por tempo

### RF-04 — Correlação por bloco

- **Given** clique em elemento com `accessibleName` conhecido
- **When** bloco é emitido após o clique
- **Then** `scope=ELEMENT`, `candidateElement` aponta para o alvo, `associationConfidence=HIGH`

### RF-05 — Reconciliação no finalize

- **Given** blocos já emitidos via flush de clique
- **When** `onFinal` recebe texto completo do item OpenAI
- **Then** apenas o remainder (não emitido) é finalizado; sem duplicação de texto

## 6. Requisitos não funcionais

- Sem dependências novas
- Testes determinísticos com `FakeTranscriber`
- Compatível com formato existente de `REVIEW.md` e `review.json`

## 7. Priorização

| ID | Prioridade | Justificativa |
|----|------------|---------------|
| RF-01 | P0 | Valor central — divide fala por clique |
| RF-02 | P0 | UX — não cortar palavras |
| RF-03 | P0 | Timeline legível para LLM |
| RF-04 | P0 | Correlação fala-elemento |
| RF-05 | P0 | Evita duplicação com OpenAI Realtime |

## 8. Impacto técnico

| Área | Mudança provável |
|------|------------------|
| Timeline | `TranscriptAssembler` em `CorrelationEngine.ts` — flush, word boundary, reconcile |
| Sessão | `SessionManager.handleBrowserEvent` — hook de CLICK |
| REVIEW.md / review.json | Múltiplas observações intercaladas (formato inalterado) |
| Testes | `CorrelationEngine.test.ts`, `SessionCompiler.test.ts` |

## 9. Plano de testes (shift-left)

| RF | Camada | Cenário |
|----|--------|---------|
| RF-02 | unit | `splitAtWordBoundary` — palavra incompleta vs completa |
| RF-01/05 | unit | Multi-flush + finalize sem duplicação |
| RF-03 | unit | SessionCompiler com 3 observações + cliques intercalados |
| RF-04 | unit | Bloco pós-clique com `scope=ELEMENT` HIGH |

## 10. Riscos e decisões pendentes

- [x] Trigger: somente CLICK (confirmado pelo usuário)
- [ ] Pause com fala ativa: flush opcional (P1, fora desta entrega)
- [ ] Offline fallback: bloco único (fora do P0)

## 11. Handoff para implementação

Próximo playbook: `playbook-feature.md`  
Pré-requisitos: RFs P0 aprovados, testes planejados.
