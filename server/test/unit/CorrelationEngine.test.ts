import { describe, it, expect } from 'vitest';
import { CorrelationEngine, TranscriptAssembler } from '../../src/timeline/CorrelationEngine.js';
import type { ElementIdentity } from '../../src/shared/types.js';

describe('CorrelationEngine', () => {
  it('infers ELEMENT scope with HIGH confidence after recent click', () => {
    const corr = new CorrelationEngine();
    const assembler = new TranscriptAssembler();
    const target: ElementIdentity = {
      tag: 'button',
      role: 'button',
      accessibleName: 'Editar contrato',
      text: 'Editar contrato',
      testId: null,
      id: null,
      name: null,
      bounds: { x: 0, y: 0, width: 100, height: 40 },
    };
    corr.recordAction(target, 1000);
    corr.updateScreenState('state-1');
    corr.updatePage('page-1');

    assembler.startSpeech('item-1', 2500, corr.getSpeechContext());
    const { segment } = assembler.finalize('Esse botão está deslocado.', 'item-1', 3000, 'sess-1');

    expect(segment.scope).toBe('ELEMENT');
    expect(segment.associationConfidence).toBe('HIGH');
    expect(segment.candidateElement?.accessibleName).toBe('Editar contrato');
  });

  it('defaults to SCREEN scope without recent action', () => {
    const corr = new CorrelationEngine();
    const assembler = new TranscriptAssembler();
    corr.updateScreenState('state-1');

    assembler.startSpeech('item-2', 5000, corr.getSpeechContext());
    const { segment } = assembler.finalize('Essa página tem informação demais.', 'item-2', 6000, 'sess-1');

    expect(segment.scope).toBe('SCREEN');
    expect(segment.associationConfidence).toBe('LOW');
  });

  it('links pending evidence to next speech', () => {
    const corr = new CorrelationEngine();
    corr.registerPendingEvidence('evidence-1', 4000);
    const linked = corr.consumePendingEvidence(2000, 4500);
    expect(linked).toBe('evidence-1');
  });
});
