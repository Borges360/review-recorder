import { describe, expect, it, vi } from 'vitest';

const instances: FakeSocket[] = [];

class FakeSocket {
  static OPEN = 1;
  readyState = 1;
  sent: Record<string, unknown>[] = [];
  handlers: Record<string, (arg?: unknown) => void> = {};
  constructor(
    readonly url: string,
    readonly options: { headers: Record<string, string> },
  ) {
    instances.push(this);
    queueMicrotask(() => this.handlers.open?.());
  }
  on(event: string, handler: (arg?: unknown) => void) {
    this.handlers[event] = handler;
    return this;
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
}

vi.mock('ws', () => ({ default: FakeSocket }));

const callbacks = {
  onPartial: vi.fn(),
  onSpeechStarted: vi.fn(),
  onSpeechStopped: vi.fn(),
  onFinal: vi.fn(),
  onOffline: vi.fn(),
  onOnline: vi.fn(),
  onError: vi.fn(),
};

describe('transcrição realtime OpenAI', () => {
  it('usa o endpoint realtime com Bearer e o modelo da rota no session.update', async () => {
    const { getTranscriber } = await import('../../src/voice/Transcriber.js');
    const transcriber = getTranscriber('openai').realtime(
      { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-transcribe', apiKey: 'sk-test-realtime' },
      callbacks,
    );
    await transcriber.connect();
    const socket = instances.at(-1)!;
    expect(socket.url).toBe('wss://api.openai.com/v1/realtime?intent=transcription');
    expect(socket.options.headers).toEqual({ Authorization: 'Bearer sk-test-realtime' });
    const update = socket.sent[0] as { type: string; session: { audio: { input: { transcription: { model: string; languages: string[] } } } } };
    expect(update.type).toBe('session.update');
    expect(update.session.audio.input.transcription.model).toBe('gpt-4o-mini-transcribe');
    expect(update.session.audio.input.transcription.languages).toEqual(['pt']);

    transcriber.appendAudio(Buffer.alloc(4800));
    expect(socket.sent[1]!.type).toBe('input_audio_buffer.append');
    expect(transcriber.getAudioMsWritten()).toBe(100);
    transcriber.disconnect();
  });

  it('sem modelo explícito mantém gpt-live-transcribe (comportamento anterior)', async () => {
    const { OpenAITranscriber } = await import('../../src/voice/OpenAITranscriber.js');
    const transcriber = new OpenAITranscriber('sk-test', callbacks);
    await transcriber.connect();
    const update = instances.at(-1)!.sent[0] as { session: { audio: { input: { transcription: { model: string } } } } };
    expect(update.session.audio.input.transcription.model).toBe('gpt-live-transcribe');
    transcriber.disconnect();
  });

  it('exige chave: sem apiKey o adapter não abre socket', async () => {
    const { getTranscriber } = await import('../../src/voice/Transcriber.js');
    const before = instances.length;
    expect(() =>
      getTranscriber('openai').realtime({ provider: 'openai', baseUrl: 'x', model: 'm', apiKey: null }, callbacks),
    ).toThrow('no_api_key');
    expect(instances.length).toBe(before);
  });
});
