let pcmAudioContext: AudioContext | null = null;

function getPcmAudioContext(sampleRate: number): AudioContext {
  if (!pcmAudioContext || pcmAudioContext.state === 'closed') {
    pcmAudioContext = new AudioContext({ sampleRate });
  }
  return pcmAudioContext;
}

export function splitIntoSentences(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return sentences.length > 0 ? sentences : [text.trim()];
}

export async function decodeToPCM16(
  audioArrayBuffer: ArrayBuffer,
  targetSampleRate = 16000
): Promise<Uint8Array> {
  const audioContext = getPcmAudioContext(targetSampleRate);
  const audioBuffer = await audioContext.decodeAudioData(audioArrayBuffer.slice(0));
  const samples = audioBuffer.getChannelData(0);
  const pcm = new Int16Array(samples.length);

  for (let i = 0; i < samples.length; i += 1) {
    const amplified = samples[i] * 2;
    const sample = Math.max(-1, Math.min(1, amplified));
    pcm[i] = sample < 0 ? sample * 32768 : sample * 32767;
  }

  return new Uint8Array(pcm.buffer);
}

export function sendPCM16ToSimli(
  client: { sendAudioData: (data: Uint8Array) => void },
  pcm16Data: Uint8Array,
  chunkSize = 32000
): void {
  for (let offset = 0; offset < pcm16Data.length; offset += chunkSize) {
    client.sendAudioData(pcm16Data.slice(offset, offset + chunkSize));
  }
}
