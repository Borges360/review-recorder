# Discovery — Extensão Chrome com API no homelab

**Data:** 2026-10-06  
**Status:** aprovado (defaults D1–D7 adotados na implementação)  
**Domínio(s):** Browser | Sessão | Voz | Timeline | Export | UI | Deploy

## 1. Contexto e objetivo

O review-recorder grava uma revisão falada de uma aplicação web e entrega `REVIEW.md` + `review.json` para uma LLM. A captura hoje acontece num Chromium separado, aberto pelo Playwright, com microfone na Control UI local (`http://127.0.0.1:5179`).

O objetivo desta descoberta é um produto em duas peças:

1. **Extensão Chrome (Manifest V3)** que grava no Chrome em que o revisor já está logado: voz, transcrição, ações, componentes clicáveis e screenshot.
2. **API no homelab**, no mesmo desenho do interview: Deployment no K3s, Ingress `*.lab`, hostname público no túnel Cloudflare, bucket no MinIO que já existe, histórico consultável numa tela, e espaço para crescer sem reescrever a extensão.

Critério de pronto do P0: uma revisão feita só com a extensão, contra a API pública, gera os mesmos artefatos semânticos do MVP (timeline com tela, fala, elemento e evidência) e o histórico abre no browser.

## 2. Veredito

A solução é viável e é o encaixe certo para o uso real (revisar o site já autenticado). A extensão substitui o browser Playwright e a Control UI de captura. O servidor Fastify continua dono de sessão, transcrição, correlação, compilação e histórico.

Três limites são estruturais e entram no desenho:

- O service worker do Manifest V3 não segura microfone nem `AudioContext`. O áudio mora num documento offscreen, depois que o usuário concede o microfone numa aba da extensão.
- `chrome.tabs.captureVisibleTab` fotografa o viewport visível da janela ativa. Não existe screenshot de página inteira nem de `chrome://`.
- O snapshot ARIA do Playwright (`page.locator('body').ariaSnapshot()`) não existe na extensão. O equivalente é um inventário dos elementos interativos, coletado pelo content script.

O modo local com Playwright permanece para testes e para a demo. A extensão é o caminho de uso.

## 3. JTBD / Persona

- **Quando** estou logado na aplicação que vou revisar, **quero** ligar a gravação no Chrome, falar e clicar, **para** gerar uma timeline semântica com voz, elemento e print, sem abrir outro browser nem repetir login.
- **Quando** a revisão terminou, **quero** abrir um histórico na URL do homelab, **para** reler a sessão, baixar `REVIEW.md` / `review.json` e evoluir a API sem reinstalar a extensão a cada função nova de consulta.

Persona desta entrega: um único revisor (você), com token da API. Multiusuário fica fora.

## 4. Referências de mercado

O que essas ferramentas validam, e o que este produto continua fazendo de diferente.

| Produto | O que a extensão faz | O que não copiamos no P0 |
|---------|----------------------|--------------------------|
| [Scribe](https://support.scribehow.com/hc/en-us/articles/13546388647453-How-to-capture-a-Scribe-using-the-extension) | Captura no Chrome/Edge com permissão em todos os sites. Cada clique vira passo com screenshot. Painel lateral (Sidekick) mostra os passos ao vivo. Transcrição de voz entra no passo correspondente. | Guia passo a passo editável, autocapture em background, app desktop. |
| [Jam](https://jam.dev/docs/creating-a-jam) | Screenshot, vídeo ou instant replay, com console, rede, ações e metadados. Link compartilhável e envio a Linear/Jira/agentes. | Vídeo da aba, replay dos últimos 2 minutos, integração com tracker. |
| [Marker.io](https://marker.io/qa-tool) | Extensão ou widget na página. Screenshot anotado, console, rede, viewport, replay curto anexado ao ticket. | Anotação desenhada no print, widget embutido no site do cliente, formulário de ticket. |

Padrão que se repete e que adotamos:

- Controles no **painel lateral**, com a página revisada limpa.
- Permissão de site ampla enquanto grava; sem isso a jornada que muda de domínio perde cliques (o próprio Scribe documenta esse requisito).
- Contexto técnico no momento do clique (URL, seletor, nome acessível, bounds), não um vídeo como fonte da verdade.
- Histórico e leitura ficam numa **página web**, a extensão só captura e mostra o ao vivo.

Diferença que permanece o produto: a saída é timeline semântica para LLM (`REVIEW.md` + `review.json`), com fala correlacionada a tela ou elemento (`scope=SCREEN|ELEMENT`). Jam e Marker otimizam ticket. Scribe otimiza tutorial. Nenhum dos três é o contrato deste repositório.

Descartados como núcleo:

- **rrweb / session replay completo.** Grava DOM demais, pesa privacidade e não melhora o `REVIEW.md`.
- **Vídeo da aba** (`tabCapture`). Útil depois; o MVP já prova valor com print pontual.
- **Extensão sem backend.** Manifest V3 não roda transcrição, MinIO nem histórico durável.

## 5. Validação das APIs do Chrome

Fontes: [Offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen), [gravação de áudio](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture), discussão de permissão de microfone em MV3.

| Capacidade | API | Viável | Condição |
|------------|-----|--------|----------|
| Microfone contínuo entre navegações | `chrome.offscreen` com reason `USER_MEDIA` + `getUserMedia` | Sim | A permissão precisa ser concedida antes numa aba `chrome-extension://` (`permissions.request`). Offscreen, popup e side panel não mostram o prompt. |
| Painel de controle e transcrição ao vivo | `chrome.sidePanel` | Sim | O painel pode usar o microfone depois que a aba já concedeu. Se o painel fechar, o offscreen continua gravando. |
| Clique, tecla, submit, identidade do elemento | Content script, isolated world, `all_frames: true` | Sim | Reusa a lógica de `getElementIdentity` em `server/src/browser/inpage/scripts.ts`. Shadow root fechado fica invisível. |
| Navegação SPA | `chrome.webNavigation` (`onHistoryStateUpdated`, `onCompleted`) | Sim | Evita patch de `history.pushState` na página. O patch atual só existe porque o Playwright injeta no mundo da página. |
| Inventário de clicáveis | Content script: `button, a, input, select, textarea, [role=button], [role=link], [role=tab], [role=menuitem]` | Sim | Teto (150) + debounce. Substitui o ARIA snapshot. |
| Screenshot do viewport | `chrome.tabs.captureVisibleTab` no service worker | Sim | Exige host permission do site. Só a aba visível da janela atual. Formato PNG. |
| Upload para a API | `fetch` do service worker com `host_permissions` | Sim | Extensão com permissão de host não depende de CORS. |
| Fila se o túnel cair | IndexedDB no service worker | Sim | Evento, chunk de áudio e print saem com `clientId` idempotente. |
| Configuração da API | `chrome.storage.local` + página de opções | Sim | `apiBaseUrl` + `apiToken`. Default sugerido: a URL pública; em casa, `http://review.lab`. |

Permissões do manifesto (P0):

```json
{
  "manifest_version": 3,
  "permissions": ["sidePanel", "offscreen", "storage", "tabs", "scripting", "webNavigation", "activeTab"],
  "host_permissions": ["<all_urls>", "https://review.luizfelipeborges.dev/*", "http://review.lab/*"],
  "optional_host_permissions": []
}
```

`<all_urls>` é o custo de gravar uma jornada que atravessa domínios, o mesmo requisito que o Scribe declara. A gravação só liga com gesto do usuário (botão no painel). Não há autocapture.

## 6. Escopo

### Dentro

- RF-01: Configurar URL e token da API
- RF-02: Ciclo da sessão (criar, gravar, pausar, retomar, parar) sem Playwright
- RF-03: Gravar voz e enviar chunks
- RF-04: Transcrever no backend e devolver texto com tempo
- RF-05: Guardar ações (clique, input, submit, tecla relevante, navegação)
- RF-06: Identificar o componente clicado e o inventário de clicáveis da tela
- RF-07: Screenshot manual do viewport, correlacionado à fala quando houver
- RF-08: Compilar `REVIEW.md` e `review.json`
- RF-09: Tela de histórico (lista, detalhe, timeline, evidência, download)
- RF-10: Bucket no MinIO existente e deploy K3s + Cloudflare
- RF-11: Auth por bearer token
- RF-12: Fila local e retomada de upload
- RF-13: Redação de campo sensível

### Fora

- Publicar na Chrome Web Store (carregamento em modo desenvolvedor)
- Firefox, Edge como alvo (o manifesto MV3 serve no Edge depois, sem compromisso agora)
- Multiusuário, convite, papéis
- Vídeo da aba, anotação desenhada, console, rede, rrweb
- Widget in-page e HUD injetado na aplicação revisada
- Autocapture em background
- Screenshot de página inteira
- Integração Linear/Jira/Slack
- Segundo MinIO, ou upload direto do browser para o MinIO
- Remover o modo Playwright local
- Transcrição em tempo real palavra a palavra no caminho público (ver decisão D1)
- Cloudflare Access na frente do hostname (endurecimento opcional, D2)

## 7. Gap atual (com evidências)

| RF | Status | Evidência |
|----|--------|-----------|
| RF-01 URL/token | Falta | UI fala só com o host da página (`ui/src/api.ts`, `audioWsUrl`) |
| RF-02 ciclo sem Playwright | Parcial | Estados em `SessionState.ts` e rotas em `server/src/app/routes.ts`. `SessionManager.start` chama `browser.launch` (`SessionManager.ts`) |
| RF-03 voz | Parcial | `ui/src/audio/AudioCapture.ts` captura PCM no gesto e envia WebSocket ao processo local. Não há chunk HTTP nem offscreen |
| RF-04 transcrição | Parcial | Realtime em `OpenAITranscriber.ts` (partial ao vivo). Offline em `OfflineTranscriber.ts` (`gpt-4o-transcribe`, sem timestamp de segmento) |
| RF-05 ações | Já feito no Playwright | Agente in-page em `server/src/browser/inpage/scripts.ts`; tipos em `server/src/shared/events.ts` |
| RF-06 clicáveis | Parcial | Identidade do alvo no clique (`getElementIdentity`). Inventário da tela é ARIA via Playwright (`ScreenStateEngine.ts` → `AriaSnapshotService`) |
| RF-07 screenshot | Parcial | `ScreenshotService.ts` usa `page.screenshot`. Botão na Control UI e no HUD |
| RF-08 export | Já feito | `SessionCompiler`, `MarkdownExporter`, `JsonExporter`. Artefato em disco `sessions/` |
| RF-09 histórico | Parcial | `GET /sessions` e `ui/src/SessionDetailPage.tsx` só enxergam o processo local e o filesystem |
| RF-10 homelab | Falta neste repo | Padrão pronto no jenkies: `infra/k3s/dev/interview.yaml`, `minio.yaml` (`mc mb`), `platform/cloudflared.yaml`, `pipelines/deploy-interview-dev.Jenkinsfile` |
| RF-11 auth | Falta | Rotas sem autenticação (`routes.ts`) |
| RF-12 fila | Falta | Áudio e eventos dependem do WebSocket local aberto |
| RF-13 redação | Já feito | `server/src/shared/redaction.ts` e ramo sensível em `getElementIdentity` |

## 8. Arquitetura alvo

```text
Chrome do revisor
  side panel     controles, transcrição recente, link do histórico
  options        apiBaseUrl + apiToken
  content script clique, input, submit, inventário de clicáveis
  service worker sessão, fila IndexedDB, captureVisibleTab, webNavigation
  offscreen      getUserMedia, chunks de áudio
        │  HTTPS + bearer
        ▼
review.luizfelipeborges.dev   (túnel Cloudflare → Service review-recorder.dev:3000)
review.lab                    (Ingress Traefik, mesma API, uso na LAN)
        │
        ├── PostgreSQL (db01, database novo)   sessão, evento, tela, segmento, evidência
        ├── MinIO existente, bucket review-recorder
        │     audio/, evidence/, exports/
        └── OpenAI  gpt-4o-transcribe (chunk) a partir do pod
```

A página de histórico é servida pelo mesmo host (`/`). Função nova de consulta nasce nessa página e na API. A extensão só muda quando a captura muda.

### Por que o áudio vai em chunk, e não no Realtime atual

O caminho atual depende de partials do Realtime para cortar a fala no clique (`TranscriptAssembler.flushAtClick`). Atravessar o túnel Cloudflare com WebSocket de PCM deixa esse corte instável: o partial chega depois do clique.

Desenho P0:

1. A extensão marca cada clique com `activeElapsedMs` do relógio da sessão (reuso de `SessionClock`).
2. O offscreen corta o áudio em chunks de cerca de 5 s (WebM/Opus; a API da OpenAI aceita WebM).
3. O backend transcreve o chunk e desloca os tempos do segmento pelo `chunkStartMs`.
4. `CorrelationEngine` associa o segmento ao clique cujo tempo cai imediatamente antes (regras atuais de `scope` e `associationConfidence`).

O corte na fronteira da palavra, no instante exato do clique, fica mais grosso: a unidade passa a ser o segmento devolvido pela API, não o partial ao vivo. Isso é aceitável para o `REVIEW.md`. Tempo real palavra a palavra fica como melhoria quando `apiBaseUrl` for `http://review.lab` (D1).

### MinIO

Um MinIO só, o de `infra/k3s/dev/minio.yaml`. Bucket novo `review-recorder`, criado com `mc mb --ignore-existing` no mesmo Job `minio-init` (hoje ele só cria `interview-assets`).

O upload entra pela API. O pod grava no MinIO em `http://minio:9000` (o Deployment ganha o mesmo `hostAlias` `minio.lab` → `192.168.15.252` que o interview). A origem `chrome-extension://` não entra em `MINIO_API_CORS_ALLOW_ORIGIN`: esse CORS é do servidor inteiro e hoje lista só o interview. Presigned PUT a partir da extensão quebraria o interview ou exigiria liberar qualquer origem.

Objetos:

```text
review-recorder/<sessionId>/audio/<chunkId>.webm
review-recorder/<sessionId>/evidence/<shotId>.png
review-recorder/<sessionId>/exports/REVIEW.md
review-recorder/<sessionId>/exports/review.json
```

Metadado e JSONL lógico ficam no Postgres, para a tela de histórico filtrar sem varrer objeto. O compilador continua emitindo o mesmo `REVIEW.md` / `review.json`; o arquivo deixa de ser a fonte e passa a ser cópia no bucket. `EvidenceRecord.file` guarda a chave do objeto.

### Postgres

Service `postgres.data` já aponta para o db01 (`infra/k3s/data/databases.yaml`). Database novo `review_recorder`, usuário da app no secret `review-recorder-app` (fora do Git, aplicado por `infra/bin/k3s-apply.ps1`, como `interview-app`).

Tabelas mínimas espelham os tipos em `server/src/shared/types.ts`: `sessions`, `events`, `screen_states`, `transcript_segments`, `evidence`. `EventStore` ganha implementação Postgres ao lado da JSONL. A JSONL local continua no modo Playwright de desenvolvimento.

### Kubernetes e Cloudflare

Manifesto novo `jenkies/infra/k3s/dev/review-recorder.yaml`, copiando a forma de `interview.yaml`:

- Namespace `dev`
- Deployment `review-recorder`, porta 3000, probes em `GET /health` (a rota já existe)
- `envFrom` secret `review-recorder-app`
- `resources` na faixa do interview (request 50m/192Mi, limit 512Mi; transcrição segura o pico)
- Service + Ingress `review.lab` class `traefik`
- `replicas: 0` até a esteira gravar a imagem (`registry.platform.svc.cluster.local:5000/review-recorder`)
- Argo CD já sincroniza `infra/k3s/dev` e ignora imagem e réplicas

Hostname público, no túnel que já roda (`platform/cloudflared.yaml`):

```text
review.luizfelipeborges.dev → review-recorder.dev.svc:3000
```

Esse mapa não está no Git. Os outros (`interview.luizfelipeborges.dev`, `minio.luizfelipeborges.dev`) estão só no comentário do manifesto e na conta Cloudflare. Passo operacional: criar o hostname público no túnel e atualizar o comentário de `cloudflared.yaml`.

Esteira nova `jenkies/pipelines/deploy-review-recorder-dev.Jenkinsfile`, no molde de `deploy-interview-dev.Jenkinsfile`: checkout do repo `review-recorder`, teste, buildkit para o registry interno, `kubectl set image` / scale. O código da aplicação não mora no repo jenkies.

Secret (não commitar): `OPENAI_API_KEY`, `DATABASE_URL`, `S3_ENDPOINT=http://minio:9000`, `S3_BUCKET=review-recorder`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `API_TOKEN`.

### Auth

Toda rota exceto `GET /health` exige `Authorization: Bearer <API_TOKEN>`. A extensão guarda o token em `chrome.storage.local`. A tela de histórico pede o mesmo token uma vez e guarda em `sessionStorage`.

API aberta no hostname público publicaria voz e print de qualquer site revisado para quem descobrisse a URL.

### Extensão — módulos

Pacote novo `extension/` no monorepo review-recorder. TypeScript, build único (Vite ou esbuild), sem React obrigatório no painel se a página de histórico já for a UI rica. O painel pode ser HTML pequeno.

| Módulo | Responsabilidade |
|--------|------------------|
| `manifest.json` | MV3, permissões da seção 5 |
| `options` | URL e token, teste `GET /health` |
| `sidepanel` | nome da sessão, start/pause/resume/stop, screenshot, últimas linhas, abrir histórico |
| `offscreen` | microfone e chunks |
| `content` | eventos e inventário; portado de `INPAGE_AGENT_SOURCE` |
| `background` | estado, fila, navegação, screenshot, retry com backoff |
| `api-client` | REST tipado, `clientId` em todo POST |

Contrato de ingestão (além das rotas que já existem):

| Método | Uso |
|--------|-----|
| `POST /sessions` | já existe; passa a exigir bearer |
| `POST /sessions/:id/start\|pause\|resume\|stop` | já existe; `start` deixa de abrir browser quando `capture=extension` |
| `POST /sessions/:id/events` | lote de eventos do content script |
| `POST /sessions/:id/audio` | multipart do chunk + `chunkStartMs` + `clientId` |
| `POST /sessions/:id/screenshot` | passa a aceitar PNG no body quando a captura é da extensão |
| `GET /sessions/:id/timeline` | já existe |
| `GET /sessions/:id/export` | já existe; lê do bucket |
| `GET /sessions/:id/evidence/:evidenceId` | stream do PNG |

`clientId` repetido devolve o mesmo resultado (túnel instável, retry da fila).

### Relógio e pausa

O relógio ativo fica na extensão (`activeElapsedMs` para de contar na pausa, como `SessionClock` e o passo 12–14 do MVP). O backend confia no tempo enviado pelo cliente e persiste. Pause corta o microfone e fecha o chunk aberto.

## 9. Requisitos funcionais

### RF-01 — API configurável

- **Given** a página de opções sem URL salva
- **When** informo `https://review.luizfelipeborges.dev` e o token e salvo
- **Then** `GET /health` com bearer retorna ok e o valor fica em `chrome.storage.local`
- **Given** estou na LAN
- **When** troco a URL para `http://review.lab`
- **Then** as chamadas seguintes usam o host novo sem reinstalar a extensão

### RF-02 — Sessão no Chrome atual

- **Given** URL e token válidos e um site aberto
- **When** inicio a sessão pelo painel
- **Then** a API cria a sessão em `RECORDING`, nenhum Chromium Playwright abre, e o content script passa a emitir na aba ativa
- **Given** sessão `RECORDING`
- **When** pauso, espero, retomo e paro
- **Then** os estados seguem `SessionState` (`PAUSED` → `RECORDING` → `STOPPING` → `PROCESSING` → `COMPLETED`) e `activeElapsedMs` não cresce durante a pausa

### RF-03 — Voz

- **Given** microfone ainda não concedido à extensão
- **When** inicio a gravação
- **Then** abre uma aba da extensão que pede o microfone; depois de conceder, o offscreen grava
- **Given** sessão gravando
- **When** passam cerca de 5 s ou eu pauso
- **Then** um chunk WebM sobe com `chunkStartMs` e `clientId`, e some da fila IndexedDB só após HTTP 2xx

### RF-04 — Transcrição

- **Given** um chunk de fala em português
- **When** o backend processa
- **Then** nasce um ou mais `TranscriptSegmentRecord` com `startedAtMs`/`endedAtMs` no relógio da sessão e texto em `raw` equivalente ao `transcript.jsonl`
- **Given** a OpenAI falha
- **When** o chunk já está no MinIO
- **Then** a sessão segue gravando, o chunk fica pendente de retry e o histórico mostra a falha sem perder o áudio (`TRANSCRIPTION_OFFLINE` / recuperação no espírito de `recoverTranscript.ts`)

### RF-05 — Ações

- **Given** sessão gravando
- **When** clico, altero um campo, submeto um form, pressiono Enter/Escape/Tab ou navego (carga ou SPA)
- **Then** a API persiste o evento com os tipos já definidos (`CLICK`, `INPUT_CHANGED`, `FORM_SUBMITTED`, `KEY_ACTION`, `NAVIGATION`) e com `elapsedMs` do cliente

### RF-06 — Componentes clicáveis

- **Given** um clique num botão com `aria-label`
- **When** o evento chega
- **Then** `ElementIdentity` traz tag, role, accessibleName, testId, id, name e bounds, no formato de `server/src/shared/types.ts`
- **Given** a tela mudou (navegação ou DOM estável após debounce)
- **When** o content script inventaria os interativos
- **Then** a API grava um screen state com URL, rota normalizada (`normalizeRoute`), título e a lista de clicáveis (teto 150), e a fala seguinte aponta para esse screen state
- **Given** o alvo é senha ou casa com os padrões de `redaction.ts`
- **When** a identidade é montada
- **Then** nome e valor vão como `[redacted]`

### RF-07 — Screenshot

- **Given** sessão gravando e a aba visível
- **When** aperto screenshot no painel
- **Then** `captureVisibleTab` gera PNG, a API grava no bucket e cria `EvidenceRecord` com `elapsedMs`
- **Given** há fala ativa
- **When** o screenshot ocorre
- **Then** `speechSegmentId` / `pendingEvidence` segue a regra do MVP (passo 11) assim que o segmento daquele intervalo existir

### RF-08 — Export LLM

- **Given** sessão parada com eventos, segmentos e evidências
- **When** o compilador roda (no stop, como hoje)
- **Then** `REVIEW.md` mantém o preâmbulo de `MarkdownExporter.ts` e a timeline ordenada por tempo, e `review.json` mantém o pacote atual, com evidência apontando para a chave no bucket

### RF-09 — Histórico

- **Given** estou autenticado na página do host
- **When** abro `/`
- **Then** vejo a lista de sessões (nome, status, data, duração ativa)
- **Given** uma sessão `COMPLETED`
- **When** abro o detalhe
- **Then** vejo a timeline, o texto, o elemento candidato, o print e os downloads de `REVIEW.md` e `review.json`
- **Given** sessão `RECOVERABLE` (pod reiniciou no meio)
- **When** escolho compilar
- **Then** `POST /sessions/:id/finalize` gera o export a partir do que já está no Postgres e no bucket

### RF-10 — Deploy

- **Given** a esteira dev rodou com sucesso
- **When** consulto o cluster
- **Then** o Deployment `review-recorder` em `dev` está ready, `http://review.lab/health` responde, e `https://review.luizfelipeborges.dev/health` responde pelo túnel
- **Given** o Job `minio-init` rodou
- **When** listo buckets
- **Then** `review-recorder` existe ao lado de `interview-assets`

### RF-11 — Auth

- **Given** pedido sem bearer, ou com token errado
- **When** chamo qualquer rota que não seja `GET /health`
- **Then** a API responde 401 e não grava evento nem objeto

### RF-12 — Fila

- **Given** o túnel está fora durante a gravação
- **When** a rede volta
- **Then** a extensão reenvia eventos, chunks e prints em ordem, e um `clientId` repetido não duplica linha nem objeto

### RF-13 — Redação

- **Given** campo cujo rótulo casa com `isSensitiveField`
- **When** gero identidade ou inventário
- **Then** o payload persistido não contém o valor digitado

## 10. Requisitos não funcionais

- **Robustez do túnel.** Timeout de upload 30 s, retry com backoff, fila em disco do Chrome. A gravação não para porque um POST falhou.
- **Idempotência.** `clientId` único por evento, chunk e screenshot.
- **Privacidade.** Token só em `chrome.storage.local`. Sem autocapture. Redação antes de sair do content script. Áudio e print só no bucket do homelab.
- **Tamanho.** Chunk ~5 s em Opus. Inventário limitado a 150 nós e texto de nome a 120 caracteres (igual ao agente atual). ARIA antigo truncava em 50_000 caracteres; o inventário substitui esse teto.
- **Relógio.** `wallElapsed` e `activeElapsed` continuam distintos (MVP passos 12–14).
- **Idioma.** Código em inglês. Histórico e opções da extensão em português.
- **Extensibilidade.** Consulta nova = rota + página. Captura nova = mensagem do content script + tipo de evento já enumerado em `events.ts`.
- **Segredos.** Nada de `.env`, token ou dump no Git do review-recorder nem do jenkies.

## 11. Priorização

| ID | Prioridade | Justificativa |
|----|------------|---------------|
| RF-11 | P0 | Hostname público sem auth vaza revisão |
| RF-10 | P0 | Sem bucket e rota não há onde gravar |
| RF-01 | P0 | A extensão precisa apontar para o homelab |
| RF-02 | P0 | Ciclo de sessão é o esqueleto |
| RF-05, RF-06, RF-13 | P0 | Ação e componente são o diferencial já specado |
| RF-03, RF-04 | P0 | Voz e transcrição |
| RF-07, RF-08 | P0 | Print e entrega LLM |
| RF-09 | P0 | Tela de histórico pedida |
| RF-12 | P0 | Túnel Cloudflare cai; sem fila a sessão mente |
| Realtime na LAN, vídeo, anotação, console, Access | P1+ | Não bloqueiam o primeiro REVIEW.md vindo da extensão |

## 12. Impacto técnico

| Área | Mudança provável |
|------|------------------|
| Repo review-recorder | Pacote `extension/`. Server ganha bearer, ingestão de lote/áudio/PNG, persistência Postgres + MinIO atrás das interfaces atuais |
| `SessionManager` | `start` com `capture=extension` não chama `BrowserManager.launch` |
| Eventos | Mesmos `EVENT_TYPES`. Origem passa a ser HTTP, não `exposeBinding` |
| Timeline / correlação | `CorrelationEngine` associa por timestamp do chunk. `flushAtClick` continua no modo Realtime local |
| `REVIEW.md` / `review.json` | Mesmo texto e schema. Caminho de evidência vira chave `review-recorder/<sessionId>/...` |
| Testes | Unitários do contrato de ingestão, idempotência, inventário e correlação por tempo, com `FakeTranscriber`. E2E Playwright atual segue verde no modo local |
| jenkies | `review-recorder.yaml`, linha `mc mb` do bucket, Jenkinsfile, comentário do túnel, secret via `k3s-apply` |
| UI local `ui/` | Permanece para o modo Playwright. O histórico novo é a página servida pela API |

### Reuso aplicado no desenho

- Tipos `ElementIdentity`, `SessionRecord`, `ScreenStateRecord`, `TranscriptSegmentRecord`, `EvidenceRecord`, `EventEnvelope`
- Máquina `SessionState`, relógio `SessionClock`
- `CorrelationEngine`, `SessionCompiler`, `MarkdownExporter`, `JsonExporter`
- `redaction.ts` (`isSensitiveField`, `normalizeRoute`)
- `getElementIdentity` do agente in-page
- `FakeTranscriber` e `OfflineTranscriber` (modelo e chunking; timestamps são a extensão)
- `GET /health`, rotas de sessão e export
- Padrão de deploy do interview e o MinIO único

### Duplicação evitada

- Segundo cluster MinIO
- Segundo modelo de evento paralelo ao `events.ts`
- HUD in-page copiado para a extensão (o painel lateral cobre pause, screenshot e stop)
- Histórico reimplementado só dentro da extensão

## 13. Plano de testes (shift-left)

| RF | Camada | Cenário |
|----|--------|---------|
| RF-02, RF-08 | unit | Ciclo extensão → eventos → `SessionCompiler` produz timeline. `FakeTranscriber`. Sem browser |
| RF-04 | unit | Chunk com `chunkStartMs` vira segmento com tempo deslocado. Falha da OpenAI deixa o objeto e marca retry |
| RF-05, RF-06 | unit | Fixture DOM (happy-dom ou jsdom) produz `ElementIdentity` e inventário; campo senha redactado |
| RF-06 | unit | `normalizeRoute` no inventário; teto de 150 |
| RF-07 | unit | PNG anexado durante intervalo de fala recebe `speechSegmentId` |
| RF-11 | unit (API) | Sem bearer → 401; com bearer → 200 |
| RF-12 | unit | Mesmo `clientId` duas vezes → uma linha |
| RF-08 | unit | `MarkdownExporter` segue com preâmbulo; evidência com chave de objeto |
| Modo local | e2e existente | `npm run test:e2e` do recorder Playwright permanece | 
| RF-01, RF-03, RF-09, RF-10 | manual no homelab | Opções salvam URL; fala de ~10 s aparece no histórico; `review.lab` e o hostname público respondem `/health`; bucket existe |

Não usar `OPENAI_API_KEY` na suíte automática.

## 14. Fases de implementação

1. **API e persistência**, ainda sem extensão. Bearer, Postgres, MinIO, ingestão HTTP testada com curl, compilação igual.
2. **Extensão** contra `http://review.lab` ou o server local. Voz, clique, inventário, print, fila.
3. **Histórico** na mesma origem da API.
4. **jenkies:** manifesto, bucket, secret, esteira, hostname no túnel Cloudflare. Aplicar no cluster só com pedido explícito (contrato do `AGENTS.md` do jenkies).

Cada fase segue `playbook-feature.md` depois desta discovery aprovada.

## 15. Riscos e decisões pendentes

- [ ] **D1 — Transcrição.** Recomendado: chunk + `gpt-4o-transcribe` com timestamp de segmento no P0. Realtime só na LAN, em P1. Confirmar se o timestamp de segmento está disponível no modelo; se não estiver, cair para `whisper-1` com `verbose_json` só na transcrição remota. Spike de uma hora antes de fechar o código.
- [ ] **D2 — Borda pública.** Recomendado: bearer token no P0. Cloudflare Access fica opcional. Access protege o browser; a extensão precisaria de service token extra.
- [ ] **D3 — Hostname.** Recomendado: `review.lab` e `review.luizfelipeborges.dev`, no padrão do interview.
- [ ] **D4 — Bucket.** Recomendado: `review-recorder` no MinIO atual, via `mc mb` no Job existente.
- [ ] **D5 — Database.** Recomendado: database `review_recorder` no Postgres do db01. PVC com JSONL perde a lista do histórico quando o pod recria e não consulta bem.
- [ ] **D6 — HUD.** Recomendado: sem HUD in-page. Controles no side panel.
- [ ] **D7 — Permissão de host.** Recomendado: `<all_urls>` enquanto a sessão grava, como o Scribe. Sem isso, troca de domínio fura a timeline.
- [ ] **Risco — fidelidade do corte fala/clique.** Segmento de ~5 s é mais grosso que o flush por palavra. O `REVIEW.md` continua ordenado e correlacionado; a frase pode atravessar um clique se a API não devolver palavra. Aceito no P0 se D1 ficar como está.
- [ ] **Risco — iframe e shadow fechado.** Clique dentro de shadow fechado não tem identidade rica. Iframe de outra origem só reporta o que o content script daquele frame enxerga (`all_frames: true`).
- [ ] **Risco — screenshot.** Aba em segundo plano não é capturada. O painel deve dizer quando o print falhou.
- [ ] **Risco — Job `minio-init`.** Argo ignora `/spec` desse Job. Mudar o script exige coordenar com o ignore em `infra/k3s/argocd/applications.yaml`, senão o bucket novo não nasce.
- [ ] **Risco — túnel manual.** Esquecer o hostname na conta Cloudflare deixa a API só em `review.lab`.

## 16. Handoff para implementação

Próximo playbook: `playbook-feature.md`, fase 1 (API e persistência).

Pré-requisitos: aprovar D1–D7. Sem aprovação, os defaults recomendados acima são a proposta para implementar.

Não implementar extensão nem manifesto Kubernetes nesta discovery.

## 17. Docs consultadas

- `AGENTS.md`, `docs/MVP_VALIDATION.md` (passos 1–20)
- `server/src/shared/events.ts`, `types.ts`, `redaction.ts`
- `server/src/browser/inpage/scripts.ts`, `ScreenStateEngine.ts`, `ScreenshotService.ts`
- `server/src/voice/OfflineTranscriber.ts`, `ui/src/audio/AudioCapture.ts`
- `server/src/app/routes.ts`, `export/MarkdownExporter.ts`
- jenkies: `AGENTS.md`, `infra/k3s/dev/interview.yaml`, `infra/k3s/dev/minio.yaml`, `infra/k3s/platform/cloudflared.yaml`, `infra/k3s/data/databases.yaml`, `infra/k3s/argocd/applications.yaml`, `pipelines/deploy-interview-dev.Jenkinsfile`
- Chrome: Offscreen API, guia de screen capture, comportamento de `getUserMedia` fora de uma aba visível
- Mercado: Scribe (captura + Sidekick + voz), Jam (contexto técnico), Marker.io (extensão em site que você não controla)
