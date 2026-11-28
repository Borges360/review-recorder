import type { ResolvedRoute } from './types.js';

export type FetchLike = typeof fetch;

export interface TextCompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface TextRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export const ANTHROPIC_VERSION = '2023-06-01';

/** Exposed for tests: the exact HTTP request each provider receives. */
export function buildTextHttpRequest(
  route: Pick<ResolvedRoute, 'provider' | 'model' | 'baseUrl'>,
  apiKey: string,
  req: TextRequest,
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const base = route.baseUrl.replace(/\/+$/, '');
  if (route.provider === 'anthropic') {
    return {
      url: `${base}/messages`,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: {
        model: route.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
      },
    };
  }
  // OpenAI and OpenRouter share the chat/completions shape.
  return {
    url: `${base}/chat/completions`,
    headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: {
      model: route.model,
      max_completion_tokens: req.maxTokens,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    },
  };
}

export function parseTextResponse(provider: ResolvedRoute['provider'], data: unknown): TextCompletionResult {
  const d = data as Record<string, any>;
  if (provider === 'anthropic') {
    const blocks = Array.isArray(d?.content) ? (d.content as { type?: string; text?: string }[]) : [];
    const text = blocks
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    return {
      text,
      inputTokens: Number(d?.usage?.input_tokens ?? 0),
      outputTokens: Number(d?.usage?.output_tokens ?? 0),
    };
  }
  const text = d?.choices?.[0]?.message?.content;
  return {
    text: typeof text === 'string' ? text : '',
    inputTokens: Number(d?.usage?.prompt_tokens ?? 0),
    outputTokens: Number(d?.usage?.completion_tokens ?? 0),
  };
}

export async function completeText(
  route: ResolvedRoute,
  req: TextRequest,
  fetchImpl: FetchLike = fetch,
): Promise<TextCompletionResult> {
  if (!route.apiKey) throw new Error('no_api_key');
  const http = buildTextHttpRequest(route, route.apiKey, req);
  const res = await fetchImpl(http.url, {
    method: 'POST',
    headers: http.headers,
    body: JSON.stringify(http.body),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Never echo request headers; provider error bodies do not contain our key.
    throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  return parseTextResponse(route.provider, await res.json());
}

export const SUMMARY_SYSTEM_PROMPT =
  'Você resume revisões de interface gravadas por voz. Receba a timeline (ações, telas e observações faladas) ' +
  'e responda em português do Brasil com: 1) um resumo de 2 a 4 frases; 2) uma lista de achados, cada um com ' +
  'categoria (bug, UX, conteúdo, acessibilidade, outro) e severidade (alta, média, baixa). Não invente fatos fora da timeline.';

/** Compact, bounded text view of the timeline sent to the provider. */
export function timelineToPrompt(timeline: Array<Record<string, unknown>>, maxChars = 60_000): string {
  const lines: string[] = [];
  for (const entry of timeline) {
    const offset = String(entry.offset ?? '');
    const speech = (entry.speech as { text?: string } | undefined)?.text;
    const screen = (entry.screen as { title?: string } | undefined)?.title;
    let body: string;
    switch (entry.type) {
      case 'observation':
        body = `FALA: ${speech ?? ''}`;
        break;
      case 'screen':
        body = `TELA: ${screen ?? ''}`;
        break;
      case 'action':
        body = `AÇÃO: ${String(entry.action ?? '')}`;
        break;
      default:
        body = String(entry.type ?? '');
    }
    lines.push(`[${offset}] ${body}`);
  }
  const text = lines.join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[timeline truncada]` : text;
}
