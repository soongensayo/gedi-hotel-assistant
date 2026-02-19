import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'gold';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  isLoading?: boolean;
}

const variantStyles = {
  primary:
    'bg-hotel-accent/15 text-hotel-accent border border-hotel-accent/30 hover:bg-hotel-accent/25 hover:border-hotel-accent/50 shadow-[0_0_15px_rgba(196,162,101,0.1)]',
  secondary:
    'bg-white/5 text-hotel-text border border-white/10 hover:bg-white/10 hover:border-white/20',
  ghost:
    'bg-transparent text-hotel-text-dim hover:text-hotel-text hover:bg-white/5',
  gold:
    'bg-hotel-gold/15 text-hotel-gold border border-hotel-gold/30 hover:bg-hotel-gold/25 hover:border-hotel-gold/50 shadow-[0_0_15px_rgba(212,176,122,0.1)]',
};

const sizeStyles = {
  sm: 'px-4 py-2 text-sm rounded-lg',
  md: 'px-6 py-3 text-base rounded-xl',
  lg: 'px-8 py-4 text-lg rounded-xl',
};

export function Button({
  variant = 'primary',
  size = 'md',
  children,
  isLoading,
  disabled,
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      className={`
        font-medium transition-all duration-200 active:scale-[0.97]
        disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100
        ${variantStyles[variant]}
        ${sizeStyles[size]}
        ${className}
      `}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="flex items-center gap-2">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Processing...
        </span>
      ) : (
        children
      )}
    </button>
  );
}
