import { useEffect } from 'react';
import { useAvatar } from '../../hooks/useAvatar';
import { HologramOverlay } from './HologramOverlay';

interface AvatarDisplayProps {
  className?: string;
}

/**
 * Displays the AI avatar with hologram effects.
 * Uses simli-client WebRTC SDK to stream a realistic talking-head video,
 * or shows an animated placeholder when the avatar service is not connected.
 *
 * Designed to fill its container — set className="h-full w-full" for large display.
 */
export function AvatarDisplay({ className = '' }: AvatarDisplayProps) {
  const { isConnected, isSpeaking, isLoading, videoRef, audioRef, startAvatar, error } = useAvatar();

  // Auto-start the avatar when the component mounts and refs are attached
  useEffect(() => {
    const timer = setTimeout(() => {
      startAvatar();
    }, 800);
    return () => clearTimeout(timer);
  }, [startAvatar]);

  return (
    <HologramOverlay isActive className={className}>
      <div className="relative h-full min-h-[300px] bg-gradient-to-b from-hotel-darker via-hotel-dark to-hotel-darker flex items-center justify-center">
        {/* Video element for Simli avatar WebRTC stream */}
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          autoPlay
          playsInline
          style={{ display: isConnected ? 'block' : 'none' }}
        />

        {/* Audio element for Simli avatar audio output */}
        <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />

        {/* Placeholder when avatar is not connected */}
        {!isConnected && (
          <div className="flex flex-col items-center gap-6">
            <div className="relative w-48 h-48">
              <div className={`
                absolute inset-0 rounded-full
                bg-gradient-to-b from-hotel-accent/20 to-hotel-accent-2/20
                ${isLoading ? 'animate-pulse' : ''}
              `} />
              <div className="absolute inset-3 rounded-full bg-hotel-dark flex items-center justify-center">
                {isLoading ? (
                  <div className="animate-spin w-14 h-14 border-2 border-hotel-accent/30 border-t-hotel-accent rounded-full" />
                ) : (
                  <svg className="w-24 h-24 text-hotel-accent/40" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                  </svg>
                )}
              </div>
              {/* Speaking indicator rings */}
              {isSpeaking && (
                <>
                  <div className="absolute inset-[-12px] rounded-full border border-hotel-accent/30 animate-ping" />
                  <div className="absolute inset-[-24px] rounded-full border border-hotel-accent/15 animate-ping [animation-delay:150ms]" />
                </>
              )}
            </div>

            <div className="text-center px-4">
              <p className="text-hotel-accent/60 text-lg font-medium">
                {isLoading ? 'Connecting to avatar...' : 'AI Concierge'}
              </p>
              {error ? (
                <p className="text-hotel-text-dim text-sm mt-2 max-w-[300px]">
                  {error.includes('not configured')
                    ? 'Set VITE_SIMLI_API_KEY & VITE_SIMLI_FACE_ID in .env'
                    : error}
                </p>
              ) : !isConnected && !isLoading && (
                <p className="text-hotel-text-dim text-sm mt-2">
                  Voice-only mode active
                </p>
              )}
            </div>
          </div>
        )}

        {/* Speaking waveform indicator */}
        {isSpeaking && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-end gap-1.5 h-10">
            {[...Array(7)].map((_, i) => (
              <div
                key={i}
                className="w-1.5 bg-hotel-accent/60 rounded-full animate-pulse"
                style={{
                  height: `${16 + Math.random() * 24}px`,
                  animationDelay: `${i * 80}ms`,
                  animationDuration: '0.6s',
                }}
              />
            ))}
          </div>
        )}
      </div>
    </HologramOverlay>
  );
}
