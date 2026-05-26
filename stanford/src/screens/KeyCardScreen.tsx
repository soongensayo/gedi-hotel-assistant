import { useEffect, useRef, useState } from 'react';
import { issueKeyCard } from '../services/api';

type Props = {
  onReceived: () => void;
  useHardwareNfc?: boolean;
  guestName?: string;
  roomNumber?: string;
};

export function KeyCardScreen({
  onReceived,
  useHardwareNfc = false,
  guestName,
  roomNumber,
}: Props) {
  const [phase, setPhase] = useState<'encoding' | 'ready' | 'dispensing' | 'done' | 'error'>('encoding');
  const [statusText, setStatusText] = useState(
    'Encoding your room key securely...'
  );
  const onReceivedRef = useRef(onReceived);
  useEffect(() => {
    onReceivedRef.current = onReceived;
  }, [onReceived]);

  useEffect(() => {
    if (useHardwareNfc) return;
    const t = setTimeout(() => setPhase('ready'), 2000);
    return () => clearTimeout(t);
  }, [useHardwareNfc]);

  useEffect(() => {
    if (!useHardwareNfc) return;
    let cancelled = false;
    const run = async () => {
      try {
        if (!guestName || !roomNumber) {
          setStatusText('Reservation details are needed before issuing a room key.');
          setPhase('error');
          return;
        }

        setStatusText('Preparing the dispenser and writing your room key...');
        setPhase('dispensing');
        const result = await issueKeyCard({
          guestName,
          roomNumber,
          cardLabel: 'Primary',
        });

        if (cancelled) return;

        if (!result.success) {
          setStatusText(result.error || 'The key-card encoder could not issue a card.');
          setPhase('error');
          return;
        }

        setStatusText(result.message || 'Your key card is ready.');
        setPhase('done');
        onReceivedRef.current();
      } catch {
        if (cancelled) return;
        setStatusText('The key-card encoder is not reachable. Please ask the concierge for help.');
        setPhase('error');
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [guestName, roomNumber, useHardwareNfc]);

  return (
    <div className="space-y-6 text-center">
      <h3 className="text-xl text-[var(--color-hotel-accent)]">Your key card</h3>
      {phase === 'encoding' && (
        <p className="text-[var(--color-hotel-text-dim)]">
          {statusText}
        </p>
      )}
      {phase === 'ready' && (
        <>
          <p className="text-[var(--color-hotel-text-dim)]">
            The drawer will extend — please take your key card when it appears.
          </p>
          <div className="mx-auto flex h-24 w-40 items-center justify-center rounded border border-[var(--color-hotel-accent)] bg-gradient-to-b from-[#2a2418] to-black shadow-lg">
            <span className="text-xs tracking-widest text-[var(--color-hotel-accent)]">KEY</span>
          </div>
        </>
      )}
      {phase === 'dispensing' && (
        <p className="text-sm text-[var(--color-hotel-text-dim)]">
          The drawer will extend when encoding finishes.
        </p>
      )}
      {phase === 'done' && (
        <p className="text-[var(--color-hotel-text-dim)]">{statusText}</p>
      )}
      {phase === 'error' && (
        <p className="text-sm text-red-200">{statusText}</p>
      )}
      <button
        type="button"
        className="w-full rounded-lg bg-[var(--color-hotel-accent)] py-3 font-medium text-black disabled:cursor-not-allowed disabled:opacity-50"
        disabled={useHardwareNfc && (phase === 'encoding' || phase === 'dispensing')}
        onClick={() => {
          setPhase('done');
          onReceived();
        }}
      >
        I have my key card
      </button>
    </div>
  );
}
