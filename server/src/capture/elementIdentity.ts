import { isSensitiveField } from '../shared/redaction.js';
import type { ElementIdentity } from '../shared/types.js';

export const MAX_CLICKABLES = 150;

export interface RawElement {
  tag: string;
  role: string | null;
  accessibleName: string | null;
  text: string | null;
  testId: string | null;
  id: string | null;
  name: string | null;
  bounds: { x: number; y: number; width: number; height: number } | null;
  inputType?: string | null;
}

export function toElementIdentity(raw: RawElement): ElementIdentity {
  const label = `${raw.accessibleName ?? ''} ${raw.name ?? ''}`.trim();
  const sensitive = isSensitiveField(label, raw.inputType ?? undefined);
  const name = raw.accessibleName?.trim() || null;
  const text = raw.text?.trim().slice(0, 120) || null;
  return {
    tag: raw.tag,
    role: raw.role,
    accessibleName: sensitive ? '[redacted]' : name,
    text: sensitive ? null : text,
    testId: raw.testId,
    id: raw.id,
    name: sensitive ? null : raw.name,
    bounds: raw.bounds,
  };
}

export function limitClickables<T>(items: T[], max = MAX_CLICKABLES): T[] {
  return items.slice(0, max);
}

export function fingerprintClickables(route: string, items: ElementIdentity[]): string {
  const basis = `${route}\n${items.map((item) => `${item.role ?? item.tag}:${item.accessibleName ?? ''}`).join('\n')}`;
  let hash = 0;
  for (let i = 0; i < basis.length; i++) {
    hash = (Math.imul(31, hash) + basis.charCodeAt(i)) | 0;
  }
  return `fp-${(hash >>> 0).toString(16)}`;
}

export function clickablesToSnapshot(items: ElementIdentity[]): string {
  return items
    .map((item) => `- ${item.role ?? item.tag} "${item.accessibleName ?? ''}"`)
    .join('\n');
}

export function asRawElement(value: unknown): RawElement | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<RawElement>;
  if (typeof raw.tag !== 'string' || !raw.tag.trim()) return null;
  return {
    tag: raw.tag,
    role: typeof raw.role === 'string' ? raw.role : null,
    accessibleName: typeof raw.accessibleName === 'string' ? raw.accessibleName : null,
    text: typeof raw.text === 'string' ? raw.text : null,
    testId: typeof raw.testId === 'string' ? raw.testId : null,
    id: typeof raw.id === 'string' ? raw.id : null,
    name: typeof raw.name === 'string' ? raw.name : null,
    bounds: raw.bounds ?? null,
    inputType: typeof raw.inputType === 'string' ? raw.inputType : null,
  };
}
