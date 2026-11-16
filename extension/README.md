Bundled asset notice: [Mark license](static/INTEIRO-MARK-LICENSE.txt)

# Review Recorder — Chromium Extension

**Artifact:** @review-recorder/extension · **version:** 1.0.0
**Status:** internal Chromium candidate. The package is private and has no npm or Chrome Web Store release in this plan.
**Compatibility:** Chromium Manifest V3. The bundle targets Chrome 120; the manifest does not declare a minimum browser version.

## English

### What it does

The extension adds a Review Recorder side panel to a separate Review Recorder API. While a session is active, it can send page interaction events, screen-state summaries, screenshots, and microphone audio to the configured API. The backend server is a separate project and is not included in this extension package.

The interface defaults to English. Options and the side panel let each extension installation select English or Brazilian Portuguese. The preference stays in extension-local storage and is separate from the API URL and token.

### Build and load locally

Use an authorized checkout of the private repository. From its root, install the locked workspace dependencies and build the extension:

**npm ci**
**npm run build --workspace=extension**

In Chrome or Chromium, open **chrome://extensions**, enable Developer mode, choose **Load unpacked**, and select the repository’s **extension/dist** directory. Reload the unpacked extension after rebuilding.

This is a local source-build route. Do not install this private candidate from npm or a browser store.

### Configure and use

Open the extension’s **Options** page. Confirm or replace the initial API URL with an endpoint approved for your environment, enter the API token if required, choose **Save**, then **Test**. This README omits deployment hostnames. The server must be configured and reachable separately.

Open the extension side panel, enter an optional review name, and choose **Record** to start. The first recording can open a browser page to request microphone permission. Use **Pause**, **Resume**, **Capture screenshot**, and **Stop** to control the session. **Open history** opens the configured service. The labels follow the selected language.

The API URL and token are stored in Chrome extension local storage. When a token is present, requests send it as a Bearer token. Pending events, audio, and screenshots can remain in the extension’s IndexedDB outbox and are retried when delivery fails.

### Privacy and permissions

The manifest grants host access to all URLs and injects a content script into matching pages in all frames. During an active recording, interaction data can include page URLs and titles, plus accessible labels or short text from interacted elements. The extension can also capture the visible tab and microphone audio and send those materials to the configured API.

Use the extension only on pages and recordings you are authorized to capture. Avoid pages containing sensitive information. A stopped or failed upload may leave queued material in local extension storage until it is delivered. Chrome local storage is not a credential vault; protect the browser profile and use an approved HTTPS endpoint.

### Troubleshooting and limits

- If **Test** fails, verify the configured API URL, network access, and token with the service operator.
- If recording cannot start, allow microphone access when Chrome prompts and confirm that the configured API is reachable.
- If the side panel still shows an older build, reload the unpacked extension from chrome://extensions.
- The accepted offline smoke loaded the extension in a disposable Chromium profile without recording, microphone access, persistent installation, or API requests. It does not certify live capture or a production service.

### License

The repository does not declare a redistribution license for the Review Recorder product. Confirm its terms with the project owner before copying or redistributing it. The bundled INTEIRO mark is separately licensed under MIT; see the linked notice.

## Português (Brasil)

### O que faz

A extensão adiciona um painel lateral do Review Recorder para uma API separada. Enquanto uma sessão está ativa, ela pode enviar eventos de interação, resumos do estado da tela, capturas de tela e áudio do microfone à API configurada. O servidor de backend é um projeto separado e não faz parte deste pacote da extensão.

A interface usa inglês por padrão. As páginas Options e o painel lateral permitem selecionar inglês ou português brasileiro. A preferência fica no armazenamento local da extensão e é separada da URL e do token da API.

### Compilar e carregar localmente

Use um checkout autorizado do repositório privado. Na raiz, instale as dependências travadas do workspace e compile a extensão:

**npm ci**
**npm run build --workspace=extension**

No Chrome ou Chromium, abra **chrome://extensions**, ative o modo de desenvolvedor, escolha **Carregar sem compactação** e selecione o diretório **extension/dist** do repositório. Recarregue a extensão após uma nova compilação.

Este é um fluxo local a partir do código-fonte. Não instale este candidato privado pelo npm nem por uma loja de extensões.

### Configurar e usar

Abra a página **Options** da extensão. Confirme ou substitua a URL inicial da API por um endpoint aprovado para seu ambiente; informe o token se necessário; escolha **Salvar** e depois **Testar**. Este README não reproduz nomes de hosts de implantação. O servidor precisa ser configurado e estar acessível separadamente.

Abra o painel lateral, informe um nome opcional para a revisão e escolha **Gravar**. Na primeira gravação, o navegador pode abrir uma página para pedir permissão do microfone. Use **Pausar**, **Retomar**, **Capturar tela** e **Parar** para controlar a sessão. **Abrir histórico** abre o serviço configurado. Os rótulos acompanham o idioma selecionado.

A URL da API e o token ficam no armazenamento local da extensão no Chrome. Quando há token, as requisições o enviam como Bearer. Eventos, áudio e capturas pendentes podem permanecer na fila IndexedDB da extensão e são reenviados quando uma entrega falha.

### Privacidade e permissões

O manifesto concede acesso a todos os URLs e injeta o content script nas páginas correspondentes, em todos os frames. Durante uma gravação ativa, os dados de interação podem incluir URLs e títulos das páginas, rótulos acessíveis e trechos curtos de texto dos elementos acionados. A extensão também pode capturar a aba visível e o áudio do microfone e enviar esse material à API configurada.

Use a extensão somente em páginas e gravações que você tem autorização para capturar. Evite páginas com informações sensíveis. Um envio interrompido ou com falha pode deixar dados na fila do armazenamento local até a entrega. O armazenamento local do Chrome não é um cofre de credenciais; proteja o perfil do navegador e use um endpoint HTTPS aprovado.

### Diagnóstico e limites

- Se **Testar** falhar, confira a URL da API, a rede e o token com a pessoa responsável pelo serviço.
- Se a gravação não iniciar, conceda acesso ao microfone quando o Chrome solicitar e confirme que a API configurada está acessível.
- Se o painel mostrar uma versão antiga, recarregue a extensão sem compactação em chrome://extensions.
- O smoke offline aceito carregou a extensão em um perfil Chromium descartável sem gravar, pedir microfone, instalar de forma persistente ou chamar a API. Ele não certifica captura real nem um serviço de produção.

### Licença

O repositório não declara uma licença de redistribuição para o produto Review Recorder. Confirme os termos com a pessoa responsável pelo projeto antes de copiar ou redistribuir. A marca INTEIRO incluída tem licença MIT separada; consulte o aviso vinculado.
