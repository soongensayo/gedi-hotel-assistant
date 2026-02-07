import { useRef, useCallback, useEffect } from 'react';
import { SimliClient } from 'simli-client';
import { useAvatarStore } from '../stores/avatarStore';

// Read Simli config from Vite env vars
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
 * Hook that manages the Simli avatar lifecycle.
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

  // Create the SimliClient instance once on mount
  useEffect(() => {
    if (!SIMLI_API_KEY || !SIMLI_FACE_ID) {
      console.warn('[Avatar] VITE_SIMLI_API_KEY or VITE_SIMLI_FACE_ID not set in .env');
      setError('Simli keys not configured — add VITE_SIMLI_API_KEY and VITE_SIMLI_FACE_ID to .env');
      return;
    }

    const client = new SimliClient();
    setClient(client);

    client.on('connected', () => {
      console.log('[Avatar] Simli WebRTC connected');
      setConnected(true);
      setLoading(false);
      setError(null);
    });

    client.on('disconnected', () => {
      console.log('[Avatar] Simli disconnected');
      setConnected(false);
      setSpeaking(false);
    });

    client.on('failed', (reason: string) => {
      console.error('[Avatar] Simli failed:', reason);
      setError(`Avatar connection failed: ${reason}`);
      setConnected(false);
      setLoading(false);
    });

    client.on('speaking', () => {
      setSpeaking(true);
    });

    client.on('silent', () => {
      setSpeaking(false);
    });

    return () => {
      client.close();
      reset();
      initializedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startAvatar = useCallback(async () => {
    const client = useAvatarStore.getState().client;
    if (!client || !videoRef.current || !audioRef.current) {
      console.warn('[Avatar] Cannot start: client or refs not ready');
      return;
    }

    if (initializedRef.current) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      client.Initialize({
        apiKey: SIMLI_API_KEY,
        faceID: SIMLI_FACE_ID,
        handleSilence: true,
        maxSessionLength: 3600,
        maxIdleTime: 600,
        session_token: '',
        videoRef: videoRef.current,
        audioRef: audioRef.current,
        enableConsoleLogs: true,
        SimliURL: '',
        maxRetryAttempts: 3,
        retryDelay_ms: 2000,
        videoReceivedTimeout: 15000,
        enableSFU: true,
        model: 'fasttalk',
      });

      await client.start();
      initializedRef.current = true;
    } catch (err) {
      console.error('[Avatar] Start error:', err);
      setError(`Failed to start avatar: ${err instanceof Error ? err.message : String(err)}`);
      setLoading(false);
    }
  }, [setLoading, setError]);

  const stopAvatar = useCallback(() => {
    const client = useAvatarStore.getState().client;
    if (client) {
      client.close();
      initializedRef.current = false;
      setConnected(false);
      setSpeaking(false);
    }
  }, [setConnected, setSpeaking]);

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
