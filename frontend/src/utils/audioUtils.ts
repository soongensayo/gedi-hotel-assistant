/**
 * Audio utility functions for converting between formats.
 * Used to bridge TTS output (MP3) → Simli avatar input (PCM16).
 */

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
  // Create an AudioContext at the target sample rate
  // This makes the browser resample for us during decoding
  const audioContext = new AudioContext({ sampleRate: targetSampleRate });

  try {
    // Decode the compressed audio (MP3) to raw PCM samples
    const audioBuffer = await audioContext.decodeAudioData(audioArrayBuffer.slice(0));

    // Get mono channel data (Float32Array, values between -1.0 and 1.0)
    const float32Data = audioBuffer.getChannelData(0);

    // Convert Float32 → Int16
    const int16Data = new Int16Array(float32Data.length);
    for (let i = 0; i < float32Data.length; i++) {
      const sample = Math.max(-1, Math.min(1, float32Data[i]));
      int16Data[i] = sample < 0 ? sample * 32768 : sample * 32767;
    }

    // Return as Uint8Array (the byte representation of Int16Array)
    return new Uint8Array(int16Data.buffer);
  } finally {
    await audioContext.close();
  }
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
  chunkSize = 6000
): void {
  // Send in chunks for smoother streaming
  for (let offset = 0; offset < pcm16Data.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, pcm16Data.length);
    const chunk = pcm16Data.slice(offset, end);
    client.sendAudioData(chunk);
  }
}
