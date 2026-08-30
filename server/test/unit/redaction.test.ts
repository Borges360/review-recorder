import { describe, it, expect } from 'vitest';
import {
  redactAriaSnapshot,
  normalizeRoute,
  jaccardSimilarity,
  normalizeAriaLines,
  isSensitiveField,
} from '../../src/shared/redaction.js';

describe('redaction', () => {
  it('redacts textbox values', () => {
    const input = '- textbox "CPF": 123.456.789-00';
    expect(redactAriaSnapshot(input)).toContain('[redacted]');
    expect(redactAriaSnapshot(input)).not.toContain('123.456.789');
  });

  it('detects sensitive fields', () => {
    expect(isSensitiveField('Senha de acesso', 'password')).toBe(true);
    expect(isSensitiveField('CPF')).toBe(true);
    expect(isSensitiveField('Nome')).toBe(false);
  });

  it('normalizes routes with numeric ids', () => {
    expect(normalizeRoute('http://localhost/contracts/48291')).toBe('/contracts/:id');
  });

  it('similarity keeps same state with minor noise', () => {
    const a = normalizeAriaLines('- main:\n  - heading "Test"\n  - button "OK"');
    const b = normalizeAriaLines('- main:\n  - heading "Test"\n  - button "OK"\n  - text "99"');
    expect(jaccardSimilarity(a, b)).toBeGreaterThan(0.5);
  });

  it('similarity distinguishes wizard steps', () => {
    const step1 = normalizeAriaLines('- dialog "Etapa 1":\n  - text "Campo etapa 1"');
    const step2 = normalizeAriaLines('- dialog "Etapa 2":\n  - text "Campo etapa 2"');
    expect(jaccardSimilarity(step1, step2)).toBeLessThan(0.92);
  });
});
