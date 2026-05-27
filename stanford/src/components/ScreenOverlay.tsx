import type { ReactNode } from 'react';

type Props = {
  open: boolean;
  children: ReactNode;
  onClose?: () => void;
};

/** Slide-up panel over video */
export function ScreenOverlay({ open, children, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="pointer-events-auto absolute inset-0 z-20 flex flex-col justify-end bg-black/45">
      {onClose && (
        <button
          type="button"
          className="absolute right-4 top-4 rounded-full border border-white/20 px-3 py-1 text-xs text-white/80"
          onClick={onClose}
        >
          Minimize
        </button>
      )}
      <div className="max-h-[calc(100%-1.5rem)] overflow-y-auto rounded-t-2xl border border-[var(--color-hotel-border)] border-b-0 bg-[var(--color-hotel-dark)] p-5 shadow-2xl md:p-6">
        {children}
      </div>
    </div>
  );
}
