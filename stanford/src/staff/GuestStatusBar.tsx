import type { GuestPhase, GuestScreenId, GuestToStaffEvent } from '../types';

type Props = {
  guestPhase: GuestPhase | null;
  guestScreen: GuestScreenId | null;
  lastEvent: GuestToStaffEvent | null;
};

export function GuestStatusBar({ guestPhase, guestScreen, lastEvent }: Props) {
  return (
    <div className="rounded-lg border border-[var(--color-hotel-border)] bg-[var(--staff-surface)] p-3 text-xs shadow-sm">
      <p className="text-[var(--color-hotel-text-dim)]">Guest tablet</p>
      <p className="mt-1 font-mono text-[var(--color-hotel-accent)]">
        phase: {guestPhase ?? '—'} · screen: {guestScreen ?? '—'}
      </p>
      {lastEvent && (
        <p className="mt-2 break-all text-[var(--color-hotel-text)]">
          last: {lastEvent.type}
          {lastEvent.type === 'reservation_confirmed' &&
            ` · ${lastEvent.reservationId}`}
          {lastEvent.type === 'passport_scanned' &&
            ` · ${lastEvent.passportNumber ?? 'n/a'}`}
          {lastEvent.type === 'service_selected' && ` · ${lastEvent.label}`}
          {lastEvent.type === 'luggage_info' &&
            ` · bags ${lastEvent.count} help=${String(lastEvent.needsHelp)}`}
        </p>
      )}
    </div>
  );
}
