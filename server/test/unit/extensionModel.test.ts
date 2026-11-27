import { describe, expect, it } from 'vitest';
import { fingerprintClickables, limitClickables, toElementIdentity } from '../../src/capture/elementIdentity.js';
import { parseTranscriptPayload, shiftChunkSegments } from '../../src/capture/chunkTiming.js';
import { objectKey, publicObjectKey } from '../../src/persistence/RemoteStores.js';
import { nextRetryDelayMs } from '../../../extension/src/retry.js';

describe('identidade de componentes clicáveis', () => {
  it('redige senha e limita o inventário', () => {
    const identity = toElementIdentity({
      tag: 'input',
      role: 'textbox',
      accessibleName: 'Senha',
      text: 'segredo',
      testId: null,
      id: null,
      name: 'password',
      bounds: null,
      inputType: 'password',
    });
    expect(identity.accessibleName).toBe('[redacted]');
    expect(identity.text).toBeNull();
    expect(identity.name).toBeNull();
    expect(limitClickables([1, 2, 3], 2)).toEqual([1, 2]);
  });

  it('mantém o nome acessível de um botão', () => {
    const identity = toElementIdentity({
      tag: 'button',
      role: 'button',
      accessibleName: 'Salvar contrato',
      text: 'Salvar contrato',
      testId: 'save',
      id: 'save',
      name: null,
      bounds: { x: 0, y: 0, width: 8, height: 8 },
    });
    expect(identity.accessibleName).toBe('Salvar contrato');
    expect(fingerprintClickables('/contracts/:id', [identity])).toMatch(/^fp-/);
  });
});

describe('tempo do chunk de áudio', () => {
  it('desloca segmentos e cai para o texto inteiro sem timestamps', () => {
    expect(shiftChunkSegments([{ text: 'olá', startMs: 0, endMs: 400 }], 1000)).toEqual([
      { text: 'olá', startMs: 1000, endMs: 1400 },
    ]);
    expect(parseTranscriptPayload({ text: 'fala contínua' }, 5000)).toEqual([
      { text: 'fala contínua', startMs: 0, endMs: 5000 },
    ]);
    expect(
      parseTranscriptPayload({ segments: [{ text: 'um', start: 0.2, end: 0.8 }] }, 5000),
    ).toEqual([{ text: 'um', startMs: 200, endMs: 800 }]);
  });
});

describe('objeto e fila', () => {
  it('monta a chave do bucket review-recorder', () => {
    expect(objectKey('abc', 'evidence', 'shot.png')).toBe('abc/evidence/shot.png');
    expect(publicObjectKey('abc', 'evidence', 'shot.png')).toBe('review-recorder/abc/evidence/shot.png');
  });

  it('aumenta o intervalo de retry até 30s', () => {
    expect(nextRetryDelayMs(0)).toBe(1000);
    expect(nextRetryDelayMs(2)).toBe(4000);
    expect(nextRetryDelayMs(10)).toBe(30000);
  });
});
