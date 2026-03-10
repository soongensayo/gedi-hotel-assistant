import { useRef, useCallback, useEffect } from 'react';
import { SimliClient, generateSimliSessionToken, generateIceServers } from 'simli-client';
import { useAvatarStore } from '../stores/avatarStore';

const SIMLI_API_KEY = import.meta.env.VITE_SIMLI_API_KEY || '';
const SIMLI_FACE_ID = import.meta.env.VITE_SIMLI_FACE_ID || '';

interface UseAvatarReturn {
  isConnected: boolean;
  isSpeaking: boolean;
  isLoading: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  startAvatar: () => Promise<void>;
  stopAvatar: () => void;
  error: string | null;
}

/**
 * Hook that manages the Simli avatar lifecycle (v3 SDK).
 * Should be used by AvatarDisplay only (owns the video/audio refs).
 * Other components should use useAvatarStore directly to access the client.
 */
export function useAvatar(): UseAvatarReturn {
  const {
    isConnected, isSpeaking, isLoading, error,
    setClient, setConnected, setSpeaking, setLoading, setError, reset,
  } = useAvatarStore();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const initializedRef = useRef(false);

  const startAvatar = useCallback(async () => {
    if (!videoRef.current || !audioRef.current) {
      console.warn('[Avatar] Cannot start: video/audio refs not ready');
      return;
    }

    if (initializedRef.current) {
      return;
    }

    if (!SIMLI_API_KEY || !SIMLI_FACE_ID) {
      setError('Simli keys not configured — add VITE_SIMLI_API_KEY and VITE_SIMLI_FACE_ID to .env');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [tokenResult, iceServers] = await Promise.all([
        generateSimliSessionToken({
          apiKey: SIMLI_API_KEY,
          config: {
            faceId: SIMLI_FACE_ID,
            handleSilence: true,
            maxSessionLength: 3600,
            maxIdleTime: 600,
            model: 'fasttalk',
          },
        }),
        generateIceServers(SIMLI_API_KEY),
      ]);

      const client = new SimliClient(
        tokenResult.session_token,
        videoRef.current,
        audioRef.current,
        iceServers,
      );

      client.on('start', () => {
        console.log('[Avatar] Simli WebRTC connected');
        setConnected(true);
        setLoading(false);
        setError(null);
      });

      client.on('stop', () => {
        console.log('[Avatar] Simli disconnected');
        setConnected(false);
        setSpeaking(false);
      });

      client.on('error', (detail: string) => {
        console.error('[Avatar] Simli error:', detail);
        setError(`Avatar connection failed: ${detail}`);
        setConnected(false);
        setLoading(false);
      });

      client.on('speaking', () => {
        setSpeaking(true);
      });

      client.on('silent', () => {
        setSpeaking(false);
      });

      setClient(client);
      await client.start();
      initializedRef.current = true;
    } catch (err) {
      console.error('[Avatar] Start error:', err);
      setError(`Failed to start avatar: ${err instanceof Error ? err.message : String(err)}`);
      setLoading(false);
    }
  }, [setClient, setConnected, setSpeaking, setLoading, setError]);

  const stopAvatar = useCallback(() => {
    const client = useAvatarStore.getState().client;
    if (client) {
      client.stop();
      initializedRef.current = false;
      setConnected(false);
      setSpeaking(false);
    }
  }, [setConnected, setSpeaking]);

  useEffect(() => {
    return () => {
      const client = useAvatarStore.getState().client;
      if (client) {
        client.stop();
      }
      reset();
      initializedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isConnected,
    isSpeaking,
    isLoading,
    videoRef,
    audioRef,
    startAvatar,
    stopAvatar,
    error,
  };
}
