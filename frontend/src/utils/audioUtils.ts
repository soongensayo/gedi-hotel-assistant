/**
 * Audio utility functions for converting between formats.
 * Used to bridge TTS output (MP3) → Simli avatar input (PCM16).
 */

let _pcmAudioContext: AudioContext | null = null;

function getPCMAudioContext(sampleRate: number): AudioContext {
  if (!_pcmAudioContext || _pcmAudioContext.state === 'closed') {
    _pcmAudioContext = new AudioContext({ sampleRate });
  }
  return _pcmAudioContext;
}

/**
 * Split text into sentences for chunked TTS processing.
 * Keeps punctuation with each sentence.
 *
 * "Hello! I'm your concierge. How can I help?"
 * → ["Hello!", "I'm your concierge.", "How can I help?"]
 */
export function splitIntoSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace
  const parts = text.split(/(?<=[.!?])\s+/);
  const sentences = parts.map((s) => s.trim()).filter((s) => s.length > 0);
  return sentences.length > 0 ? sentences : [text.trim()];
}

/**
 * Gain multiplier applied to TTS audio before sending to Simli.
 * OpenAI tts-1 output is ~6-10 dB quieter than loudness-normalised
 * media (YouTube etc.). 2.0× ≈ +6 dB brings it close to parity.
 * Adjust up/down if needed; clipping is prevented by the clamp below.
 */
const TTS_GAIN = 2.0;

/**
 * Decode an MP3/audio ArrayBuffer into raw PCM16 (Int16) samples.
 * Simli expects PCM16 as Uint8Array via sendAudioData().
 *
 * @param audioArrayBuffer - The MP3/audio data as an ArrayBuffer
 * @param targetSampleRate - Target sample rate (default 16000 for speech)
 * @returns Uint8Array of PCM16 little-endian samples
 */
export async function decodeToPCM16(
  audioArrayBuffer: ArrayBuffer,
  targetSampleRate = 16000
): Promise<Uint8Array> {
  const audioContext = getPCMAudioContext(targetSampleRate);

  const audioBuffer = await audioContext.decodeAudioData(audioArrayBuffer.slice(0));
  const float32Data = audioBuffer.getChannelData(0);

  const int16Data = new Int16Array(float32Data.length);
  for (let i = 0; i < float32Data.length; i++) {
    const amplified = float32Data[i] * TTS_GAIN;
    const sample = Math.max(-1, Math.min(1, amplified));
    int16Data[i] = sample < 0 ? sample * 32768 : sample * 32767;
  }

  return new Uint8Array(int16Data.buffer);
}

/**
 * Send PCM16 audio data to the Simli avatar client in chunks.
 * Simli's WebSocket can handle large payloads, but chunking
 * ensures smoother streaming and earlier lip-sync start.
 *
 * @param client - SimliClient instance
 * @param pcm16Data - Raw PCM16 audio as Uint8Array
 * @param chunkSize - Bytes per chunk (default 6000 = 3000 Int16 samples)
 */
export function sendPCM16ToSimli(
  client: { sendAudioData: (data: Uint8Array) => void },
  pcm16Data: Uint8Array,
  chunkSize = 32000
): void {
  for (let offset = 0; offset < pcm16Data.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, pcm16Data.length);
    const chunk = pcm16Data.slice(offset, end);
    client.sendAudioData(chunk);
  }
}
