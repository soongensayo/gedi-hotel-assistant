import { useState, useRef, useCallback } from 'react';
import { synthesizeSpeech } from '../services/api';
import { useConversationStore } from '../stores/conversationStore';
import { useAvatarStore } from '../stores/avatarStore';
import { decodeToPCM16, sendPCM16ToSimli } from '../utils/audioUtils';

interface UseVoiceOutputReturn {
  isSpeaking: boolean;
  speak: (text: string) => Promise<void>;
  stop: () => void;
}

/**
 * Hook for text-to-speech output.
 *
 * When the Simli avatar is connected:
 *   - Decodes TTS audio (MP3) → PCM16
 *   - Sends PCM16 to Simli for lip-sync
 *   - Simli handles audio playback through its <audio> element
 *
 * When avatar is NOT connected:
 *   - Plays audio through a regular Audio element (fallback)
 */
export function useVoiceOutput(): UseVoiceOutputReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const setSpeaking = useConversationStore((s) => s.setSpeaking);

  const speak = useCallback(async (text: string) => {
    try {
      setIsSpeaking(true);
      setSpeaking(true);

      // Get TTS audio from backend (returns MP3 blob)
      const audioBlob = await synthesizeSpeech(text);
      const arrayBuffer = await audioBlob.arrayBuffer();

      // Check if avatar is connected
      const { client, isConnected } = useAvatarStore.getState();

      if (client && isConnected) {
        // --- Avatar path: decode MP3 → PCM16, send to Simli for lip-sync ---
        console.log('[VoiceOutput] Avatar connected — sending audio to Simli for lip-sync');

        try {
          const pcm16Data = await decodeToPCM16(arrayBuffer, 16000);
          console.log(`[VoiceOutput] Decoded ${pcm16Data.length} bytes of PCM16 audio`);

          // Send PCM16 chunks to Simli — it will play audio AND animate the avatar
          sendPCM16ToSimli(client, pcm16Data);

          // Estimate playback duration from PCM length
          // PCM16 at 16kHz = 32000 bytes/sec
          const durationMs = (pcm16Data.length / 32000) * 1000;

          // Wait for roughly the duration of the speech, then mark as done
          setTimeout(() => {
            setIsSpeaking(false);
            setSpeaking(false);
          }, durationMs + 500); // +500ms buffer for network latency
        } catch (decodeErr) {
          console.warn('[VoiceOutput] PCM decode failed, falling back to local playback:', decodeErr);
          // Fallback: play through regular Audio element
          playLocalAudio(arrayBuffer);
        }
      } else {
        // --- Fallback path: play through regular Audio element ---
        console.log('[VoiceOutput] Avatar not connected — playing audio locally');
        playLocalAudio(arrayBuffer);
      }
    } catch (err) {
      console.error('[VoiceOutput] TTS failed:', err);
      setIsSpeaking(false);
      setSpeaking(false);
    }

    function playLocalAudio(buffer: ArrayBuffer) {
      const blob = new Blob([buffer], { type: 'audio/mpeg' });
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        setIsSpeaking(false);
        setSpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = () => {
        setIsSpeaking(false);
        setSpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };

      audio.play().catch(() => {
        setIsSpeaking(false);
        setSpeaking(false);
      });
    }
  }, [setSpeaking]);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    // Also clear the Simli buffer if avatar is connected
    const { client, isConnected } = useAvatarStore.getState();
    if (client && isConnected) {
      client.ClearBuffer();
    }
    setIsSpeaking(false);
    setSpeaking(false);
  }, [setSpeaking]);

  return { isSpeaking, speak, stop };
}
