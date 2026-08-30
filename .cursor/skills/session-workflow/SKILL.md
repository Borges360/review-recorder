---
name: session-workflow
description: Trabalha com sessões de revisão, timeline semântica, transcrição e export REVIEW.md/review.json. Use ao debugar sessões, recompilar output, ou modificar SessionCompiler, TimelineReducer ou exporters.
---

# Session workflow

Playbook dedicado: `.cursor/playbooks/playbook-session-debug.md`
Agent: `session-engineer` | Rule: `40-session-timeline`

## Artefatos de sessão

```
sessions/<sessionId>/
├── session.json
├── REVIEW.md
├── review.json
├── evidence/
└── raw/
    ├── events.jsonl
    ├── transcript.jsonl
    └── audio.wav
```

`sessions/` é gitignored — nunca commitar.

## Recompilar

```bash
npm run compile -- <sessionId>
```

## Componentes

| Componente | Responsabilidade |
|------------|------------------|
| `SessionManager` | start/pause/stop/finalize |
| `EventStore` | append JSONL de eventos |
| `TimelineReducer` | eventos → timeline semântica |
| `CorrelationEngine` | fala ↔ tela/elemento |
| `SessionCompiler` | orquestra export |
| `MarkdownExporter` | gera REVIEW.md |
| `JsonExporter` | gera review.json |

## Status RECOVERABLE

Sessões interrompidas ficam `RECOVERABLE`. Finalize via API `POST /sessions/:id/finalize` ou CLI compile.

## Testes

- Unit: `server/src/timeline/`, `server/src/export/`
- E2E: fluxo completo com `FakeTranscriber`
