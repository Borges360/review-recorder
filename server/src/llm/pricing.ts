import type { ProviderId, Tariff, UsageRecord } from './types.js';

export const DEFAULT_TARIFF_VERSION = 'builtin-2026-11';

/**
 * Built-in ESTIMATES (USD) so the panel works out of the box. They are editable in the
 * admin panel (versioned) and must be checked against each provider's price page.
 */
export const DEFAULT_TARIFFS: Record<string, Tariff> = {
  'openai/gpt-4o-transcribe': { audioUsdPerMinute: 0.006 },
  'openai/gpt-4o-mini-transcribe': { audioUsdPerMinute: 0.003 },
  'openai/whisper-1': { audioUsdPerMinute: 0.006 },
  'openai/gpt-live-transcribe': { audioUsdPerMinute: 0.006 },
  'openrouter/openai/gpt-4o-transcribe': { audioUsdPerMinute: 0.006 },
  'openrouter/openai/gpt-4o-mini-transcribe': { audioUsdPerMinute: 0.003 },
  'openai/gpt-4o-mini': { inputUsdPerMTok: 0.15, outputUsdPerMTok: 0.6 },
  'openrouter/openai/gpt-4o-mini': { inputUsdPerMTok: 0.15, outputUsdPerMTok: 0.6 },
  'anthropic/claude-haiku-5-5': { inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 },
  'anthropic/claude-haiku-4-5': { inputUsdPerMTok: 1, outputUsdPerMTok: 5 },
  'anthropic/claude-sonnet-5-5': { inputUsdPerMTok: 2, outputUsdPerMTok: 10 },
  'anthropic/claude-opus-5-5': { inputUsdPerMTok: 4, outputUsdPerMTok: 20 },
};

export function tariffKey(provider: ProviderId, model: string): string {
  return `${provider}/${model}`;
}

export function tariffVersionLabel(revision: number): string {
  return revision > 0 ? `${DEFAULT_TARIFF_VERSION}+custom#${revision}` : DEFAULT_TARIFF_VERSION;
}

export function findTariff(
  overrides: Record<string, Tariff>,
  provider: ProviderId,
  model: string,
): Tariff | null {
  const key = tariffKey(provider, model);
  return overrides[key] ?? DEFAULT_TARIFFS[key] ?? null;
}

export function estimateCostUsd(
  tariff: Tariff | null,
  usage: Pick<UsageRecord, 'audioSeconds' | 'inputTokens' | 'outputTokens'>,
): number | null {
  if (!tariff) return null;
  let total = 0;
  let priced = false;
  if (tariff.audioUsdPerMinute !== undefined) {
    total += (usage.audioSeconds / 60) * tariff.audioUsdPerMinute;
    priced = true;
  }
  if (tariff.inputUsdPerMTok !== undefined) {
    total += (usage.inputTokens / 1_000_000) * tariff.inputUsdPerMTok;
    priced = true;
  }
  if (tariff.outputUsdPerMTok !== undefined) {
    total += (usage.outputTokens / 1_000_000) * tariff.outputUsdPerMTok;
    priced = true;
  }
  return priced ? Math.round(total * 1e6) / 1e6 : null;
}
