# Voice UI Review Recorder

Ferramenta local para revisão de aplicações web com navegação real, comentários por voz e timeline semântica exportável para LLMs.

[![CI](https://github.com/Borges360/review-recorder/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/Borges360/review-recorder/actions/workflows/ci.yml)

## Requisitos

- Node.js >= 24
- Chromium (instalado via Playwright)
- Microfone
- Chave da OpenAI (`OPENAI_API_KEY`)

## Instalação

```bash
npm install
npx playwright install chromium
cp .env.example .env
# Edite .env com sua OPENAI_API_KEY
```

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
