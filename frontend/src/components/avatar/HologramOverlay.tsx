import type { ReactNode } from 'react';

interface HologramOverlayProps {
  children: ReactNode;
  isActive?: boolean;
  className?: string;
}

/**
 * Wraps content with holographic visual effects:
 * scan lines, glow, flicker, and blue tint
 */
export function HologramOverlay({ children, isActive = true, className = '' }: HologramOverlayProps) {
  return (
    <div
      className={`
        relative overflow-hidden rounded-2xl
        ${isActive ? 'hologram-flicker' : ''}
        ${className}
      `}
    >
      {/* Warm glow border */}
      <div className="absolute inset-0 rounded-2xl border border-hotel-accent/12 shadow-[0_0_30px_rgba(196,162,101,0.08),inset_0_0_30px_rgba(196,162,101,0.03)] pointer-events-none z-20" />

      {/* Scan lines */}
      {isActive && <div className="hologram-scanlines rounded-2xl" />}

      {/* Warm color grading overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-hotel-accent/3 via-transparent to-hotel-accent/5 pointer-events-none z-10 rounded-2xl" />

      {/* Top edge glow */}
      <div className="absolute top-0 left-1/4 right-1/4 h-px bg-gradient-to-r from-transparent via-hotel-accent/30 to-transparent pointer-events-none z-20" />

      {/* Content */}
      <div className="relative z-5 h-full">
        {children}
      </div>
    </div>
  );
}
