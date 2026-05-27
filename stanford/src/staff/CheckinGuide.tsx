import { useMemo, useState } from 'react';
import type { GuestPhase, GuestScreenId } from '../types';

type GuideTab = 'flow' | 'policies' | 'talk';

type Props = {
  guestPhase: GuestPhase | null;
  guestScreen: GuestScreenId | null;
  completedEventTypes: Set<string>;
};

const CHECKLIST: {
  id: string;
  label: string;
  detail: string;
  eventType?: string;
}[] = [
  {
    id: 'reservation',
    label: 'Confirm reservation',
    detail: 'Match name, dates, room type, and visible VIP/access notes before pushing to tablet.',
    eventType: 'reservation_confirmed',
  },
  {
    id: 'identity',
    label: 'Verify ID',
    detail: 'Use passport scan for international guests. Confirm the visible name matches the reservation.',
    eventType: 'passport_scanned',
  },
  {
    id: 'payment',
    label: 'Collect payment',
    detail: 'Send the QR only after identity is verified. Keep the guest on video until payment completes.',
    eventType: 'payment_complete',
  },
  {
    id: 'signature',
    label: 'Capture signature',
    detail: 'Request signature after payment. Mention house rules and incidentals before the guest signs.',
    eventType: 'signature_submitted',
  },
  {
    id: 'key',
    label: 'Issue key card',
    detail: 'Dispense key only after signature. Confirm the room number verbally once the drawer opens.',
    eventType: 'key_card_received',
  },
  {
    id: 'finish',
    label: 'Personalize arrival',
    detail: 'Offer room preferences, services, property map, and luggage help before ending to media mode.',
    eventType: 'luggage_info',
  },
];

const POLICIES = [
  'A matching government ID is required before payment, signature, or key issuance.',
  'Do not read full passport numbers aloud. Confirm only the guest name and the last few characters if needed.',
  'Payment retries are allowed twice. On the third failure, keep the call open and route to front desk.',
  'Room changes, late checkout, and waived deposits require manager approval in the live demo.',
  'Accessibility requests take priority over upsells, room tours, and optional service offers.',
];

const TALK_TRACK = [
  {
    label: 'Opening',
    copy: 'Good evening, welcome to the Stanford demo check-in. I will stay with you while we verify the reservation and prepare your key.',
  },
  {
    label: 'ID',
    copy: 'Please hold your passport steady inside the frame. I only need this to verify the reservation holder.',
  },
  {
    label: 'Payment',
    copy: 'I am sending a secure payment QR to the tablet now. Once it clears, we will capture your signature and issue the key.',
  },
  {
    label: 'Closing',
    copy: 'You are all set. Your key is ready, and I can also help with luggage, directions, or a dining reservation.',
  },
];

const ESCALATIONS = [
  'Reservation not found or dates do not match.',
  'ID name mismatch, expired document, or unclear scan after two attempts.',
  'Payment failure after two retries.',
  'Guest requests medical, safety, accessibility, or privacy support.',
  'Key drawer, encoder, or tablet is unresponsive.',
];

export function CheckinGuide({ guestPhase, guestScreen, completedEventTypes }: Props) {
  const [activeTab, setActiveTab] = useState<GuideTab>('flow');
  const currentHint = useMemo(
    () => getCurrentHint(guestPhase, guestScreen, completedEventTypes),
    [completedEventTypes, guestPhase, guestScreen]
  );

  return (
    <section className="rounded-lg border border-[var(--color-hotel-border)] bg-black/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-[var(--color-hotel-accent)]">
            Check-in guide
          </p>
          <p className="mt-1 text-xs leading-snug text-[var(--color-hotel-text-dim)]">
            Mock staff script and policy helper for this prototype property.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-green-700/40 bg-green-950/30 px-2 py-1 text-[10px] uppercase tracking-wider text-green-300">
          live
        </span>
      </div>

      <div className="mt-3 rounded border border-white/10 bg-white/[0.04] p-3">
        <p className="text-[10px] uppercase tracking-wider text-[var(--color-hotel-text-dim)]">
          Suggested now
        </p>
        <p className="mt-1 text-sm font-medium text-white">{currentHint.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-white/70">{currentHint.body}</p>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg border border-white/10 bg-black/30 p-1">
        <GuideTabButton label="Flow" isActive={activeTab === 'flow'} onClick={() => setActiveTab('flow')} />
        <GuideTabButton label="Policy" isActive={activeTab === 'policies'} onClick={() => setActiveTab('policies')} />
        <GuideTabButton label="Script" isActive={activeTab === 'talk'} onClick={() => setActiveTab('talk')} />
      </div>

      <div className="mt-3">
        {activeTab === 'flow' && (
          <div className="space-y-2">
            {CHECKLIST.map((item) => {
              const isDone = item.eventType ? completedEventTypes.has(item.eventType) : false;

              return (
                <div
                  key={item.id}
                  className={`rounded border p-2 ${
                    isDone
                      ? 'border-green-700/40 bg-green-950/20'
                      : 'border-white/10 bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                        isDone
                          ? 'border-green-500/60 bg-green-500/15 text-green-300'
                          : 'border-white/20 text-white/45'
                      }`}
                    >
                      {isDone ? 'OK' : ''}
                    </span>
                    <p className="text-xs font-medium text-white/90">{item.label}</p>
                  </div>
                  <p className="mt-1 pl-7 text-[11px] leading-relaxed text-white/55">
                    {item.detail}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'policies' && (
          <div className="space-y-2">
            {POLICIES.map((policy) => (
              <p
                key={policy}
                className="rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-xs leading-relaxed text-white/70"
              >
                {policy}
              </p>
            ))}
          </div>
        )}

        {activeTab === 'talk' && (
          <div className="space-y-3">
            {TALK_TRACK.map((line) => (
              <div key={line.label} className="rounded border border-white/10 bg-white/[0.03] p-3">
                <p className="text-[10px] uppercase tracking-wider text-[var(--color-hotel-accent)]">
                  {line.label}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-white/75">{line.copy}</p>
              </div>
            ))}
            <div className="rounded border border-red-400/30 bg-red-950/20 p-3">
              <p className="text-[10px] uppercase tracking-wider text-red-200">
                Escalate when
              </p>
              <ul className="mt-2 space-y-1 text-xs leading-relaxed text-red-100/75">
                {ESCALATIONS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function GuideTabButton({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rounded-md px-2 py-1.5 text-xs font-medium uppercase tracking-wide ${
        isActive
          ? 'bg-[var(--color-hotel-accent)] text-black'
          : 'text-white/55 hover:bg-white/10 hover:text-white'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function getCurrentHint(
  guestPhase: GuestPhase | null,
  guestScreen: GuestScreenId | null,
  completedEventTypes: Set<string>
) {
  if (!guestPhase) {
    return {
      title: 'Wait for the guest tablet to join',
      body: 'Once the guest enters concierge mode, keep the video open and start with reservation lookup.',
    };
  }

  if (guestPhase !== 'concierge') {
    return {
      title: 'Guest is outside assisted check-in',
      body: 'Invite the guest to choose assisted concierge check-in when they are ready for staff support.',
    };
  }

  if (guestScreen === 'reservation' && !completedEventTypes.has('reservation_confirmed')) {
    return {
      title: 'Find and push the reservation',
      body: 'Search by name, confirmation code, passport, email, or phone, then show the matching profile on the tablet.',
    };
  }

  if (guestScreen === 'passport' && !completedEventTypes.has('passport_scanned')) {
    return {
      title: 'Verify identity',
      body: 'Ask the guest to hold the document steady. Route to front desk if the scan is unreadable twice.',
    };
  }

  if (guestScreen === 'payment' && !completedEventTypes.has('payment_complete')) {
    return {
      title: 'Stay on the call through payment',
      body: 'Confirm the guest can see the QR and wait for the payment complete event before requesting signature.',
    };
  }

  if (guestScreen === 'signature' && !completedEventTypes.has('signature_submitted')) {
    return {
      title: 'Summarize terms before signature',
      body: 'Mention incidentals, no-smoking policy, and checkout time, then ask the guest to sign on the tablet.',
    };
  }

  if (guestScreen === 'key-card' && !completedEventTypes.has('key_card_received')) {
    return {
      title: 'Issue the key card',
      body: 'Confirm the room number, dispense the key, and wait for the guest to acknowledge receipt.',
    };
  }

  return {
    title: 'Complete arrival preferences',
    body: 'Offer personalization, services, the property map, and luggage support before ending the session.',
  };
}
