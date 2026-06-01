import { useCallback, useEffect, useRef, useState } from 'react';
import { enableSuccessSoundOnNextGesture, playSuccessSound } from '../audio/successSound';
import { activateNfc, clearNfcStatus, pollNfcStatus } from '../services/api';

type Props = {
  qrValue: string;
  instructions?: string;
  onPaidDemo: () => void;
  successRequestId?: number;
};

type ReaderState = 'connecting' | 'ready' | 'offline' | 'detected';

const NFC_POLL_INTERVAL_MS = 1_000;
const KEYBOARD_TAP_IDLE_MS = 220;
const MIN_KEYBOARD_TAP_CHARS = 4;

export function PaymentScreen({ instructions, onPaidDemo, successRequestId = 0 }: Props) {
  const [readerState, setReaderState] = useState<ReaderState>('connecting');
  const [readerMessage, setReaderMessage] = useState('Checking NFC reader...');
  const paidRef = useRef(false);
  const keyboardBufferRef = useRef('');
  const keyboardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    enableSuccessSoundOnNextGesture();
  }, []);

  const completePayment = useCallback(
    (source: 'serial' | 'keyboard' | 'button' | 'staff') => {
      if (paidRef.current) return;
      paidRef.current = true;
      playSuccessSound();
      setReaderState('detected');
      setReaderMessage(
        source === 'button' || source === 'staff'
          ? 'Demo payment accepted.'
          : 'NFC tap detected. Payment accepted.'
      );
      window.setTimeout(onPaidDemo, 650);
    },
    [onPaidDemo]
  );

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const checkForTap = async () => {
      try {
        const status = await pollNfcStatus();
        if (!cancelled && status.detected) {
          if (pollTimer) window.clearInterval(pollTimer);
          completePayment('serial');
        }
      } catch {
        // A polling miss should not interrupt the demo; keyboard-wedge and button fallbacks remain active.
      }
    };

    const startSerialReader = async () => {
      try {
        await clearNfcStatus();
        const result = await activateNfc();
        if (cancelled) return;

        if (result.success) {
          setReaderState('ready');
          setReaderMessage('Reader ready. Tap your card or phone when prompted.');
          await checkForTap();
          pollTimer = window.setInterval(checkForTap, NFC_POLL_INTERVAL_MS);
        } else {
          setReaderState('offline');
          setReaderMessage('Reader is warming up. Your concierge can also confirm payment.');
        }
      } catch {
        if (!cancelled) {
          setReaderState('offline');
          setReaderMessage('Reader is warming up. Your concierge can also confirm payment.');
        }
      }
    };

    void startSerialReader();

    return () => {
      cancelled = true;
      if (pollTimer) window.clearInterval(pollTimer);
    };
  }, [completePayment]);

  useEffect(() => {
    if (successRequestId <= 0) return;
    const timer = window.setTimeout(() => completePayment('staff'), 0);
    return () => window.clearTimeout(timer);
  }, [completePayment, successRequestId]);

  useEffect(() => {
    const flushKeyboardTap = () => {
      if (keyboardBufferRef.current.length >= MIN_KEYBOARD_TAP_CHARS) {
        completePayment('keyboard');
      }
      keyboardBufferRef.current = '';
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (paidRef.current || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'Enter' || event.key === 'Tab') {
        flushKeyboardTap();
        return;
      }

      if (event.key.length !== 1) return;

      keyboardBufferRef.current += event.key;
      if (keyboardTimerRef.current) window.clearTimeout(keyboardTimerRef.current);
      keyboardTimerRef.current = window.setTimeout(flushKeyboardTap, KEYBOARD_TAP_IDLE_MS);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (keyboardTimerRef.current) window.clearTimeout(keyboardTimerRef.current);
    };
  }, [completePayment]);

  const isDetected = readerState === 'detected';

  return (
    <div className="flex h-full flex-col justify-center gap-3 text-center">
      <h3 className="text-lg text-[var(--color-hotel-accent)]">Payment</h3>
      {instructions && (
        <p className="text-xs leading-5 text-[var(--color-hotel-text-dim)]">{instructions}</p>
      )}

      <div className="flex justify-center">
        <div className="relative flex h-32 w-32 items-center justify-center">
          {!isDetected && (
            <>
              <div className="payment-tap-ring absolute inset-0 rounded-full border border-[var(--color-hotel-accent)]/25" />
              <div className="payment-tap-ring payment-tap-ring-delay absolute inset-0 rounded-full border border-[var(--color-hotel-accent)]/15" />
            </>
          )}
          <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-[var(--color-hotel-accent)]/35 bg-[var(--color-hotel-accent)]/10 shadow-[0_0_36px_rgba(211,177,111,0.2)]">
            {isDetected ? (
              <svg
                className="h-9 w-9 text-[var(--color-hotel-accent)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg
                className="h-10 w-10 text-[var(--color-hotel-accent)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0"
                />
              </svg>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-0.5">
        <p className="text-sm font-medium text-white">
          {isDetected ? 'Payment successful' : 'Tap card or phone on the NFC reader'}
        </p>
        <p className="text-xs text-[var(--color-hotel-text-dim)]">{readerMessage}</p>
      </div>

      <button
        type="button"
        className="w-full rounded-lg bg-[var(--color-hotel-accent)] py-2.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-70"
        onClick={() => completePayment('button')}
        disabled={isDetected}
      >
        Mark payment complete
      </button>
    </div>
  );
}
