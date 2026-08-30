import {
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  writeSync,
  closeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { WriteStream } from 'node:fs';
import WebSocket from 'ws';

export interface TranscriberCallbacks {
  onPartial: (text: string, itemId: string) => void;
  onSpeechStarted: (itemId: string, audioStartMs: number) => void;
  onSpeechStopped: (itemId: string) => void;
  onFinal: (text: string, itemId: string) => void;
  onOffline: () => void;
  onOnline: () => void;
  onError: (error: string) => void;
}

export class OpenAITranscriber {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private closed = false;
  private audioMsWritten = 0;

  constructor(
    private readonly apiKey: string,
    private readonly callbacks: TranscriberCallbacks,
  ) {}

  async connect(): Promise<void> {
    this.closed = false;
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      this.ws.on('open', () => {
        this.reconnectAttempts = 0;
        this.sendSessionUpdate();
        this.callbacks.onOnline();
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const event = JSON.parse(data.toString());
          this.handleEvent(event);
        } catch {
          /* ignore */
        }
      });

      this.ws.on('error', (err) => {
        this.callbacks.onError(String(err));
        if (this.reconnectAttempts === 0) reject(err);
      });

      this.ws.on('close', () => {
        this.callbacks.onOffline();
        if (!this.closed) void this.reconnect();
      });
    });
  }

  private sendSessionUpdate(): void {
    this.send({
      type: 'session.update',
      session: {
        type: 'transcription',
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            transcription: { model: 'gpt-live-transcribe', languages: ['pt'], delay: 'low' },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 700,
            },
          },
        },
      },
    });
  }

  private handleEvent(event: Record<string, unknown>): void {
    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        this.callbacks.onSpeechStarted(
          (event.item_id as string) ?? `item-${Date.now()}`,
          (event.audio_start_ms as number) ?? this.audioMsWritten,
        );
        break;
      case 'input_audio_buffer.speech_stopped':
        this.callbacks.onSpeechStopped((event.item_id as string) ?? '');
        break;
      case 'conversation.item.input_audio_transcription.delta':
        this.callbacks.onPartial(
          (event.delta as string) ?? '',
          (event.item_id as string) ?? '',
        );
        break;
      case 'conversation.item.input_audio_transcription.completed':
        this.callbacks.onFinal(
          (event.transcript as string) ?? '',
          (event.item_id as string) ?? '',
        );
        break;
      case 'error':
        this.callbacks.onError(JSON.stringify(event.error ?? event));
        break;
    }
  }

  appendAudio(pcmBuffer: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const durationMs = Math.floor((pcmBuffer.length / 2 / 24000) * 1000);
    this.audioMsWritten += durationMs;
    this.send({
      type: 'input_audio_buffer.append',
      audio: pcmBuffer.toString('base64'),
    });
  }

  commitBuffer(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.send({ type: 'input_audio_buffer.commit' });
  }

  getAudioMsWritten(): number {
    return this.audioMsWritten;
  }

  disconnect(): void {
    this.closed = true;
    this.commitBuffer();
    this.ws?.close();
    this.ws = null;
  }

  private async reconnect(): Promise<void> {
    this.reconnectAttempts += 1;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
    await new Promise((r) => setTimeout(r, delay));
    if (this.closed) return;
    try {
      await this.connect();
    } catch {
      /* will retry on close */
    }
  }

  private send(msg: Record<string, unknown>): void {
    this.ws?.send(JSON.stringify(msg));
  }
}

export class AudioStream {
  private stream: WriteStream | null = null;
  private dataSize = 0;
  private readonly sampleRate = 24000;
  private readonly channels = 1;
  private readonly bitsPerSample = 16;

  constructor(private readonly wavPath: string) {}

  open(): void {
    const dir = dirname(this.wavPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.stream = createWriteStream(this.wavPath);
    this.stream.write(this.buildWavHeader(0));
  }

  write(pcm: Buffer): void {
    if (!this.stream) this.open();
    this.stream!.write(pcm);
    this.dataSize += pcm.length;
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.stream) {
        resolve();
        return;
      }
      const stream = this.stream;
      stream.end(() => {
        this.rewriteHeader();
        this.stream = null;
        resolve();
      });
      stream.on('error', reject);
    });
  }

  private rewriteHeader(): void {
    const fd = openSync(this.wavPath, 'r+');
    writeSync(fd, this.buildWavHeader(this.dataSize), 0, 44, 0);
    closeSync(fd);
  }

  private buildWavHeader(dataSize: number): Buffer {
    const header = Buffer.alloc(44);
    const byteRate = (this.sampleRate * this.channels * this.bitsPerSample) / 8;
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(this.channels, 22);
    header.writeUInt32LE(this.sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE((this.channels * this.bitsPerSample) / 8, 32);
    header.writeUInt16LE(this.bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
    return header;
  }
}
