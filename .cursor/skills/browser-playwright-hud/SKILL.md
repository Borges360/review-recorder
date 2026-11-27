---
name: browser-playwright-hud
description: HUD in-page, screenshots, captura Playwright e testes E2E do browser no review-recorder.
---

# Browser Playwright HUD

## Quando usar

- Modificar HUD injetado na página sob revisão.
- Corrigir captura de cliques, navegação ou screenshots.
- Estabilizar ou criar testes E2E do recorder.

## Onde editar

| Mudança | Caminho |
|---------|---------|
| Launch/context Playwright | `server/src/browser/` |
| HUD script | `server/src/browser/` (in-page injection) |
| Screenshots | browser module + `evidence/` path |
| Eventos de interação | `shared/events.ts` + browser handlers |
| E2E specs | `server/test/e2e/` |
| Demo app | `fixtures/` |

## Validação

```bash
npm run test:e2e --workspace=server
npm test --workspace=server   # se alterou ScreenStateEngine
```

## Checklist

- [ ] Eventos aparecem em `events.jsonl`
- [ ] Screenshots em `evidence/` com nome rastreável
- [ ] HUD não quebra demo-app
- [ ] `recorder-flow.spec.ts` passa

Rules: `30-playwright-browser`
Agent: `browser-automation`
