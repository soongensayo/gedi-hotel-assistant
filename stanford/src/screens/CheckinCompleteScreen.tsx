import { useEffect } from 'react';
import { GuestPortraitShell } from '../components/GuestPortraitShell';
import type { Reservation } from '../types';

type Props = {
  reservation: Reservation | null;
  onContinue: () => void;
};

const defaultMinutesSaved = Number(
  import.meta.env.VITE_STANFORD_TIME_SAVED_MINUTES ?? 14
);

export function CheckinCompleteScreen({ reservation, onContinue }: Props) {
  const guest = reservation?.guest;
  const room = reservation?.room;
  const firstName = guest?.preferredName || guest?.firstName || 'You';
  const minutesSaved = Number.isFinite(defaultMinutesSaved)
    ? defaultMinutesSaved
    : 14;

  useEffect(() => {
    const timer = window.setTimeout(onContinue, 9000);
    return () => window.clearTimeout(timer);
  }, [onContinue]);

  return (
    <GuestPortraitShell>
      <div className="flex h-full flex-col items-center justify-center px-6 py-8 text-center">
        <div className="hotel-card-reveal w-full max-w-2xl rounded-2xl border border-[var(--color-hotel-border)] bg-[var(--guest-card-strong)] px-6 py-8 shadow-[0_24px_80px_rgba(31,106,88,0.16)]">
          <p className="text-xs uppercase tracking-[0.28em] text-[var(--color-hotel-accent)]">
            Check-in complete
          </p>
          <h1 className="mt-4 text-4xl leading-tight text-[var(--color-hotel-text)] md:text-6xl">
            Welcome in, {firstName}.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-8 text-[var(--color-hotel-text-dim)]">
            You are fully checked in and may proceed straight to your room.
          </p>

          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <SummaryCard label="Room" value={room?.roomNumber ?? 'Ready'} />
            <SummaryCard
              label="Time saved"
              value={`${minutesSaved} min`}
              detail="versus lobby check-in"
            />
            <SummaryCard label="Status" value="Key issued" />
          </div>

          <div className="mt-7 rounded-xl border border-[var(--color-hotel-border)] bg-[var(--color-hotel-accent)]/8 px-5 py-4">
            <p className="text-base leading-7 text-[var(--color-hotel-text)]">
              Your concierge has completed reservation verification, payment,
              signature, and room-key setup.
            </p>
          </div>

          <button
            type="button"
            className="mt-7 rounded-full bg-[var(--color-hotel-accent)] px-8 py-3 font-medium text-white shadow-[0_18px_44px_rgba(31,106,88,0.22)]"
            onClick={onContinue}
          >
            Continue
          </button>
        </div>
      </div>
    </GuestPortraitShell>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-hotel-border)] bg-[var(--guest-card)] px-4 py-4">
      <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-hotel-text-dim)]">
        {label}
      </p>
      <p className="mt-2 text-2xl text-[var(--color-hotel-accent)]">{value}</p>
      {detail && (
        <p className="mt-1 text-xs text-[var(--color-hotel-text-dim)]">{detail}</p>
      )}
    </div>
  );
}
