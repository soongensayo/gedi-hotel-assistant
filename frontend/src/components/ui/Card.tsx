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
        ${onClick ? 'cursor-pointer hover:bg-white/[0.06] hover:border-hotel-accent/25' : ''}
        ${selected ? 'border-hotel-accent/40 bg-hotel-accent/8 shadow-[0_0_20px_rgba(196,162,101,0.12)]' : ''}
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
