# Validação do MVP — Seção 60

Roteiro de sucesso do MVP conforme especificação. Cada passo indica como é validado no projeto.

| # | Passo | Validação |
|---|-------|-----------|
| 1 | Abrir ferramenta | Control UI em `http://127.0.0.1:5179` |
| 2 | Digitar "Gerar contrato" | Campo nome na tela inicial |
| 3 | Start | `POST /sessions/:id/start` — browser abre com HUD |
| 4 | Navegar por cinco páginas | Demo-app `/demo/` com 5 páginas linkadas |
| 5 | Abrir modal | `/demo/wizard.html` |
| 6 | Navegar 10 etapas do wizard | `?step=1` … `?step=10` na mesma URL |
| 7 | Comentários por voz | OpenAI Realtime (`gpt-live-transcribe`) ou `USE_FAKE_TRANSCRIBER` |
| 8 | Comentários sem clicar | `CorrelationEngine` → `scope=SCREEN` |
| 9 | Comentários após clicar | `scope=ELEMENT` com `associationConfidence`; fala contínua segmentada por CLICK (`TranscriptAssembler.flushAtClick`) |
| 10 | Identificar problema visual | Botão Screenshot na Control UI ou HUD |
| 11 | Screenshot durante fala | `pendingEvidence` + `speechSegmentId` |
| 12 | Pause | `SESSION_PAUSED`, áudio para, trace chunk (diagnóstico) |
| 13 | Esperar alguns minutos | `wallElapsed` > `activeElapsed` |
| 14 | Resume | `SESSION_RESUMED`, trace chunk reinicia |
| 15 | Continuar jornada | Eventos retomam no JSONL |
| 16 | Stop | `SESSION_STOPPED` → compilação automática |
| 17 | Abrir REVIEW.md | `sessions/YYYY-MM-DD_HH-mm-ss__slug/REVIEW.md` |
| 18 | Entregar para LLM | `REVIEW.md` + `evidence/` + `review.json` |
| 19 | LLM responde contexto | Timeline com screen, speech, evidence, actions |
| 20 | LLM gera plano sem vídeo | Preambulo em REVIEW.md orienta o agente |

## Execução automatizada

```bash
npm test                    # AC-001 a AC-040 (acceptance.test.ts)
npm run test:e2e            # API + demo + recorder-flow completo
```

O teste `recorder-flow.spec.ts` cobre programaticamente os passos 3–16 com transcriber falso e browser mock.

## Execução manual recomendada

1. Configure `.env` com `OPENAI_API_KEY`
2. `npm run dev:server` + `npm run dev:ui`
3. Execute o roteiro acima na demo-app
4. Entregue o `REVIEW.md` gerado a uma LLM e verifique se ela identifica:
   - Página e estado no momento do comentário
   - Texto transcrito
   - Elementos candidatos (quando aplicável)
   - Screenshots em `evidence/`
   - Sequência de ações até o problema

## Sessões recuperáveis

Após crash do processo, sessões em `RECORDING`/`PAUSED` viram `RECOVERABLE`. Na tela inicial, use **Compilar e finalizar** para gerar artefatos a partir do `events.jsonl` persistido.
