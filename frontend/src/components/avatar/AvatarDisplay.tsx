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
      <div className="relative aspect-[3/4] bg-gradient-to-b from-hotel-darker via-hotel-dark to-hotel-darker flex items-center justify-center">
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
          <div className="flex flex-col items-center gap-4">
            <div className="relative w-32 h-32">
              <div className={`
                absolute inset-0 rounded-full
                bg-gradient-to-b from-hotel-accent/20 to-hotel-accent-2/20
                ${isLoading ? 'animate-pulse' : ''}
              `} />
              <div className="absolute inset-2 rounded-full bg-hotel-dark flex items-center justify-center">
                {isLoading ? (
                  <div className="animate-spin w-10 h-10 border-2 border-hotel-accent/30 border-t-hotel-accent rounded-full" />
                ) : (
                  <svg className="w-16 h-16 text-hotel-accent/40" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                  </svg>
                )}
              </div>
              {/* Speaking indicator rings */}
              {isSpeaking && (
                <>
                  <div className="absolute inset-[-8px] rounded-full border border-hotel-accent/30 animate-ping" />
                  <div className="absolute inset-[-16px] rounded-full border border-hotel-accent/15 animate-ping [animation-delay:150ms]" />
                </>
              )}
            </div>

            <div className="text-center px-4">
              <p className="text-hotel-accent/60 text-sm font-medium">
                {isLoading ? 'Connecting to avatar...' : 'AI Concierge'}
              </p>
              {error ? (
                <p className="text-hotel-text-dim text-xs mt-1 max-w-[200px]">
                  {error.includes('not configured')
                    ? 'Set VITE_SIMLI_API_KEY & VITE_SIMLI_FACE_ID in .env'
                    : error}
                </p>
              ) : !isConnected && !isLoading && (
                <p className="text-hotel-text-dim text-xs mt-1">
                  Voice-only mode active
                </p>
              )}
            </div>
          </div>
        )}

        {/* Speaking waveform indicator */}
        {isSpeaking && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-end gap-1 h-8">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="w-1 bg-hotel-accent/60 rounded-full animate-pulse"
                style={{
                  height: `${12 + Math.random() * 20}px`,
                  animationDelay: `${i * 100}ms`,
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
