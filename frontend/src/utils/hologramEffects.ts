/**
 * Hologram visual effect utilities for the kiosk display.
 * Used for laptop dev mode. On Jetson + Pepper's Ghost display,
 * these effects enhance the transparent panel appearance.
 */

/** CSS class combinations for holographic elements */
export const hologramStyles = {
  /** Main avatar container */
  avatarContainer: [
    'relative',
    'rounded-2xl',
    'overflow-hidden',
    'glow-pulse',
    'hologram-flicker',
  ].join(' '),

  /** Glass panel with blur */
  glassPanel: [
    'glass-panel',
    'p-6',
  ].join(' '),

  /** Accent glow border */
  accentBorder: [
    'border',
    'border-hotel-accent/20',
    'shadow-[0_0_15px_rgba(196,162,101,0.1)]',
  ].join(' '),

  /** Text with glow effect */
  glowText: [
    'text-hotel-accent',
    'drop-shadow-[0_0_8px_rgba(196,162,101,0.3)]',
  ].join(' '),
};

/**
 * Generate random flicker timing for hologram effect
 */
export function getRandomFlickerDelay(): string {
  return `${2 + Math.random() * 4}s`;
}

/**
 * Calculate a pulsing opacity value based on timestamp
 */
export function getPulseOpacity(timestamp: number, speed = 0.002): number {
  return 0.7 + 0.3 * Math.sin(timestamp * speed);
}
