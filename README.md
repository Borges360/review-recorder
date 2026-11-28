# Voice UI Review Recorder

Ferramenta local para revisão de aplicações web com navegação real, comentários por voz e timeline semântica exportável para LLMs.

[![CI](https://github.com/Borges360/review-recorder/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/Borges360/review-recorder/actions/workflows/ci.yml)

## Requisitos

- Node.js >= 24
- Chromium (instalado via Playwright)
- Microfone
- Chave da OpenAI (`OPENAI_API_KEY`); necessária para o Realtime

## Instalação

```bash
npm install
npx playwright install chromium
cp .env.example .env
# Edite .env: OPENAI_API_KEY e TRANSCRIPTION_PROVIDER=openai (ou openrouter + OPENROUTER_API_KEY)
```

### Provedor de transcrição

`TRANSCRIPTION_PROVIDER` é obrigatório e não tem padrão. Ele escolhe o provedor da
transcrição HTTP (chunks da extensão, fallback offline ao parar e `recover-transcript`):

| Valor | Chave usada | Endpoint e modelo |
|-------|-------------|-------------------|
| `openai` | só `OPENAI_API_KEY` | `https://api.openai.com/v1`, `gpt-4o-transcribe` |
| `openrouter` | só `OPENROUTER_API_KEY` | `OPENROUTER_TRANSCRIPTION_BASE_URL` ou `OPENROUTER_BASE_URL` (padrão `https://openrouter.ai/api/v1`, só HTTPS), `OPENROUTER_TRANSCRIPTION_MODEL` (padrão `openai/gpt-4o-transcribe`) |

- **Sem fallback.** Seletor ausente ou inválido, chave do provedor escolhido ausente ou
  URL sem HTTPS deixam a transcrição HTTP indisponível com erro nomeado
  (`transcription_config_error: ...`). O servidor sobe mesmo assim; o erro aparece no log
  de boot, em `GET /config` (`transcriptionError`) e em cada chunk. A chave de um provedor
  nunca é usada pelo outro, e um erro nunca troca de provedor.
- **Cota OpenRouter.** HTTP 402 sem `Retry-After`, ou 403 com `error.metadata.limit_source`
  em `openrouter_key_limit`, `openrouter_guardrail_budget` ou `openrouter_workspace_budget`,
  vira `openrouter_quota_exhausted: cota OpenRouter esgotada`. É terminal: sem retry, sem
  troca de provedor, e a sessão não chama mais o OpenRouter até terminar.
- **Roteamento fixo.** As chamadas ao OpenRouter enviam `provider: {"allow_fallbacks": false}`
  (campo multipart aceito pelo endpoint `/audio/transcriptions`).
- **Exceção: Realtime fica sempre na OpenAI.** A transcrição ao vivo (WebSocket Realtime,
  modo Playwright) usa `OPENAI_API_KEY` independentemente do seletor e fica fora do teto
  mensal do OpenRouter.

Provedor e modelo por tarefa, custo estimado e orçamento mensal também podem ser
escolhidos no painel **Provedores de IA e custos** (`/admin/llm` na Control UI). Chaves
das três plataformas (`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`) entram
só por ambiente. Passo a passo em [`docs/llm-providers.md`](docs/llm-providers.md).

## Desenvolvimento

```bash
# Terminal 1 — backend
npm run dev:server

# Terminal 2 — Control UI
npm run dev:ui
```

Abra `http://127.0.0.1:5179` no seu browser padrão.

## Uso

1. Informe nome da sessão e URL inicial
2. Clique **Iniciar sessão**
3. Navegue no browser aberto pelo Playwright
4. Fale comentários; use **Screenshot** quando necessário
5. **Pause** / **Resume** conforme necessário
6. **Finalizar** para gerar `REVIEW.md` e `review.json`

O HUD flutuante no browser revisado oferece controles sem trocar de janela.

## Saída

```
sessions/YYYY-MM-DD_HH-mm-ss__nome-da-sessao/
├── REVIEW.md
├── review.json
├── evidence/
└── raw/
    ├── events.jsonl
    ├── transcript.jsonl
    └── audio.wav
```

## Recompilar sessão

```bash
npm run compile -- <sessionId>
```

## Testes

```bash
npm test          # unitários (Vitest) — inclui AC-001 a AC-040
npm run test:e2e  # e2e (Playwright) — inclui fluxo completo com transcriber falso
npm run lint      # ESLint
```

Validação manual do roteiro da seção 60: ver [docs/MVP_VALIDATION.md](docs/MVP_VALIDATION.md).

## Contribuindo

- [CONTRIBUTING.md](CONTRIBUTING.md) — fluxo de contribuição
- [docs/GITFLOW.md](docs/GITFLOW.md) — Git Flow (`main`, `develop`, `feature/*`, `release/*`, `hotfix/*`)
- [AGENTS.md](AGENTS.md) — guia para agentes de IA (Cursor, Claude, Codex, etc.)

Branches de feature partem de `develop`. Setup do Git Flow:

```powershell
.\scripts\setup-git-flow.ps1
```

## API

```
GET  /sessions/:id/timeline   — timeline semântica compilada
POST /sessions/:id/finalize     — compilar sessão RECOVERABLE
```
