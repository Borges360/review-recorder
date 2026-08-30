import type { TranscriberCallbacks } from './OpenAITranscriber.js';

/** Deterministic transcriber for tests — emits transcripts when audio is received. */
export class FakeTranscriber {
  private closed = false;
  private audioBytes = 0;
  private segmentIndex = 0;
  private activeItemId: string | null = null;
  private readonly transcripts = [
    'Esse botão deveria ficar alinhado com o campo acima.',
    'Essa página tem informação demais.',
    'Esse modal está muito grande.',
    'Esse campo deveria aceitar também CNPJ.',
  ];

  constructor(private readonly callbacks: TranscriberCallbacks) {}

  async connect(): Promise<void> {
    this.closed = false;
    this.callbacks.onOnline();
  }

  appendAudio(pcmBuffer: Buffer): void {
    if (this.closed) return;
    this.audioBytes += pcmBuffer.length;
    const threshold = 24000 * 2 * 0.1; // ~100ms of audio at 24kHz mono PCM16
    if (this.audioBytes < threshold) return;

    if (!this.activeItemId) {
      this.activeItemId = `fake-item-${++this.segmentIndex}`;
      this.callbacks.onSpeechStarted(this.activeItemId, 0);
      const text = this.transcripts[(this.segmentIndex - 1) % this.transcripts.length]!;
      for (let i = 1; i <= text.length; i += 8) {
        this.callbacks.onPartial(text.slice(0, i), this.activeItemId);
      }
      this.callbacks.onSpeechStopped(this.activeItemId);
      this.callbacks.onFinal(text, this.activeItemId);
      this.activeItemId = null;
      this.audioBytes = 0;
    }
  }

  getAudioMsWritten(): number {
    return Math.floor((this.audioBytes / 2 / 24000) * 1000);
  }

  disconnect(): void {
    this.closed = true;
    this.callbacks.onOffline();
  }
}
