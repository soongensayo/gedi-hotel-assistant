import type { GuestPhase, GuestScreenId, GuestToStaffEvent } from '../types';

const FLOW_STEPS: { screen: GuestScreenId; label: string }[] = [
  { screen: 'video-only', label: 'Video call' },
  { screen: 'reservation', label: 'Reservation' },
  { screen: 'passport', label: 'Passport' },
  { screen: 'payment', label: 'Payment' },
  { screen: 'signature', label: 'Signature' },
  { screen: 'key-card', label: 'Key card' },
  { screen: 'personalization', label: 'Personalize' },
  { screen: 'services', label: 'Services' },
  { screen: 'property-tour', label: 'Tour' },
  { screen: 'luggage', label: 'Luggage' },
];

const COMPLETED_EVENTS: Record<string, GuestToStaffEvent['type']> = {
  reservation: 'reservation_confirmed',
  passport: 'passport_scanned',
  payment: 'payment_complete',
  signature: 'signature_submitted',
  'key-card': 'key_card_received',
  personalization: 'preferences_submitted',
  services: 'service_selected',
  luggage: 'luggage_info',
};

type Props = {
  guestPhase: GuestPhase | null;
  guestScreen: GuestScreenId | null;
  completedEventTypes: Set<string>;
};

export function FlowTracker({ guestPhase, guestScreen, completedEventTypes }: Props) {
  const inConcierge = guestPhase === 'concierge';

  return (
    <div className="rounded-lg border border-[var(--color-hotel-border)] bg-[var(--staff-surface)] p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-widest text-[var(--color-hotel-accent)]">
          Flow
        </p>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] ${
            inConcierge
              ? 'bg-emerald-50 text-emerald-800'
              : guestPhase === 'media'
                ? 'bg-blue-50 text-blue-800'
                : 'bg-stone-100 text-stone-600'
          }`}
        >
          {guestPhase ?? 'disconnected'}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FLOW_STEPS.map(({ screen, label }) => {
          const isCurrent = guestScreen === screen && inConcierge;
          const completedType = COMPLETED_EVENTS[screen];
          const isDone = completedType ? completedEventTypes.has(completedType) : false;

          return (
            <span
              key={screen}
              className={`rounded-md px-2 py-1 text-[10px] font-medium uppercase tracking-wide ${
                isCurrent
                  ? 'border border-[var(--color-hotel-accent)] bg-[var(--color-hotel-accent)]/20 text-[var(--color-hotel-accent)]'
                  : isDone
                    ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border border-[var(--staff-line)] bg-white/60 text-[var(--color-hotel-text-dim)]'
              }`}
            >
              {isDone ? '✓ ' : ''}
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
