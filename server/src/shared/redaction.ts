const SENSITIVE_PATTERNS = [
  /password/i,
  /senha/i,
  /secret/i,
  /token/i,
  /pin/i,
  /cpf/i,
  /cnpj/i,
  /cart[aã]o/i,
  /card/i,
  /conta/i,
  /account/i,
  /telefone/i,
  /phone/i,
  /e-?mail/i,
];

export function isSensitiveField(labelOrName: string, type?: string): boolean {
  if (type === 'password') return true;
  return SENSITIVE_PATTERNS.some((p) => p.test(labelOrName));
}

export function redactAriaSnapshot(aria: string): string {
  let result = aria;
  // Remove textbox values: textbox "Label": value
  result = result.replace(/(textbox[^:\n]*:\s*)([^\n]+)/gi, '$1[redacted]');
  // Remove combobox values
  result = result.replace(/(combobox[^:\n]*:\s*)([^\n]+)/gi, '$1[redacted]');
  // Replace long numeric sequences
  result = result.replace(/\b\d{6,}\b/g, '#');
  return result;
}

export function normalizeRoute(url: string): string {
  try {
    const parsed = new URL(url, 'http://localhost');
    let path = parsed.pathname;
    path = path.replace(/\/\d+/g, '/:id');
    path = path.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid');
    return path + parsed.search;
  } catch {
    return url.replace(/\/\d+/g, '/:id');
  }
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'session';
}

export function formatOffset(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const frac = Math.floor(ms % 1000);
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(frac, 3)}`;
  return `${pad(m)}:${pad(s)}.${pad(frac, 3)}`;
}

export function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 1 : intersection / union;
}

export function normalizeAriaLines(aria: string): string[] {
  return aria
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/\b\d{6,}\b/g, '#'));
}
