# Playbook Session Debug — review-recorder

Diagnosticar e corrigir problemas em sessões de gravação, timeline e export.

```markdown
Use o playbook SESSION-DEBUG do review-recorder.
SessionId: [id ou caminho].
Sintoma: [timeline incompleta, RECOVERABLE, REVIEW.md errado, etc.].
```

## Regras base

- `40-session-timeline`, `50-voice-transcription`
- Agent `session-engineer` | Skill `session-workflow`

---

## 1) Checklist de diagnóstico

### Artefatos

```
sessions/<sessionId>/
├── session.json          # status, timestamps
├── REVIEW.md             # output para LLM
├── review.json
├── evidence/
└── raw/
    ├── events.jsonl      # eventos brutos
    ├── transcript.jsonl  # fala
    └── audio.wav
```

### Status da sessão

| Status | Ação |
| --- | --- |
| `RECOVERABLE` | `POST /sessions/:id/finalize` ou `npm run compile -- <id>` |
| `RECORDING`/`PAUSED` travado | Verificar processo server; pode virar RECOVERABLE |
| `COMPLETED` sem REVIEW.md | Recompilar com `npm run compile` |
| `FAILED` | Inspecionar logs + events.jsonl |

### Timeline

1. Eventos em `events.jsonl` cobrem a jornada?
2. Transcript em `transcript.jsonl` alinhado temporalmente?
3. `CorrelationEngine` associou fala a SCREEN vs ELEMENT?
4. Screenshots em `evidence/` referenciados no export?

---

## 2) Recompilar

```bash
npm run compile -- <sessionId>
```

Comparar `REVIEW.md` antes/depois.

---

## 3) Se bug confirmado

Seguir `playbook-bug.md` com evidência da sessão.

---

## 4) Validação MVP

Cruzar com passos 1–20 em [MVP_VALIDATION.md](../../docs/MVP_VALIDATION.md).
