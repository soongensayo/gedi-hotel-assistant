import OpenAI from 'openai';
import { config } from '../config';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import os from 'os';

const openai = config.openaiApiKey
  ? new OpenAI({ apiKey: config.openaiApiKey })
  : null;

/**
 * Transcribe audio to text using OpenAI Whisper API.
 * Accepts a Buffer of audio data (webm, mp3, wav, etc.)
 */
export async function speechToText(audioBuffer: Buffer, filename?: string): Promise<string> {
  if (!openai) {
    console.warn('[STT] OpenAI not configured. Returning mock transcription.');
    return 'Mock transcription — OpenAI API key not set.';
  }

  // Write buffer to a temp file since the API expects a file
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, filename || `stt-${Date.now()}.webm`);

  try {
    await fs.writeFile(tmpFile, audioBuffer);

    const transcription = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: createReadStream(tmpFile),
      language: 'en',
    });

    return transcription.text;
  } catch (error) {
    console.error('[STT] Error:', error);
    throw error;
  } finally {
    // Clean up temp file
    try {
      await fs.unlink(tmpFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}
