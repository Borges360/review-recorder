import {
  fingerprintClickables,
  limitClickables,
  toElementIdentity,
  type RawElement,
} from '../../server/src/capture/elementIdentity.js';

const CLICKABLE = 'button,a,input,select,textarea,[role=button],[role=link],[role=tab],[role=menuitem]';
let recording = false;

function accessibleName(el: Element): string | null {
  const labelled = el.getAttribute('aria-label');
  if (labelled?.trim()) return labelled.trim();
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean);
    if (parts.length) return parts.join(' ');
  }
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  const title = el.getAttribute('title');
  if (title?.trim()) return title.trim();
  const text = (el.textContent ?? '').trim().slice(0, 120);
  return text || null;
}

function describe(el: Element): RawElement {
  const rect = el.getBoundingClientRect();
  const input = el as HTMLInputElement;
  return {
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role'),
    accessibleName: accessibleName(el),
    text: (el.textContent ?? '').trim().slice(0, 120) || null,
    testId: el.getAttribute('data-testid'),
    id: el.id || null,
    name: input.name || null,
    bounds: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    inputType: input.type || null,
  };
}

function targetFrom(event: Event): RawElement | null {
  const node = event.target instanceof Element ? event.target : null;
  const match = node?.closest(CLICKABLE) ?? node;
  return match ? describe(match) : null;
}

function send(events: unknown[]): void {
  if (!recording) return;
  void chrome.runtime.sendMessage({ type: 'events', events });
}

function stamp(type: string, payload: Record<string, unknown>): void {
  send([
    {
      clientId: `${type}-${crypto.randomUUID()}`,
      type,
      activeElapsedMs: 0,
      elapsedMs: 0,
      url: location.href,
      payload,
    },
  ]);
}

function collectScreen(): void {
  const nodes = limitClickables([...document.querySelectorAll(CLICKABLE)]);
  const clickables = nodes.map((node) => toElementIdentity(describe(node)));
  const route = `${location.pathname}${location.search}`;
  stamp('screen-state', {
    title: document.title,
    fingerprint: fingerprintClickables(route, clickables),
    clickables,
  });
}

document.addEventListener(
  'click',
  (event) => {
    stamp('click', { target: targetFrom(event) });
  },
  true,
);

document.addEventListener(
  'pointerdown',
  (event) => {
    stamp('pointerdown', { target: targetFrom(event) });
  },
  true,
);

document.addEventListener(
  'change',
  (event) => {
    const el = event.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return;
    stamp('input-change', { target: describe(el), changed: true });
  },
  true,
);

document.addEventListener(
  'submit',
  (event) => {
    const form = event.target;
    stamp('form-submit', { target: form instanceof HTMLFormElement ? describe(form) : null });
  },
  true,
);

document.addEventListener(
  'keydown',
  (event) => {
    if (!['Enter', 'Escape', 'Tab'].includes(event.key)) return;
    const target = event.target instanceof Element ? describe(event.target) : null;
    stamp('key-action', { key: event.key, target });
  },
  true,
);

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'recording') recording = Boolean(message.value);
  if (message.type === 'collect-screen') collectScreen();
});

void chrome.runtime.sendMessage({ type: 'query-recording' }, (response) => {
  recording = Boolean(response?.recording);
});
