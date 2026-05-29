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
    <div className="pointer-events-auto absolute inset-0 z-20 flex bg-[#10251f]/45 p-3 backdrop-blur-[2px] md:p-4">
      {onClose && (
        <button
          type="button"
          className="absolute right-5 top-5 z-10 rounded-full border border-[var(--color-hotel-border)] bg-[var(--guest-card-strong)] px-3 py-1 text-xs text-[var(--color-hotel-text)] shadow-[0_10px_26px_rgba(16,37,31,0.12)]"
          onClick={onClose}
        >
          Minimize
        </button>
      )}
      <div className="guest-action-panel h-full w-full overflow-y-auto rounded-lg border border-[var(--color-hotel-border)] bg-[var(--color-hotel-dark)] p-5 shadow-[0_18px_70px_rgba(16,37,31,0.22)] md:p-6">
        {children}
      </div>
    </div>
  );
}
