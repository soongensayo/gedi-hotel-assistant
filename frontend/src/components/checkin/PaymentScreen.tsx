import { useState } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useCheckin } from '../../hooks/useCheckin';
import { useCheckinStore } from '../../stores/checkinStore';

export function PaymentScreen() {
  const { handlePayment } = useCheckin();
  const { reservation, selectedUpgrade, setStep } = useCheckinStore();
  const [isProcessing, setIsProcessing] = useState(false);
  const [cardInserted, setCardInserted] = useState(false);

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

  const handleInsertCard = () => {
    setCardInserted(true);
  };

  const handleProcessPayment = async () => {
    setIsProcessing(true);
    await handlePayment();
    setIsProcessing(false);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 gap-6">
      <h2 className="text-2xl font-light text-hotel-text">Payment</h2>

      {/* Amount summary */}
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

      {/* Card reader mock */}
      <div className="relative w-72 h-44 rounded-2xl border border-hotel-border bg-hotel-panel flex flex-col items-center justify-center gap-4 overflow-hidden">
        {!cardInserted ? (
          <>
            <div className="w-16 h-10 border-2 border-dashed border-hotel-accent/30 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-hotel-accent/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
              </svg>
            </div>
            <p className="text-hotel-text-dim text-sm">Insert or tap your card</p>
          </>
        ) : isProcessing ? (
          <>
            <div className="animate-spin w-8 h-8 border-2 border-hotel-accent/30 border-t-hotel-accent rounded-full" />
            <p className="text-hotel-accent text-sm animate-pulse">Processing payment...</p>
          </>
        ) : (
          <>
            <div className="w-14 h-9 rounded-md bg-gradient-to-r from-hotel-accent/30 to-hotel-accent-2/30 border border-hotel-accent/20" />
            <p className="text-hotel-success text-sm">Card detected ✓</p>
          </>
        )}
      </div>

      <div className="flex gap-4">
        <Button variant="secondary" onClick={() => setStep('upgrade-offer')}>
          Back
        </Button>
        {!cardInserted ? (
          <Button onClick={handleInsertCard}>
            Simulate Card Insert
          </Button>
        ) : (
          <Button onClick={handleProcessPayment} isLoading={isProcessing}>
            Confirm Payment
          </Button>
        )}
      </div>
    </div>
  );
}
