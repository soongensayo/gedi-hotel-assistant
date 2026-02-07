import { useState } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useCheckin } from '../../hooks/useCheckin';

export function IdentifyScreen() {
  const [confirmationCode, setConfirmationCode] = useState('');
  const { goToStep, handleReservationLookup } = useCheckin();

  const handleSubmitCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmationCode.trim()) {
      handleReservationLookup(confirmationCode.trim());
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 gap-8">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-light text-hotel-text mb-2">
          How would you like to check in?
        </h2>
        <p className="text-hotel-text-dim">
          Choose your preferred identification method
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-2xl">
        {/* Passport Scan Option */}
        <Card
          className="flex flex-col items-center gap-4 p-8 cursor-pointer"
          onClick={() => goToStep('passport-scan')}
          glow
        >
          <div className="w-16 h-16 rounded-xl bg-hotel-accent/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-hotel-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" />
            </svg>
          </div>
          <div className="text-center">
            <h3 className="text-lg font-medium text-hotel-text">Scan Passport</h3>
            <p className="text-hotel-text-dim text-sm mt-1">
              Place your passport on the scanner
            </p>
          </div>
        </Card>

        {/* Confirmation Code Option */}
        <Card className="flex flex-col items-center gap-4 p-8">
          <div className="w-16 h-16 rounded-xl bg-hotel-accent-2/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-hotel-accent-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
          </div>
          <div className="text-center">
            <h3 className="text-lg font-medium text-hotel-text">Confirmation Code</h3>
            <p className="text-hotel-text-dim text-sm mt-1">
              Enter your booking reference
            </p>
          </div>
          <form onSubmit={handleSubmitCode} className="w-full flex flex-col gap-3 mt-2">
            <input
              type="text"
              value={confirmationCode}
              onChange={(e) => setConfirmationCode(e.target.value.toUpperCase())}
              placeholder="e.g. GAH-2024-001"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-center text-hotel-text placeholder-hotel-text-dim/40 focus:outline-none focus:border-hotel-accent-2/40 transition-colors tracking-widest uppercase"
              maxLength={20}
            />
            <Button variant="secondary" type="submit" disabled={!confirmationCode.trim()}>
              Look Up Reservation
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
