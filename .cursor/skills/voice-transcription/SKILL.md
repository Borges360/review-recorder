---
name: voice-transcription
description: Pipeline de transcrição de voz, OpenAI Realtime, FakeTranscriber e correlação fala-tela.
---

# Voice Transcription

## Quando usar

- Modificar transcrição (OpenAI, fake, offline).
- Debugar correlação fala ↔ tela/elemento.
- Validar pause/resume de áudio e trace chunks.

## Onde editar

| Mudança | Caminho |
|---------|---------|
| Transcriber interface | `server/src/voice/` |
| OpenAI Realtime | `server/src/voice/` |
| FakeTranscriber (testes) | `server/src/voice/` |
| Correlação | `server/src/timeline/CorrelationEngine.ts` |
| Config | `server/src/shared/config.ts`, `.env.example` |

## Modos

- **Produção:** `OPENAI_API_KEY` no `.env`
- **Testes:** `FakeTranscriber` — nunca exigir API key em CI

## Validação

```bash
npm test --workspace=server
# CorrelationEngine.test.ts, acceptance.test.ts (voz/correlação)
```

## Escopos

- `SCREEN` — comentário sem clique (tela inteira)
- `ELEMENT` — após interação (`associationConfidence`)

Rules: `50-voice-transcription`, `40-session-timeline`
Playbooks: `playbook-session-debug`
