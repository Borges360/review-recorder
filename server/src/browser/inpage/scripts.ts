// In-page agent script — injected via addInitScript
// This file is bundled as a string for injection

export const INPAGE_AGENT_SOURCE = `
(() => {
  if (window.__uiReviewAgentInstalled) return;
  window.__uiReviewAgentInstalled = true;

  const queue = [];
  let flushTimer = null;

  function emit(type, payload) {
    queue.push({ type, payload, ts: Date.now(), url: location.href });
    if (!flushTimer) {
      flushTimer = setTimeout(flush, 150);
    }
  }

  function flush() {
    flushTimer = null;
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    if (typeof window.__uiReviewEmit === 'function') {
      window.__uiReviewEmit(batch).catch(() => {});
    }
  }

  function getRole(el) {
    return el.getAttribute('role') || el.tagName.toLowerCase();
  }

  function getAccessibleName(el) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(/\\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean);
      if (parts.length) return parts.join(' ');
    }
    const id = el.id;
    if (id) {
      const label = document.querySelector('label[for="' + id + '"]');
      if (label?.textContent) return label.textContent.trim();
    }
    const title = el.getAttribute('title');
    if (title) return title.trim();
    const alt = el.getAttribute('alt');
    if (alt) return alt.trim();
    const text = (el.textContent || '').trim().slice(0, 120);
    if (text) return text;
    return null;
  }

  function getElementIdentity(el) {
    if (!el || el === document.body) return null;
    const rect = el.getBoundingClientRect();
    const type = el.type || undefined;
    const name = el.name || null;
    const label = getAccessibleName(el) || '';
    const sensitive = type === 'password' || /password|senha|cpf|cnpj|token|secret|pin/i.test(label + ' ' + (name || ''));
    return {
      tag: el.tagName.toLowerCase(),
      role: getRole(el),
      accessibleName: sensitive ? '[redacted]' : getAccessibleName(el),
      text: sensitive ? null : ((el.textContent || '').trim().slice(0, 120) || null),
      testId: el.getAttribute('data-testid'),
      id: el.id || null,
      name: sensitive ? null : name,
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      inputType: type || null,
      valueCaptured: false,
      label: sensitive ? '[redacted]' : label || null,
    };
  }

  function relevantKey(e) {
    return ['Enter', 'Escape', 'Tab'].includes(e.key);
  }

  document.addEventListener('pointerdown', (e) => {
    const target = e.target instanceof Element ? e.target.closest('button,a,input,select,textarea,[role=button],[role=link],[role=tab]') || e.target : null;
    emit('pointerdown', { target: target ? getElementIdentity(target) : null });
  }, true);

  document.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target.closest('button,a,input,select,textarea,[role=button],[role=link],[role=tab]') || e.target : null;
    emit('click', { target: target ? getElementIdentity(target) : null });
  }, true);

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return;
    const identity = getElementIdentity(el);
    emit('input-change', { target: identity, changed: true });
  }, true);

  document.addEventListener('submit', (e) => {
    const form = e.target;
    emit('form-submit', { target: form instanceof HTMLFormElement ? getElementIdentity(form) : null });
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!relevantKey(e)) return;
    const target = e.target instanceof Element ? e.target : null;
    emit('key-action', { key: e.key, target: target ? getElementIdentity(target) : null });
  }, true);

  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = function(...args) {
    const result = origPush(...args);
    emit('navigation', { kind: 'pushState', url: location.href });
    return result;
  };
  history.replaceState = function(...args) {
    const result = origReplace(...args);
    emit('navigation', { kind: 'replaceState', url: location.href });
    return result;
  };
  window.addEventListener('popstate', () => {
    emit('navigation', { kind: 'popstate', url: location.href });
  });

  let mutationPending = false;
  const observer = new MutationObserver(() => {
    if (mutationPending) return;
    mutationPending = true;
    setTimeout(() => {
      mutationPending = false;
      emit('dom-mutation-signal', { url: location.href });
    }, 100);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: false });

  window.addEventListener('beforeunload', flush);
})();
`;

export const INPAGE_HUD_SOURCE = `
(() => {
  if (window.__uiReviewHudInstalled) return;
  window.__uiReviewHudInstalled = true;

  const host = document.createElement('div');
  host.id = '__ui-review-hud-host';
  host.style.cssText = 'all:initial;position:fixed;top:12px;right:12px;z-index:2147483647;font-family:system-ui,sans-serif;';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = \`
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .panel {
      background: rgba(20,20,24,0.92);
      color: #f0f0f0;
      border-radius: 10px;
      padding: 12px 14px;
      min-width: 280px;
      max-width: 360px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      font-size: 13px;
      line-height: 1.4;
    }
    .status { display: flex; align-items: center; gap: 8px; font-weight: 600; margin-bottom: 8px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: #ef4444; }
    .dot.paused { background: #f59e0b; }
    .dot.recording { background: #ef4444; animation: pulse 1.2s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
    .timer { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; margin: 6px 0; }
    .timers { display: flex; gap: 16px; margin: 6px 0; }
    .timer-block { display: flex; flex-direction: column; }
    .timer-label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }
    .timer-value { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .transcript { background: rgba(255,255,255,0.08); border-radius: 6px; padding: 8px; min-height: 40px; margin: 8px 0; font-style: italic; color: #ccc; }
    .url { font-size: 11px; color: #888; word-break: break-all; margin-bottom: 8px; }
    .buttons { display: flex; gap: 6px; flex-wrap: wrap; }
    button {
      flex: 1;
      min-width: 70px;
      padding: 6px 10px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      background: #3b3b44;
      color: #fff;
    }
    button:hover { background: #4a4a55; }
    button.primary { background: #2563eb; }
    button.danger { background: #dc2626; }
    .hidden { display: none !important; }
  \`;
  shadow.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = \`
    <div class="status"><span class="dot recording" id="dot"></span><span id="statusText">GRAVANDO</span></div>
    <div id="sessionName" style="font-size:11px;color:#aaa;margin-bottom:4px;"></div>
    <div class="timers">
      <div class="timer-block">
        <span class="timer-label">Ativo</span>
        <span class="timer-value" id="activeTimer">00:00</span>
      </div>
      <div class="timer-block">
        <span class="timer-label">Total</span>
        <span class="timer-value" id="wallTimer">00:00</span>
      </div>
    </div>
    <div class="transcript" id="transcript">Aguardando fala...</div>
    <div class="url" id="currentUrl"></div>
    <div class="buttons">
      <button id="btnPause">Pause</button>
      <button id="btnScreenshot">Screenshot</button>
      <button id="btnStop" class="danger">Finalizar</button>
    </div>
  \`;
  shadow.appendChild(panel);

  window.__uiReviewHud = {
    hide() { host.classList.add('hidden'); },
    show() { host.classList.remove('hidden'); },
    update(state) {
      const dot = shadow.getElementById('dot');
      const statusText = shadow.getElementById('statusText');
      const activeTimer = shadow.getElementById('activeTimer');
      const wallTimer = shadow.getElementById('wallTimer');
      const transcript = shadow.getElementById('transcript');
      const url = shadow.getElementById('currentUrl');
      const name = shadow.getElementById('sessionName');
      const btnPause = shadow.getElementById('btnPause');
      if (!dot || !statusText || !activeTimer) return;
      if (state.status === 'PAUSED') {
        dot.className = 'dot paused';
        statusText.textContent = 'PAUSADO';
        if (btnPause) btnPause.textContent = 'Resume';
      } else {
        dot.className = 'dot recording';
        statusText.textContent = 'GRAVANDO';
        if (btnPause) btnPause.textContent = 'Pause';
      }
      const formatMs = (ms) => {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
      };
      if (state.activeElapsedMs != null) activeTimer.textContent = formatMs(state.activeElapsedMs);
      if (state.wallElapsedMs != null && wallTimer) wallTimer.textContent = formatMs(state.wallElapsedMs);
      if (state.partialTranscript != null && transcript) transcript.textContent = state.partialTranscript || 'Aguardando fala...';
      if (state.currentUrl != null && url) url.textContent = state.currentUrl;
      if (state.sessionName != null && name) name.textContent = state.sessionName;
    }
  };

  shadow.getElementById('btnPause')?.addEventListener('click', () => {
    const btn = shadow.getElementById('btnPause');
    const isResume = btn?.textContent === 'Resume';
    window.__uiReviewControl?.(isResume ? 'resume' : 'pause');
  });
  shadow.getElementById('btnScreenshot')?.addEventListener('click', () => {
    window.__uiReviewControl?.('screenshot');
  });
  shadow.getElementById('btnStop')?.addEventListener('click', () => {
    window.__uiReviewControl?.('stop');
  });
})();
`;
