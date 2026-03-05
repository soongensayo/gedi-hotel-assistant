import OpenAI from 'openai';
import { config } from '../config';

const openai = config.openaiApiKey
  ? new OpenAI({ apiKey: config.openaiApiKey })
  : null;

type TTSVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

/**
 * Convert text to speech using OpenAI TTS API.
 * Returns an audio buffer (mp3).
 */
export async function textToSpeech(
  text: string,
  voice?: string
): Promise<Buffer> {
  if (!openai) {
    console.warn('[TTS] OpenAI not configured. Returning empty audio.');
    return Buffer.alloc(0);
  }

  try {
    const response = await openai.audio.speech.create({
      model: 'tts-1',
      voice: (voice || config.ttsVoice) as TTSVoice,
      input: text,
      response_format: 'mp3',
      speed: 1.0,
    });

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error('[TTS] Error:', error);
    throw error;
  }
}
