import type { StaffEventLogEntry } from '../types';

type Props = {
  entries: StaffEventLogEntry[];
};

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('en-SG', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function eventLabel(e: StaffEventLogEntry['event']): string {
  switch (e.type) {
    case 'screen_changed':
      return `Screen → ${e.screen} (${e.phase})`;
    case 'reservation_confirmed':
      return `Reservation confirmed: ${e.reservationId}`;
    case 'passport_scanned':
      return e.passportNumber
        ? `Passport scanned: ${e.passportNumber}`
        : e.photoDataUrl
          ? 'Passport photo captured'
          : 'Passport scan skipped';
    case 'payment_complete':
      return 'Payment complete';
    case 'signature_submitted':
      return 'Signature submitted';
    case 'key_card_received':
      return 'Key card acknowledged';
    case 'preferences_submitted':
      return `Preferences: ${e.temperature}°C, ${e.pillows}${e.celebration ? `, ${e.celebration}` : ''}`;
    case 'service_selected':
      return `Service: ${e.label}`;
    case 'luggage_info':
      return `Luggage: ${e.count} bag${e.count !== 1 ? 's' : ''}${e.needsHelp ? ' (help requested)' : ''}`;
    case 'call_concierge':
      return 'Guest requesting concierge';
    default:
      return (e as { type: string }).type;
  }
}

export function EventLog({ entries }: Props) {
  if (entries.length === 0) {
    return (
      <p className="py-2 text-center text-xs text-[var(--color-hotel-text-dim)]">
        No events yet — waiting for guest.
      </p>
    );
  }

  return (
    <div className="max-h-40 overflow-y-auto">
      <ul className="space-y-1 text-xs">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex gap-2 rounded border border-transparent px-1 py-0.5 text-white/70 hover:border-[var(--color-hotel-border)]"
          >
            <span className="shrink-0 font-mono text-[var(--color-hotel-text-dim)]">
              {formatTime(entry.ts)}
            </span>
            <span className="min-w-0 break-words">{eventLabel(entry.event)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
