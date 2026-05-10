import { useEffect, useRef, useState } from 'react';
import { activateNfc, clearNfcStatus, pollNfcStatus } from '../services/api';

type Props = {
  onReceived: () => void;
  useHardwareNfc?: boolean;
};

export function KeyCardScreen({ onReceived, useHardwareNfc = false }: Props) {
  const [phase, setPhase] = useState<'encoding' | 'ready' | 'nfc' | 'done'>('encoding');
  const onReceivedRef = useRef(onReceived);
  useEffect(() => {
    onReceivedRef.current = onReceived;
  }, [onReceived]);

  useEffect(() => {
    const t = setTimeout(() => setPhase('ready'), 2000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (phase !== 'ready' || !useHardwareNfc) return;
    let cancelled = false;
    const run = async () => {
      setPhase('nfc');
      try {
        await clearNfcStatus();
        await activateNfc();
        const start = Date.now();
        while (!cancelled && Date.now() - start < 60000) {
          const s = await pollNfcStatus();
          if (s.detected) {
            setPhase('done');
            onReceivedRef.current();
            return;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      } catch {
        /* mock path */
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [phase, useHardwareNfc]);

  return (
    <div className="space-y-6 text-center">
      <h3 className="text-xl text-[var(--color-hotel-accent)]">Your key card</h3>
      {phase === 'encoding' && (
        <p className="text-[var(--color-hotel-text-dim)]">
          Encoding your room key securely (NFC)…
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
      {phase === 'nfc' && (
        <p className="text-sm text-[var(--color-hotel-text-dim)]">
          Tap or hold your card when prompted…
        </p>
      )}
      <button
        type="button"
        className="w-full rounded-lg bg-[var(--color-hotel-accent)] py-3 font-medium text-black"
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
