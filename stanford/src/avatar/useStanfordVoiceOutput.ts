import { useCallback, useRef, useState } from 'react';
import { synthesizeSpeech } from '../services/api';
import { decodeToPCM16, sendPCM16ToSimli, splitIntoSentences } from './audioUtils';

export type SimliAudioClient = {
  sendAudioData: (data: Uint8Array) => void;
  ClearBuffer?: () => void;
};

type Options = {
  getAvatarClient: () => SimliAudioClient | null;
  isAvatarConnected: () => boolean;
};

export function useStanfordVoiceOutput({ getAvatarClient, isAvatarConnected }: Options) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    const client = getAvatarClient();
    if (client && isAvatarConnected()) client.ClearBuffer?.();
    setIsSpeaking(false);
  }, [getAvatarClient, isAvatarConnected]);

  const speak = useCallback(
    async (text: string) => {
      stop();
      const controller = new AbortController();
      abortRef.current = controller;
      const signal = controller.signal;
      setIsSpeaking(true);

      try {
        const client = getAvatarClient();
        if (client && isAvatarConnected()) {
          const chunks: Uint8Array[] = [];
          for (const sentence of splitIntoSentences(text)) {
            if (signal.aborted) return;
            const audioBlob = await synthesizeSpeech(sentence);
            const arrayBuffer = await audioBlob.arrayBuffer();
            chunks.push(await decodeToPCM16(arrayBuffer, 16000));
          }

          if (signal.aborted) return;
          const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
          const combined = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }
          sendPCM16ToSimli(client, combined);
          timeoutRef.current = window.setTimeout(() => {
            timeoutRef.current = null;
            setIsSpeaking(false);
          }, (totalLength / 32000) * 1000 + 600);
          return;
        }

        const audioBlob = await synthesizeSpeech(text);
        if (signal.aborted) return;
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        const cleanup = () => {
          URL.revokeObjectURL(audioUrl);
          setIsSpeaking(false);
        };
        audio.onended = cleanup;
        audio.onerror = cleanup;
        await audio.play();
      } catch (error) {
        if (!signal.aborted) {
          console.error('[Stanford Avatar Voice] TTS failed:', error);
          setIsSpeaking(false);
        }
      }
    },
    [getAvatarClient, isAvatarConnected, stop]
  );

  return { isSpeaking, speak, stop };
}
