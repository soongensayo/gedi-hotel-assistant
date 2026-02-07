import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  onClick?: () => void;
  selected?: boolean;
}

export function Card({ children, className = '', glow, onClick, selected }: CardProps) {
  return (
    <div
      className={`
        glass-panel p-6 transition-all duration-300
        ${glow ? 'glow-pulse' : ''}
        ${onClick ? 'cursor-pointer hover:bg-white/[0.08] hover:border-hotel-accent/30' : ''}
        ${selected ? 'border-hotel-accent/50 bg-hotel-accent/10 shadow-[0_0_20px_rgba(0,212,255,0.2)]' : ''}
        ${className}
      `}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </div>
  );
}
