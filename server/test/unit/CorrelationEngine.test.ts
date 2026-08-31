import { describe, it, expect } from 'vitest';
import {
  CorrelationEngine,
  TranscriptAssembler,
  splitAtWordBoundary,
} from '../../src/timeline/CorrelationEngine.js';
import type { ElementIdentity } from '../../src/shared/types.js';

describe('splitAtWordBoundary', () => {
  it('returns empty complete when trailing word is incomplete', () => {
    expect(splitAtWordBoundary('botão irregu')).toEqual({
      complete: '',
      remainder: 'botão irregu',
    });
  });

  it('splits at last complete word', () => {
    expect(splitAtWordBoundary('botão irregu lar')).toEqual({
      complete: 'botão irregu',
      remainder: 'lar',
    });
  });
});

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

describe('TranscriptAssembler click flush', () => {
  const target: ElementIdentity = {
    tag: 'button',
    role: 'button',
    accessibleName: 'E-mail',
    text: 'E-mail',
    testId: null,
    id: null,
    name: null,
    bounds: { x: 0, y: 0, width: 100, height: 40 },
  };

  it('does not flush when only incomplete words exist', () => {
    const corr = new CorrelationEngine();
    const assembler = new TranscriptAssembler();
    corr.updateScreenState('state-1');
    assembler.startSpeech('item-1', 0, corr.getSpeechContext());
    assembler.appendPartial('botão irregu', 'item-1');

    corr.recordAction(target, 7000);
    const segment = assembler.flushAtClick(7000, 'sess-1', corr.getSpeechContext());
    expect(segment).toBeNull();
    expect(assembler.getActive()?.partialText).toBe('botão irregu');
  });

  it('flushes complete words and restarts speech with post-click context', () => {
    const corr = new CorrelationEngine();
    const assembler = new TranscriptAssembler();
    corr.updateScreenState('state-1');
    assembler.startSpeech('item-1', 0, corr.getSpeechContext());
    assembler.appendPartial('Nessa página esse botão', 'item-1');

    corr.recordAction(target, 7000);
    const segment = assembler.flushAtClick(7000, 'sess-1', corr.getSpeechContext());

    expect(segment?.text).toBe('Nessa página esse');
    expect(segment?.startedAtMs).toBe(0);
    expect(segment?.endedAtMs).toBe(7000);
    expect(assembler.getActive()?.partialText).toBe('botão');
    expect(assembler.getActive()?.startedAtMs).toBe(7000);
  });

  it('post-click segment gets ELEMENT scope on finalize', () => {
    const corr = new CorrelationEngine();
    const assembler = new TranscriptAssembler();
    corr.updateScreenState('state-1');
    assembler.startSpeech('item-1', 0, corr.getSpeechContext());
    assembler.appendPartial('Primeiro trecho aqui', 'item-1');

    corr.recordAction(target, 5000);
    assembler.flushAtClick(5000, 'sess-1', corr.getSpeechContext());
    assembler.appendPartial(' sobre o botão', 'item-1');

    const fullText = 'Primeiro trecho aqui sobre o botão';
    const { segments } = assembler.finalizeFromFullText(fullText, 'item-1', 7000, 'sess-1');
    const segment = segments[0];

    expect(segment?.text).toBe('aqui sobre o botão');
    expect(segment?.scope).toBe('ELEMENT');
    expect(segment?.associationConfidence).toBe('HIGH');
    expect(segment?.candidateElement?.accessibleName).toBe('E-mail');
  });

  it('multi-flush + finalize produces three segments without duplication', () => {
    const corr = new CorrelationEngine();
    const assembler = new TranscriptAssembler();
    corr.updateScreenState('state-1');
    assembler.startSpeech('item-1', 0, corr.getSpeechContext());

    assembler.appendPartial('Parte um aqui', 'item-1');
    corr.recordAction(target, 3000);
    const seg1 = assembler.flushAtClick(3000, 'sess-1', corr.getSpeechContext());

    assembler.appendPartial(' Parte dois fim', 'item-1');
    corr.recordAction(target, 6000);
    const seg2 = assembler.flushAtClick(6000, 'sess-1', corr.getSpeechContext());

    const fullText = 'Parte um aqui Parte dois fim Parte três final';
    const { segments } = assembler.finalizeFromFullText(fullText, 'item-1', 9000, 'sess-1');
    const seg3 = segments[0];

    expect(seg1?.text).toBe('Parte um');
    expect(seg2?.text).toBe('aqui Parte dois');
    expect(seg3?.text).toBe('fim Parte três final');

    const allText = [seg1?.text, seg2?.text, seg3?.text].join(' ');
    expect(allText).toBe(fullText);
  });

  it('splits full text by click boundaries when partial transcript is unavailable', () => {
    const corr = new CorrelationEngine();
    const assembler = new TranscriptAssembler();
    const emailTarget: ElementIdentity = {
      tag: 'button',
      role: 'button',
      accessibleName: 'E-mail',
      text: 'E-mail',
      testId: null,
      id: null,
      name: null,
      bounds: null,
    };
    const buscarTarget: ElementIdentity = {
      tag: 'button',
      role: 'button',
      accessibleName: 'Buscar',
      text: 'Buscar',
      testId: null,
      id: null,
      name: null,
      bounds: null,
    };

    corr.updateScreenState('state-1');
    assembler.startSpeech('item-1', 0, corr.getSpeechContext());

    corr.recordAction(emailTarget, 10000);
    assembler.recordClickBoundary(10000, corr.getSpeechContext());
    corr.recordAction(buscarTarget, 20000);
    assembler.recordClickBoundary(20000, corr.getSpeechContext());

    const fullText =
      'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi';
    const { segments } = assembler.finalizeFromFullText(fullText, 'item-1', 30000, 'sess-1');

    expect(segments.length).toBe(3);
    expect(segments.map((s) => s.text).join(' ')).toBe(fullText);
    expect(segments[0]?.startedAtMs).toBe(0);
    expect(segments[0]?.endedAtMs).toBe(10000);
    expect(segments[1]?.startedAtMs).toBe(10000);
    expect(segments[1]?.endedAtMs).toBe(20000);
    expect(segments[2]?.startedAtMs).toBe(20000);
    expect(segments[2]?.endedAtMs).toBe(30000);
    expect(segments[1]?.scope).toBe('ELEMENT');
    expect(segments[1]?.candidateElement?.accessibleName).toBe('E-mail');
    expect(segments[2]?.candidateElement?.accessibleName).toBe('Buscar');
  });
});
