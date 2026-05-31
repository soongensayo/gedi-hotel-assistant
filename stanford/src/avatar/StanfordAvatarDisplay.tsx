import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SimliClient,
  generateIceServers,
  generateSimliSessionToken,
} from 'simli-client';
import type { SimliAudioClient } from './useStanfordVoiceOutput';

const SIMLI_API_KEY = import.meta.env.VITE_SIMLI_API_KEY || '';
const SIMLI_FACE_ID = import.meta.env.VITE_SIMLI_FACE_ID || '';

type Props = {
  thinking: boolean;
  speaking: boolean;
  onClientChange: (client: SimliAudioClient | null, connected: boolean) => void;
};

export function StanfordAvatarDisplay({ thinking, speaking, onClientChange }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clientRef = useRef<SimliClient | null>(null);
  const startedRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startAvatar = useCallback(async () => {
    if (startedRef.current || !videoRef.current || !audioRef.current) return;
    if (!SIMLI_API_KEY || !SIMLI_FACE_ID) {
      setError('Avatar keys are not configured.');
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
        iceServers
      );

      client.on('start', () => {
        setConnected(true);
        setLoading(false);
        setError(null);
        onClientChange(client, true);
      });
      client.on('stop', () => {
        setConnected(false);
        onClientChange(null, false);
      });
      client.on('error', (detail: string) => {
        setError(`Avatar connection failed: ${detail}`);
        setConnected(false);
        setLoading(false);
        onClientChange(null, false);
      });

      clientRef.current = client;
      await client.start();
      startedRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start avatar.');
      setLoading(false);
      onClientChange(null, false);
    }
  }, [onClientChange]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void startAvatar();
    }, 500);
    return () => window.clearTimeout(timer);
  }, [startAvatar]);

  useEffect(() => {
    return () => {
      clientRef.current?.stop();
      clientRef.current = null;
      onClientChange(null, false);
    };
  }, [onClientChange]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#10251f]">
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        autoPlay
        playsInline
        muted={false}
        style={{ display: connected ? 'block' : 'none' }}
      />
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      {!connected && (
        <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_center,rgba(31,106,88,0.34),#10251f_66%)]">
          <div className="flex flex-col items-center gap-5 text-center text-white/88">
            <div className="relative flex h-40 w-40 items-center justify-center rounded-full border border-[#d3b16f]/35 bg-white/8">
              <div className={`h-24 w-24 rounded-full border border-[#d3b16f]/55 ${loading ? 'animate-pulse' : ''}`} />
              {loading && (
                <div className="absolute h-32 w-32 animate-spin rounded-full border-2 border-transparent border-t-[#d3b16f]" />
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-[#d3b16f]">
                AI avatar concierge
              </p>
              <p className="mt-2 text-sm text-white/70">
                {loading ? 'Connecting avatar...' : error ?? 'Voice mode is ready.'}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(16,37,31,0.34),transparent_38%,rgba(16,37,31,0.64))]" />

      {(thinking || speaking) && (
        <div className="absolute bottom-7 left-1/2 flex -translate-x-1/2 items-end gap-1.5">
          {[0, 1, 2, 3, 4].map((bar) => (
            <span
              key={bar}
              className="w-1.5 rounded-full bg-[#d3b16f]/80"
              style={{
                height: `${speaking ? 18 + ((bar % 3) * 8) : 8}px`,
                animation: 'avatar-eq 820ms ease-in-out infinite',
                animationDelay: `${bar * 95}ms`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
