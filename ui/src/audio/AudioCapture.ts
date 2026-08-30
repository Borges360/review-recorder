const PCM_PROCESSOR_URL = '/pcm-processor.js';

const AUDIO_CONSTRAINTS: MediaStreamConstraints[] = [
  { audio: { echoCancellation: true, noiseSuppression: true } },
  { audio: true },
];

export class AudioCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private ws: WebSocket | null = null;
  private pendingStream: Promise<MediaStream> | null = null;
  private onLevel: (level: number) => void;
  private onError: (msg: string) => void;
  private targetSampleRate = 24000;

  constructor(onLevel: (level: number) => void, onError: (msg: string) => void) {
    this.onLevel = onLevel;
    this.onError = onError;
  }

  /** Inicia getUserMedia no clique — antes de awaits que invalidam o gesto do usuário. */
  beginAcquire(): void {
    if (!this.pendingStream && !this.stream) {
      this.pendingStream = this.acquireStream();
    }
  }

  async start(wsUrl: string): Promise<void> {
    try {
      this.stream = this.pendingStream ? await this.pendingStream : await this.acquireStream();
      this.pendingStream = null;

      this.context = new AudioContext();
      const sourceRate = this.context.sampleRate;
      if (this.context.state === 'suspended') {
        await this.context.resume();
      }

      try {
        await this.context.audioWorklet.addModule(PCM_PROCESSOR_URL);
      } catch {
        throw new Error('Falha ao carregar processador de áudio. Recarregue a página e tente novamente.');
      }

      const source = this.context.createMediaStreamSource(this.stream);
      const worklet = new AudioWorkletNode(this.context, 'pcm-processor');

      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      await new Promise<void>((resolve, reject) => {
        if (!this.ws) return reject(new Error('WebSocket não inicializado.'));
        this.ws.onopen = () => resolve();
        this.ws.onerror = () =>
          reject(
            new Error(
              'Não foi possível conectar ao servidor de áudio. Verifique se o backend está rodando.',
            ),
          );
      });

      worklet.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
        const input = new Int16Array(ev.data);
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += Math.abs(input[i]);
        this.onLevel(Math.min(100, (sum / input.length / 32768) * 400));

        const resampled = this.resample(input, sourceRate, this.targetSampleRate);
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(resampled.buffer);
        }
      };

      source.connect(worklet);
      worklet.connect(this.context.destination);

      this.stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        this.onError('Microfone desconectado');
      });
    } catch (err) {
      this.stop();
      throw err;
    }
  }

  stop(): void {
    this.pendingStream = null;
    this.ws?.close();
    this.ws = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.context?.close();
    this.context = null;
  }

  private async acquireStream(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Seu navegador não suporta captura de áudio.');
    }

    if (!window.isSecureContext) {
      throw new Error('A captura de áudio exige HTTPS ou localhost.');
    }

    let lastErr: unknown;
    for (const constraints of AUDIO_CONSTRAINTS) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastErr = err;
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          throw this.toMicError(err);
        }
        if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          throw this.toMicError(err);
        }
        if (name !== 'OverconstrainedError') break;
      }
    }

    throw this.toMicError(lastErr);
  }

  private toMicError(err: unknown): Error {
    if (err instanceof DOMException) {
      switch (err.name) {
        case 'NotAllowedError':
        case 'PermissionDeniedError':
          return new Error('Permissão do microfone negada. Verifique as configurações do navegador.');
        case 'NotFoundError':
        case 'DevicesNotFoundError':
          return new Error('Nenhum microfone encontrado no dispositivo.');
        case 'NotReadableError':
          return new Error(
            'Microfone indisponível. Feche outros apps que possam estar usando o microfone e tente novamente.',
          );
        case 'OverconstrainedError':
          return new Error('Nenhuma configuração de microfone compatível foi encontrada.');
        case 'AbortError':
          return new Error('Acesso ao microfone foi interrompido. Tente novamente.');
        case 'SecurityError':
          return new Error('A captura de áudio foi bloqueada por política de segurança do navegador.');
        default:
          return new Error(
            `Não foi possível acessar o microfone (${err.name}${err.message ? `: ${err.message}` : ''}).`,
          );
      }
    }
    if (err instanceof Error && err.message.includes('pcm-processor')) {
      return err;
    }
    if (err instanceof Error && err.message.includes('servidor de áudio')) {
      return err;
    }
    if (err instanceof Error && err.message) return err;
    return new Error('Não foi possível acessar o microfone.');
  }

  private resample(input: Int16Array, fromRate: number, toRate: number): Int16Array {
    if (fromRate === toRate) return input;
    const ratio = fromRate / toRate;
    const outLen = Math.floor(input.length / ratio);
    const output = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const srcIdx = Math.floor(i * ratio);
      output[i] = input[srcIdx] ?? 0;
    }
    return output;
  }
}
