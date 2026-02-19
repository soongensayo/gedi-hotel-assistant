import { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useCheckin } from '../../hooks/useCheckin';
import { useCheckinStore } from '../../stores/checkinStore';

type PaymentPhase = 'awaiting-tap' | 'processing' | 'done';

const TAP_TIMEOUT_MS = 8_000;

export function PaymentScreen() {
  const { handlePayment } = useCheckin();
  const { reservation, selectedUpgrade, setPendingMessage } = useCheckinStore();
  const [phase, setPhase] = useState<PaymentPhase>('awaiting-tap');

  if (!reservation) return null;

  const baseAmount = reservation.totalAmount;
  const upgradeAmount = selectedUpgrade
    ? selectedUpgrade.additionalCostPerNight *
      Math.ceil(
        (new Date(reservation.checkOutDate).getTime() - new Date(reservation.checkInDate).getTime()) /
          (1000 * 60 * 60 * 24)
      )
    : 0;
  const totalAmount = baseAmount + upgradeAmount;

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 py-8 gap-6">
      <h2 className="text-2xl font-light text-hotel-text">Payment</h2>

      <Card className="w-full max-w-md">
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-hotel-text-dim">Room charges</span>
            <span className="text-hotel-text">
              {reservation.currency} {baseAmount.toLocaleString()}
            </span>
          </div>
          {upgradeAmount > 0 && (
            <div className="flex justify-between">
              <span className="text-hotel-text-dim">Room upgrade</span>
              <span className="text-hotel-gold">
                +{reservation.currency} {upgradeAmount.toLocaleString()}
              </span>
            </div>
          )}
          <div className="h-px bg-white/10" />
          <div className="flex justify-between text-lg">
            <span className="text-hotel-text font-medium">Total</span>
            <span className="text-hotel-gold font-semibold">
              {reservation.currency} {totalAmount.toLocaleString()}
            </span>
          </div>
        </div>
      </Card>

      {phase === 'awaiting-tap' && (
        <TapPhase
          onTap={() => setPhase('processing')}
        />
      )}

      {phase === 'processing' && (
        <ProcessingPhase
          onDone={() => setPhase('done')}
          handlePayment={handlePayment}
        />
      )}

      {phase === 'done' && (
        <DonePhase
          onContinue={() => setPendingMessage("Payment is done, let's continue.")}
        />
      )}
    </div>
  );
}

function TapPhase({ onTap }: { onTap: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onTap, TAP_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [onTap]);

  return (
    <>
      {/* Radar / contactless animation */}
      <div className="relative w-44 h-44 flex items-center justify-center">
        <style>{`
          @keyframes radar-ping {
            0% { transform: scale(0.5); opacity: 0.6; }
            100% { transform: scale(1.5); opacity: 0; }
          }
        `}</style>
        {/* Pulsing rings */}
        <div className="absolute inset-0 rounded-full border border-hotel-accent/20" style={{ animation: 'radar-ping 2s ease-out infinite' }} />
        <div className="absolute inset-0 rounded-full border border-hotel-accent/15" style={{ animation: 'radar-ping 2s ease-out infinite 0.5s' }} />
        <div className="absolute inset-0 rounded-full border border-hotel-accent/10" style={{ animation: 'radar-ping 2s ease-out infinite 1s' }} />

        {/* Center icon — contactless symbol */}
        <div className="relative w-20 h-20 rounded-full bg-hotel-accent/10 border border-hotel-accent/30 flex items-center justify-center shadow-[0_0_30px_rgba(196,162,101,0.15)]">
          <svg className="w-10 h-10 text-hotel-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0" />
          </svg>
        </div>
      </div>

      <p className="text-hotel-text-dim text-sm text-center">
        Please tap or insert your card on the reader
      </p>

      <Button onClick={onTap}>
        Simulate Card Tap
      </Button>
    </>
  );
}

function ProcessingPhase({ onDone, handlePayment }: { onDone: () => void; handlePayment: () => Promise<void> }) {
  const processPayment = useCallback(async () => {
    await handlePayment();
    onDone();
  }, [handlePayment, onDone]);

  useEffect(() => {
    processPayment();
  }, [processPayment]);

  return (
    <>
      <div className="relative w-44 h-44 flex items-center justify-center">
        <div className="w-20 h-20 rounded-full bg-hotel-accent/10 border border-hotel-accent/30 flex items-center justify-center">
          <div className="animate-spin w-10 h-10 border-2 border-hotel-accent/30 border-t-hotel-accent rounded-full" />
        </div>
      </div>
      <p className="text-hotel-accent text-sm animate-pulse">Processing payment...</p>
    </>
  );
}

function DonePhase({ onContinue }: { onContinue: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onContinue, 3000);
    return () => clearTimeout(timer);
  }, [onContinue]);

  return (
    <>
      <div className="relative w-44 h-44 flex items-center justify-center">
        <div className="w-20 h-20 rounded-full bg-hotel-success/10 border border-hotel-success/30 flex items-center justify-center">
          <svg className="w-10 h-10 text-hotel-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </div>
      <p className="text-hotel-success text-sm font-medium">Payment successful</p>
      <Button onClick={onContinue}>
        Continue
      </Button>
    </>
  );
}
