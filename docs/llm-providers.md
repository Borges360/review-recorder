# Provedores de IA, custo e orçamento

Runbook do painel **Provedores de IA e custos** (Control UI, `/admin/llm`). O review-recorder usa IA em
duas frentes: **transcrição de voz** (tempo real e offline) e, opcionalmente, um **resumo da timeline**.

## O que cada provedor faz

| Provedor   | Transcrição offline | Transcrição em tempo real | Texto (resumo) |
|------------|---------------------|---------------------------|----------------|
| OpenAI     | sim (`/audio/transcriptions`) | sim (WebSocket realtime) | sim |
| OpenRouter | sim (`/audio/transcriptions`) | **não** (só offline/chunks) | sim |
| Anthropic  | **não — sem STT**   | **não — sem STT**         | sim |

A Anthropic não oferece transcrição de áudio; o painel e a API recusam escolhê-la para transcrição. Ela só
aparece na tarefa de texto (resumo), que vem **desabilitada por padrão**.

Tarefas configuráveis (provedor + modelo cada uma):

| Tarefa | Padrão (sem configuração nova) |
|--------|--------------------------------|
| `transcription_realtime` | OpenAI, `gpt-live-transcribe` |
| `transcription_offline`  | `TRANSCRIPTION_PROVIDER` do ambiente (OpenAI, `gpt-4o-transcribe`) |
| `session_summary`        | desabilitada; se habilitada: OpenAI, `gpt-4o-mini` |

Sem nada configurado no painel o sistema se comporta como antes desta mudança.

## 1. Adicionar as três chaves

Nomes das variáveis (o painel só guarda o **nome**, nunca o valor):

- `OPENAI_API_KEY`
- `OPENROUTER_API_KEY`
- `ANTHROPIC_API_KEY`

Caminho no homelab (o agente nunca vê os valores):

1. Edite o segredo na UI HTTPS do OpenBao: `secret/homelab/apps/review-recorder/dev` e acrescente as chaves acima.
   - `OPENROUTER_API_KEY` já é provisionada pelo job `provision-openrouter-keys` (teto mensal por app); não a cole à mão.
   - `OPENAI_API_KEY` e `ANTHROPIC_API_KEY` são coladas por você.
2. Rode o job Jenkins `deliver-config-dev` para o app `review-recorder`: ele copia o KV para o Secret K8s e reinicia o pod.
3. O Secret entra no pod por `envFrom`; o servidor lê as variáveis ao subir.

Também defina, para liberar o painel no homelab (o container escuta em `0.0.0.0`):

- `ADMIN_TOKEN` (obrigatório para alterar): só ele abre `/admin/*` quando definido. Sem ele, o `API_TOKEN` comum só
  **consulta** o painel (`GET`); `PUT /admin/llm` e `POST /admin/llm/test` respondem **403** (`admin_token_required`),
  para que qualquer cliente da API não vire admin.
- Sem nenhum dos dois, `/admin` responde **403** quando `HOST` não é loopback, e em loopback só aceita requisição
  direta: se chegar com `X-Forwarded-*`, `Forwarded` ou `X-Real-IP` (reverse proxy/túnel no mesmo host), também **403**.

Local: copie `.env.example` para `.env` e preencha só as chaves que for usar.

Referência de chave alternativa: o admin só pode apontar um provedor para a variável padrão dele ou para nomes que o
**operador declarou** no ambiente, por provedor: `LLM_KEY_REFS_OPENAI`, `LLM_KEY_REFS_OPENROUTER`,
`LLM_KEY_REFS_ANTHROPIC` (lista separada por vírgula, só nomes `*_API_KEY`; por exemplo
`LLM_KEY_REFS_OPENAI=TEAM_OPENAI_API_KEY`). Chave de outro provedor ou de outro serviço (`STRIPE_API_KEY`) é recusada
com 400, para ninguém redirecionar um segredo do processo ao host de um provedor.

## 2. Escolher provedor e modelo no painel

1. Abra a Control UI e clique em **Provedores de IA e custos** (ou `/admin/llm`). Se o servidor exigir token,
   informe o `ADMIN_TOKEN` (fica só na aba, em `sessionStorage`).
2. Em **Chaves** veja se cada provedor está *configurada* e use **Testar conexão** (chamada leve de listagem; só
   informa sucesso/falha, nunca a chave).
3. Em **Provedor e modelo por tarefa** escolha o provedor e, se quiser, o modelo (vazio = padrão do provedor).
   Esvaziar o modelo de uma tarefa já personalizada volta ao padrão do ambiente.
4. Marque **Habilitar resumo** se quiser o resumo da timeline. Isso envia o texto da timeline (falas, telas e ações)
   ao provedor escolhido; por isso vem desligado. Na sessão concluída aparece o botão **Gerar resumo**.
5. Defina o **orçamento mensal** (estimado) e a ação: *só avisar* ou *bloquear chamadas pagas*. No modo bloquear,
   transcrição offline, realtime e resumo deixam de chamar o provedor quando o gasto estimado do mês atinge o limite
   (o áudio continua sendo gravado localmente e dá para recuperar depois). **Modelo sem tarifa** conta custo zero, então
   no modo bloquear a chamada é **recusada** (`unpriced_model`) até você cadastrar a tarifa na seção **Tarifas**; o
   painel marca a tarefa como "sem tarifa". Se a leitura do uso falhar (banco fora), a gravação **não** é bloqueada: o
   servidor registra um aviso e libera a chamada.
6. Na tarefa de resumo, escolha o **esforço de raciocínio** (padrão do provedor, baixo, médio, alto) se o modelo for de
   raciocínio. Ele vira `reasoning_effort` (OpenAI), `reasoning.effort` (OpenRouter) ou `output_config.effort`
   (Anthropic) e só é enviado quando você escolhe; o limite de tokens de saída sobe junto (1024/4096/8192) para o
   raciocínio não consumir a resposta. Se mesmo assim o modelo devolver texto vazio, o resumo falha com
   `upstream_error` (a chamada é registrada como falha e cobrada), nada é gravado em `summary.json`.
7. **Salvar configuração**. Cada alteração entra na auditoria (`GET /admin/llm/audit`) só com os nomes dos campos
   alterados, nunca com valores de chave.

Onde a configuração é guardada: Postgres (`app_settings`, `llm_usage`, `llm_audit`) quando há `DATABASE_URL`;
caso contrário arquivos em `DATA_DIR` (`llm-settings.json`, `llm-usage.jsonl`, `llm-audit.jsonl`).

## 3. Custo estimado

- Transcrição: minutos de áudio enviados × tarifa por minuto do modelo.
- Resumo: tokens de entrada e saída informados pelo provedor × tarifa por milhão de tokens.
- O painel mostra o total do mês, por tarefa/modelo e **por sessão**; `GET /sessions/:id/llm-usage` devolve o total
  de uma sessão.
- As tarifas embutidas (`builtin-2026-11`) são **estimativas**. Confira nas páginas de preço de cada provedor e ajuste na
  seção **Tarifas**; cada edição gera uma nova revisão (`builtin-2026-11+custom#N`) gravada em cada registro de uso, então
  o histórico não é reescrito. Modelo sem tarifa fica com custo desconhecido e aparece como "sem tarifa" (fora do total).
- O gasto do mês usado para o orçamento é lido do banco uma vez e mantido em memória (renovado a cada 30 s e somado a
  cada nova chamada), então checar o teto a cada chunk não varre o mês inteiro. Em mais de uma réplica o teto pode
  ultrapassar o limite por alguns segundos; o uso do realtime só é registrado ao parar a sessão (um crash perde esse registro).
- Não há usuários neste sistema (ferramenta single-tenant): não existe limite por usuário, apenas o orçamento mensal global.

## 4. Validar

```bash
npm test          # inclui testes com HTTP/WebSocket falsos (sem rede nem chave real)
npm run build
npm run lint
```

Checagem manual depois do deploy:

1. `GET /admin/llm` com o `ADMIN_TOKEN`: provedores com `keyConfigured: true` e nenhum valor de chave na resposta.
2. **Testar conexão** nos três provedores.
3. Grave uma sessão curta, finalize e veja o custo em **Custo estimado** e em `GET /sessions/:id/llm-usage`.
4. Com Anthropic como provedor do resumo, habilite o resumo e gere um em uma sessão concluída.

Se a tarefa escolhida não tem chave, a rota **falha fechada** (`no_api_key`): não cai em outra chave.

## 5. Rollback

- Voltar ao comportamento anterior: no painel esvazie os modelos personalizados e escolha de novo os provedores
  (ou apague `llm-settings.json` em `DATA_DIR` / `DELETE FROM app_settings WHERE key = 'llm'`). Sem override, vale só o ambiente.
- Desfazer a migração do Postgres (é aditiva; nenhuma tabela existente foi alterada):

```sql
DROP TABLE IF EXISTS llm_audit;
DROP TABLE IF EXISTS llm_usage;
DROP TABLE IF EXISTS app_settings;
```

A criação é idempotente (`CREATE TABLE IF NOT EXISTS`) e roda no startup, junto do schema existente.
