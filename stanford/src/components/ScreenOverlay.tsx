import type { ReactNode } from 'react';

type Props = {
  open: boolean;
  children: ReactNode;
  onClose?: () => void;
};

/** Staff-pushed guest step, bounded to its parent surface. */
export function ScreenOverlay({ open, children, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="screen-overlay-enter pointer-events-none absolute inset-0 z-20 flex items-end bg-[#10251f]/36 p-2 backdrop-blur-[2px] md:p-4">
      {onClose && (
        <button
          type="button"
          className="absolute right-5 top-5 z-10 rounded-full border border-[var(--color-hotel-border)] bg-[var(--guest-card-strong)] px-3 py-1 text-xs text-[var(--color-hotel-text)] shadow-[0_10px_26px_rgba(16,37,31,0.12)]"
          onClick={onClose}
        >
          Minimize
        </button>
      )}
      <div className="guest-action-panel screen-panel-enter pointer-events-auto h-[72dvh] max-h-[520px] w-full overflow-hidden rounded-lg border border-[var(--color-hotel-border)] bg-[var(--color-hotel-dark)] p-4 shadow-[0_18px_70px_rgba(16,37,31,0.22)] md:p-5">
        {children}
      </div>
    </div>
  );
}
