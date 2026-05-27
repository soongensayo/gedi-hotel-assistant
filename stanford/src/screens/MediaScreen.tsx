import { GuestPortraitShell } from '../components/GuestPortraitShell';

type Props = {
  onCallConcierge: () => void;
};

export function MediaScreen({ onCallConcierge }: Props) {
  return (
    <GuestPortraitShell>
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 justify-center gap-2 border-b border-[var(--color-hotel-border)] p-3">
          <button
            type="button"
            className="rounded-lg bg-[var(--color-hotel-accent)] px-4 py-2 text-sm text-white"
          >
            Music
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden p-4">
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-[var(--color-hotel-text-dim)]">Now playing</p>
            <p className="mt-2 text-2xl text-[var(--color-hotel-accent)]">Jazz Essentials</p>
          </div>
        </div>

        <div className="shrink-0 p-6">
          <button
            type="button"
            className="w-full animate-pulse rounded-full border border-[var(--color-hotel-accent)] bg-[var(--color-hotel-accent)] py-4 font-medium text-white shadow-[0_18px_44px_rgba(31,106,88,0.22)]"
            onClick={onCallConcierge}
          >
            Call Concierge
          </button>
        </div>
      </div>
    </GuestPortraitShell>
  );
}
