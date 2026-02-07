import { useState } from 'react';
import { Card } from '../ui/Card';
import type { PaymentResult } from '../../types';

interface MockCardReaderProps {
  amount: number;
  currency: string;
  onPaymentComplete: (result: PaymentResult) => void;
}

/**
 * A realistic mock credit card reader UI component.
 * Simulates insert, processing, and approval steps.
 * In production on Jetson, this would interface with a real POS terminal.
 */
export function MockCardReader({ amount, currency, onPaymentComplete }: MockCardReaderProps) {
  const [step, setStep] = useState<'idle' | 'inserted' | 'processing' | 'done'>('idle');

  const handleInsert = () => {
    setStep('inserted');
  };

  const handleProcess = async () => {
    setStep('processing');
    // Simulate payment processing
    await new Promise((resolve) => setTimeout(resolve, 3000));
    setStep('done');
    onPaymentComplete({
      success: true,
      transactionId: `TXN-${Date.now()}`,
      amount,
      currency,
      last4: '4242',
    });
  };

  return (
    <Card className="w-full max-w-xs">
      <div className="text-center space-y-4">
        <p className="text-hotel-text-dim text-xs uppercase tracking-wider">
          🔧 Mock Card Reader
        </p>

        {/* Card slot visualization */}
        <div className="relative mx-auto w-48 h-28 rounded-xl bg-hotel-darker border border-hotel-border flex items-center justify-center">
          {step === 'idle' && (
            <div className="text-center">
              <div className="w-12 h-1 bg-hotel-accent/20 rounded mx-auto mb-2" />
              <p className="text-hotel-text-dim text-xs">Insert card here</p>
            </div>
          )}
          {step === 'inserted' && (
            <div className="text-center">
              <div className="w-10 h-7 rounded bg-gradient-to-r from-hotel-accent/30 to-hotel-accent-2/30 border border-hotel-accent/30 mx-auto mb-2" />
              <p className="text-hotel-success text-xs">Card detected</p>
            </div>
          )}
          {step === 'processing' && (
            <div className="text-center">
              <div className="animate-spin w-6 h-6 border-2 border-hotel-accent/30 border-t-hotel-accent rounded-full mx-auto mb-2" />
              <p className="text-hotel-accent text-xs animate-pulse">Processing...</p>
            </div>
          )}
          {step === 'done' && (
            <div className="text-center">
              <svg className="w-8 h-8 text-hotel-success mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-hotel-success text-xs">Approved</p>
            </div>
          )}
        </div>

        <p className="text-hotel-gold font-medium">
          {currency} {amount.toLocaleString()}
        </p>

        {step === 'idle' && (
          <button
            onClick={handleInsert}
            className="w-full py-2 rounded-xl bg-hotel-accent/15 text-hotel-accent border border-hotel-accent/30 text-sm"
          >
            Simulate Card Insert
          </button>
        )}
        {step === 'inserted' && (
          <button
            onClick={handleProcess}
            className="w-full py-2 rounded-xl bg-hotel-success/15 text-hotel-success border border-hotel-success/30 text-sm"
          >
            Confirm Payment
          </button>
        )}
      </div>
    </Card>
  );
}
