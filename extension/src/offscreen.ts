let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;

async function start(): Promise<void> {
  if (recorder && recorder.state === 'recording') return;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  recorder = new MediaRecorder(stream, { mimeType });
  recorder.addEventListener('dataavailable', (event) => {
    if (!event.data || event.data.size === 0) return;
    void chrome.runtime.sendMessage({ type: 'audio-chunk', blob: event.data });
  });
  recorder.start(5000);
}

function stop(): void {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  recorder = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'mic-start') void start().catch((error: unknown) => {
    void chrome.runtime.sendMessage({ type: 'mic-error', error: String(error) });
  });
  if (message.type === 'mic-stop') stop();
});
