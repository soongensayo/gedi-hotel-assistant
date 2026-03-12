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
        // AVATAR PATH
        // Parallel TTS fetch → decode all → concatenate into one
        // continuous PCM buffer → send to Simli as a single stream.
        // This avoids inter-sentence gaps that cause SPEAK/SILENT stutter.
        // Falls back to local audio if Simli streaming fails.
        // ────────────────────────────────────────────────────
        const sentences = splitIntoSentences(text);
        console.log(`[VoiceOutput] Parallel TTS for ${sentences.length} sentence(s)`);

        const ttsPromises = sentences.map((s) => synthesizeSpeech(s));
        const pcmChunks: Uint8Array[] = [];

        for (let i = 0; i < ttsPromises.length; i++) {
          if (signal.aborted) return;
          try {
            const audioBlob = await ttsPromises[i];
            if (signal.aborted) return;
            const arrayBuffer = await audioBlob.arrayBuffer();
            const pcm16Data = await decodeToPCM16(arrayBuffer, 16000);
            pcmChunks.push(pcm16Data);
            console.log(
              `[VoiceOutput] ✓ Decoded sentence ${i + 1}/${sentences.length} ` +
              `(${pcm16Data.length} bytes)`
            );
          } catch (err) {
            if (signal.aborted) return;
            console.warn(`[VoiceOutput] Decode failed for sentence ${i + 1}, skipping`);
          }
        }

        if (signal.aborted) return;

        if (pcmChunks.length === 0) {
          console.log('[VoiceOutput] All decodes failed — falling back to local audio');
          const audioBlob = await synthesizeSpeech(text);
          if (signal.aborted) return;
          const arrayBuffer = await audioBlob.arrayBuffer();
          if (signal.aborted) return;
          playLocalAudio(arrayBuffer);
          return;
        }

        const totalLen = pcmChunks.reduce((sum, c) => sum + c.length, 0);
        const combined = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of pcmChunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }

        console.log(`[VoiceOutput] Sending ${totalLen} bytes as one continuous stream`);
        try {
          sendPCM16ToSimli(client, combined);
        } catch (err) {
          console.warn('[VoiceOutput] Simli send failed — falling back to local audio');
          const audioBlob = await synthesizeSpeech(text);
          if (signal.aborted) return;
          const arrayBuffer = await audioBlob.arrayBuffer();
          if (signal.aborted) return;
          playLocalAudio(arrayBuffer);
          return;
        }

        // PCM16 @ 16 kHz = 32 000 bytes / sec
        const durationMs = (totalLen / 32000) * 1000;
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
      audioRef.current = audio;

      const cleanup = () => {
        setIsSpeaking(false);
        setSpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };

      audio.onended = cleanup;
      audio.onerror = cleanup;

      // Route through Web Audio GainNode so we can amplify beyond 1.0.
      // HTMLAudioElement.volume caps at 1.0 which isn't loud enough for
      // OpenAI tts-1 output compared to typical media.
      try {
        const ctx = new AudioContext();
        const source = ctx.createMediaElementSource(audio);
        const gain = ctx.createGain();
        gain.gain.value = 2.0;
        source.connect(gain).connect(ctx.destination);
      } catch {
        audio.volume = 1.0;
      }

      audio.play().catch(cleanup);
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
