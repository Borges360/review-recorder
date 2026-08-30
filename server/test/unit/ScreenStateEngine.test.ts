import { describe, it, expect } from 'vitest';
import { ScreenStateEngine } from '../../src/browser/ScreenStateEngine.js';

describe('ScreenStateEngine fingerprint', () => {
  it('produces stable fingerprint for same structural content', () => {
    const engine = new ScreenStateEngine(() => {});
    const fp1 = engine.computeFingerprint('/wizard', '- dialog "Etapa 1"\n  - textbox "Campo"', ['Etapa 1']);
    const fp2 = engine.computeFingerprint('/wizard', '- dialog "Etapa 1"\n  - textbox "Campo"', ['Etapa 1']);
    expect(fp1).toBe(fp2);
  });

  it('produces different fingerprint for different wizard steps', () => {
    const engine = new ScreenStateEngine(() => {});
    const fp1 = engine.computeFingerprint('/wizard', '- dialog "Etapa 1"\n  - text "Campo 1"', ['Etapa 1']);
    const fp2 = engine.computeFingerprint('/wizard', '- dialog "Etapa 2"\n  - text "Campo 2"', ['Etapa 2']);
    expect(fp1).not.toBe(fp2);
  });
});
