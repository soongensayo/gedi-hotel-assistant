import type { ServiceOffer, StaffToGuestCommand } from '../types';

const DEMO_SERVICES: ServiceOffer[] = [
  {
    id: 'chef',
    category: 'dining',
    name: "Chef's tasting menu",
    description: '19:30 · Main dining room',
  },
  {
    id: 'breakfast',
    category: 'dining',
    name: 'In-suite breakfast',
    description: 'Choose time with concierge',
  },
  {
    id: 'spa',
    category: 'spa',
    name: 'Signature massage · 60 min',
    description: 'Spa level 3',
  },
  {
    id: 'pool',
    category: 'other',
    name: 'Cabana reservation',
    description: 'Sky pool · sunset slot',
  },
];

type Props = {
  push: (command: StaffToGuestCommand) => void;
};

export function ActionPanel({ push }: Props) {
  const paymentDemo =
    (import.meta.env.VITE_STANFORD_PAYMENT_QR as string | undefined) ??
    'https://example.com/pay/demo-luxedrive';

  return (
    <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto pr-1">
      <FlowButton label="Screen: video only" onClick={() => push({ type: 'show_screen', screen: 'video-only' })} />
      <FlowButton
        label="Screen: reservation (empty)"
        onClick={() => push({ type: 'show_screen', screen: 'reservation' })}
      />
      <FlowButton
        label="Passport: guest camera"
        onClick={() => push({ type: 'activate_passport_scan', mode: 'camera' })}
      />
      <FlowButton
        label="Passport: hardware scanner"
        onClick={() => push({ type: 'activate_passport_scan', mode: 'hardware' })}
      />
      <FlowButton
        label="Payment / NFC"
        onClick={() =>
          push({
            type: 'show_payment_qr',
            qrValue: paymentDemo,
            instructions: 'Tap your card or phone on the NFC reader to complete payment.',
          })
        }
      />
      <FlowButton
        label="Trigger payment success"
        onClick={() => push({ type: 'payment_success_demo' })}
        complete
      />
      <FlowButton
        label="Request signature"
        onClick={() => push({ type: 'request_signature' })}
      />
      <FlowButton
        label="Key card / drawer"
        onClick={() => push({ type: 'dispense_key_card' })}
      />
      <FlowButton
        label="Personalization"
        onClick={() => push({ type: 'show_screen', screen: 'personalization' })}
      />
      <FlowButton
        label="Services menu"
        onClick={() => push({ type: 'show_services', services: DEMO_SERVICES })}
      />
      <FlowButton label="Property map" onClick={() => push({ type: 'show_map' })} />
      <FlowButton
        label="Luggage"
        onClick={() => push({ type: 'show_screen', screen: 'luggage' })}
      />
      <FlowButton
        label="Custom message"
        onClick={() =>
          push({
            type: 'custom_message',
            title: 'Concierge',
            body: 'Please listen for the next step on our call.',
          })
        }
      />
      <hr className="border-[var(--color-hotel-border)]" />
      <FlowButton
        label="Check-in complete"
        onClick={() => push({ type: 'end_session' })}
        complete
      />
    </div>
  );
}

function FlowButton({
  label,
  onClick,
  danger,
  complete,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  complete?: boolean;
}) {
  return (
    <button
      type="button"
      className={`w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium uppercase tracking-wide ${
        complete
          ? 'border border-emerald-300/60 bg-emerald-900/45 text-emerald-100 hover:bg-emerald-800/55'
          : danger
          ? 'border border-red-400/50 bg-red-950/40 text-red-200'
          : 'border border-[var(--color-hotel-border)] bg-white/5 text-[var(--color-hotel-text)] hover:border-[var(--color-hotel-accent)]'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
