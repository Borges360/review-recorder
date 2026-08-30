import { readFileSync, existsSync } from 'node:fs';

export async function transcribeOffline(
  wavPath: string,
  apiKey: string,
): Promise<string | null> {
  if (!existsSync(wavPath)) return null;

  const formData = new FormData();
  const buffer = readFileSync(wavPath);
  const blob = new Blob([buffer], { type: 'audio/wav' });
  formData.append('file', blob, 'audio.wav');
  formData.append('model', 'gpt-4o-transcribe');

  try {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { text?: string };
    return data.text ?? null;
  } catch {
    return null;
  }
}
