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
  const speakAbortRef = useRef<AbortController | null>(null);
  const speakTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setSpeaking = useConversationStore((s) => s.setSpeaking);

  const speak = useCallback(async (text: string) => {
    // Abort any in-flight speak
    speakAbortRef.current?.abort();
    const controller = new AbortController();
    speakAbortRef.current = controller;
    const signal = controller.signal;

    try {
      setIsSpeaking(true);
      setSpeaking(true);

      // Check if avatar is connected
      const { client, isConnected } = useAvatarStore.getState();

      if (client && isConnected) {
        // ────────────────────────────────────────────────────
        // OPTIMISED AVATAR PATH
        // Split into sentences → parallel TTS → stream to Simli in order
        // Falls back to local audio if Simli streaming fails
        // ────────────────────────────────────────────────────
        const sentences = splitIntoSentences(text);
        console.log(`[VoiceOutput] Parallel TTS for ${sentences.length} sentence(s)`);

        const ttsPromises = sentences.map((sentence) => synthesizeSpeech(sentence));

        let totalPCMBytes = 0;
        let simliFailed = false;

        for (let i = 0; i < ttsPromises.length; i++) {
          if (signal.aborted) {
            console.log(`[VoiceOutput] Interrupted, stopping after sentence ${i}`);
            return;
          }

          if (simliFailed) break;

          try {
            const audioBlob = await ttsPromises[i];
            if (signal.aborted) return;
            const arrayBuffer = await audioBlob.arrayBuffer();
            const pcm16Data = await decodeToPCM16(arrayBuffer, 16000);
            if (signal.aborted) return;

            sendPCM16ToSimli(client, pcm16Data);
            totalPCMBytes += pcm16Data.length;

            console.log(
              `[VoiceOutput] ✓ Sentence ${i + 1}/${sentences.length} sent ` +
              `(${pcm16Data.length} bytes)`
            );
          } catch (err) {
            if (signal.aborted) return;
            console.warn(`[VoiceOutput] Simli send failed at sentence ${i + 1}, falling back to local audio`);
            simliFailed = true;
          }
        }

        if (signal.aborted) return;

        if (simliFailed) {
          console.log('[VoiceOutput] Simli unavailable — replaying full text via local audio');
          const audioBlob = await synthesizeSpeech(text);
          if (signal.aborted) return;
          const arrayBuffer = await audioBlob.arrayBuffer();
          if (signal.aborted) return;
          playLocalAudio(arrayBuffer);
          return;
        }

        // PCM16 @ 16 kHz = 32 000 bytes / sec
        const durationMs = (totalPCMBytes / 32000) * 1000;
        speakTimeoutRef.current = setTimeout(() => {
          speakTimeoutRef.current = null;
          setIsSpeaking(false);
          setSpeaking(false);
        }, durationMs + 500);

      } else {
        // ────────────────────────────────────────────────────
        // FALLBACK PATH — no avatar, play through <audio>
        // ────────────────────────────────────────────────────
        console.log('[VoiceOutput] Avatar not connected — playing audio locally');
        const audioBlob = await synthesizeSpeech(text);
        if (signal.aborted) return;
        const arrayBuffer = await audioBlob.arrayBuffer();
        if (signal.aborted) return;
        playLocalAudio(arrayBuffer);
      }
    } catch (err) {
      if (signal.aborted) return;
      console.error('[VoiceOutput] TTS failed:', err);
      setIsSpeaking(false);
      setSpeaking(false);
    }

    function playLocalAudio(buffer: ArrayBuffer) {
      const blob = new Blob([buffer], { type: 'audio/mpeg' });
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      audio.volume = 1.0;
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
    speakAbortRef.current?.abort();
    speakAbortRef.current = null;
    if (speakTimeoutRef.current) {
      clearTimeout(speakTimeoutRef.current);
      speakTimeoutRef.current = null;
    }
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
