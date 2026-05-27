import { QRCodeSVG } from 'qrcode.react';

type Props = {
  qrValue: string;
  instructions?: string;
  onPaidDemo: () => void;
};

export function PaymentScreen({ qrValue, instructions, onPaidDemo }: Props) {
  return (
    <div className="space-y-4">
      <h3 className="text-center text-xl text-[var(--color-hotel-accent)]">Payment</h3>
      {instructions && (
        <p className="text-center text-sm text-[var(--color-hotel-text-dim)]">{instructions}</p>
      )}
      <div className="flex justify-center rounded-lg bg-white p-4">
        <QRCodeSVG value={qrValue} size={180} level="M" />
      </div>
      <p className="text-center text-xs text-[var(--color-hotel-text-dim)]">
        Scan to pay. Your concierge will confirm when the payment has cleared.
      </p>
      <button
        type="button"
        className="w-full rounded-lg bg-[var(--color-hotel-accent)] py-3 font-medium text-white"
        onClick={onPaidDemo}
      >
        I’ve completed payment (demo)
      </button>
    </div>
  );
}
