# Playbook Feature — review-recorder

Implementar capacidade nova com reuso, testes por camada e docs rastreáveis.

```markdown
Use o playbook FEATURE do review-recorder.
Objetivo: [1 frase].
Módulo: [ex. timeline, browser, voice, ui].
Prioridade: P0.
```

## Regras base

- Rules `00`–`09`, `project-standards`
- Rules de contexto conforme módulo (`10`–`60`)

---

## 1) Pré-requisitos

1. Comportamento esperado claro em AGENTS.md, MVP_VALIDATION.md ou discovery em `docs/discovery/`.
2. Testes planejados antes do código (unit e/ou e2e).
3. Se escopo > 2 módulos sem spec: **parar** → `playbook-discovery.md`.

---

## 2) Fluxo de implementação

### Passo A — Contextualizar

1. Ler AGENTS.md e MVP_VALIDATION.md.
2. Mapear arquivos existentes (routes, session, browser, timeline, ui).
3. Confirmar domínio (Sessão / Browser / Timeline / Voz / Export / UI).

### Passo B — Inventário de reuso

| Camada | Onde buscar |
| --- | --- |
| Server | `server/src/` por domínio |
| Browser | `server/src/browser/` |
| UI | `ui/src/` |
| Testes | `server/test/unit/`, `server/test/e2e/` |
| Tipos/eventos | `shared/types.ts`, `shared/events.ts` |

### Passo C — Contrato

1. Tipos em `shared/types.ts` se novo dado de domínio.
2. Eventos em `shared/events.ts` se nova interação na timeline.
3. Rotas em `routes.ts` + `api.ts` na UI.

### Passo D — Implementar

1. Lógica no módulo correto (não duplicar em route e browser).
2. Testes unit para regras; e2e se nova jornada completa.
3. `FakeTranscriber` em testes — sem API key.

### Passo E — Documentar e validar

1. Atualizar AGENTS.md ou MVP_VALIDATION se comportamento visível mudou.
2. Rodar `npm test`, `npm run lint`, `npm run test:e2e` conforme impacto.

---

## 3) Reporte

Incluir bloco "Instruções consideradas" + comandos pass/fail.
