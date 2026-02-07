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
      {/* Holographic glow border */}
      <div className="absolute inset-0 rounded-2xl border border-hotel-accent/20 shadow-[0_0_30px_rgba(0,212,255,0.15),inset_0_0_30px_rgba(0,212,255,0.05)] pointer-events-none z-20" />

      {/* Scan lines */}
      {isActive && <div className="hologram-scanlines rounded-2xl" />}

      {/* Blue color grading overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-hotel-accent/5 via-transparent to-hotel-accent/10 pointer-events-none z-10 rounded-2xl" />

      {/* Top edge glow */}
      <div className="absolute top-0 left-1/4 right-1/4 h-px bg-gradient-to-r from-transparent via-hotel-accent/50 to-transparent pointer-events-none z-20" />

      {/* Content */}
      <div className="relative z-5">
        {children}
      </div>
    </div>
  );
}
