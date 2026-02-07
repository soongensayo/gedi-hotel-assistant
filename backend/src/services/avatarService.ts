import axios from 'axios';
import { config } from '../config';

/**
 * Avatar service - integrates with Simli or D-ID to generate
 * talking-head avatar video from audio/text.
 */

// --- Simli Integration ---

interface SimliSession {
  sessionToken: string;
  streamUrl: string;
}

/**
 * Initialize a Simli avatar session
 */
export async function initSimliSession(): Promise<SimliSession | null> {
  if (!config.simliApiKey) {
    console.warn('[Avatar] Simli API key not set. Avatar disabled.');
    return null;
  }

  try {
    const response = await axios.post(
      'https://api.simli.ai/startAudioToVideoSession',
      {
        faceId: config.simliFaceId,
        isJPG: false,
        syncAudio: true,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'api-key': config.simliApiKey,
        },
      }
    );

    return {
      sessionToken: response.data.session_token,
      streamUrl: response.data.stream_url,
    };
  } catch (error) {
    console.error('[Avatar] Simli init error:', error);
    return null;
  }
}

/**
 * Send audio to Simli for avatar lip-sync
 */
export async function sendAudioToSimli(
  sessionToken: string,
  audioBuffer: Buffer
): Promise<void> {
  if (!config.simliApiKey) return;

  try {
    await axios.post(
      'https://api.simli.ai/sendAudio',
      audioBuffer,
      {
        headers: {
          'Content-Type': 'application/octet-stream',
          'api-key': config.simliApiKey,
          'session-token': sessionToken,
        },
      }
    );
  } catch (error) {
    console.error('[Avatar] Simli send audio error:', error);
    throw error;
  }
}

// --- D-ID Integration ---

interface DIDTalkResponse {
  id: string;
  resultUrl?: string;
  status: string;
}

/**
 * Generate a D-ID talking head video from text
 */
export async function generateDIDTalk(text: string): Promise<DIDTalkResponse | null> {
  if (!config.didApiKey) {
    console.warn('[Avatar] D-ID API key not set. Avatar disabled.');
    return null;
  }

  try {
    const response = await axios.post(
      'https://api.d-id.com/talks',
      {
        script: {
          type: 'text',
          input: text,
          provider: {
            type: 'microsoft',
            voice_id: 'en-US-JennyNeural',
          },
        },
        source_url: 'https://d-id-public-bucket.s3.us-west-2.amazonaws.com/alice.jpg',
        config: {
          stitch: true,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${config.didApiKey}`,
        },
      }
    );

    return {
      id: response.data.id,
      status: response.data.status,
    };
  } catch (error) {
    console.error('[Avatar] D-ID create talk error:', error);
    return null;
  }
}

/**
 * Get the status/result of a D-ID talk
 */
export async function getDIDTalkResult(talkId: string): Promise<DIDTalkResponse | null> {
  if (!config.didApiKey) return null;

  try {
    const response = await axios.get(
      `https://api.d-id.com/talks/${talkId}`,
      {
        headers: {
          Authorization: `Basic ${config.didApiKey}`,
        },
      }
    );

    return {
      id: response.data.id,
      resultUrl: response.data.result_url,
      status: response.data.status,
    };
  } catch (error) {
    console.error('[Avatar] D-ID get result error:', error);
    return null;
  }
}
