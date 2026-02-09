import { useState, useRef, useCallback } from 'react';
import { synthesizeSpeech } from '../services/api';
import { useConversationStore } from '../stores/conversationStore';
import { useAvatarStore } from '../stores/avatarStore';
import { decodeToPCM16, sendPCM16ToSimli, splitIntoSentences } from '../utils/audioUtils';

interface UseVoiceOutputReturn {
  isSpeaking: boolean;
  speak: (text: string) => Promise<void>;
  stop: () => void;
}

/**
 * Hook for text-to-speech output.
 *
 * When the Simli avatar is connected:
 *   - Splits the reply into sentences
 *   - Fires TTS for ALL sentences in parallel (shorter sentences return faster)
 *   - Sends each sentence's PCM16 audio to Simli **in order** as it arrives
 *   → Avatar starts speaking after the *first* sentence is ready, not the entire reply
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

      // Check if avatar is connected
      const { client, isConnected } = useAvatarStore.getState();

      if (client && isConnected) {
        // ────────────────────────────────────────────────────
        // OPTIMISED AVATAR PATH
        // Split into sentences → parallel TTS → stream to Simli in order
        // ────────────────────────────────────────────────────
        const sentences = splitIntoSentences(text);
        console.log(`[VoiceOutput] Parallel TTS for ${sentences.length} sentence(s)`);

        // Fire ALL TTS requests at once — shorter sentences return sooner
        const ttsPromises = sentences.map((sentence) => synthesizeSpeech(sentence));

        let totalPCMBytes = 0;

        // Await results **in order** so Simli receives audio sequentially.
        // Because requests were fired in parallel, sentence 2 may already
        // be resolved by the time sentence 1 finishes decoding.
        for (let i = 0; i < ttsPromises.length; i++) {
          try {
            const audioBlob = await ttsPromises[i];
            const arrayBuffer = await audioBlob.arrayBuffer();
            const pcm16Data = await decodeToPCM16(arrayBuffer, 16000);

            sendPCM16ToSimli(client, pcm16Data);
            totalPCMBytes += pcm16Data.length;

            console.log(
              `[VoiceOutput] ✓ Sentence ${i + 1}/${sentences.length} sent ` +
              `(${pcm16Data.length} bytes)`
            );
          } catch (err) {
            console.warn(`[VoiceOutput] Sentence ${i + 1} failed, skipping:`, err);
          }
        }

        // Estimate remaining playback duration from total PCM sent
        // PCM16 @ 16 kHz = 32 000 bytes / sec
        const durationMs = (totalPCMBytes / 32000) * 1000;

        setTimeout(() => {
          setIsSpeaking(false);
          setSpeaking(false);
        }, durationMs + 500);

      } else {
        // ────────────────────────────────────────────────────
        // FALLBACK PATH — no avatar, play through <audio>
        // ────────────────────────────────────────────────────
        console.log('[VoiceOutput] Avatar not connected — playing audio locally');
        const audioBlob = await synthesizeSpeech(text);
        const arrayBuffer = await audioBlob.arrayBuffer();
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
