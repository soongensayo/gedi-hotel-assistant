import { useState } from 'react';
import { Button } from '../ui/Button';
import { useCheckin } from '../../hooks/useCheckin';

export function PassportScanScreen() {
  const [isScanning, setIsScanning] = useState(false);
  const { handlePassportScan, goToStep } = useCheckin();

  const doScan = async () => {
    setIsScanning(true);
    await handlePassportScan();
    setIsScanning(false);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 gap-8">
      <h2 className="text-2xl font-light text-hotel-text">Passport Scanner</h2>

      {/* Scanner visualization */}
      <div className="relative w-80 h-52 rounded-2xl border-2 border-dashed border-hotel-accent/30 bg-hotel-accent/5 flex items-center justify-center overflow-hidden">
        {isScanning ? (
          <>
            {/* Scanning animation */}
            <div className="absolute inset-0">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-hotel-accent to-transparent animate-[scan_2s_ease-in-out_infinite]" 
                style={{ animation: 'scan 2s ease-in-out infinite' }}
              />
            </div>
            <p className="text-hotel-accent animate-pulse font-medium">Scanning...</p>
            <style>{`
              @keyframes scan {
                0%, 100% { top: 0; }
                50% { top: calc(100% - 4px); }
              }
            `}</style>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 text-hotel-text-dim">
            <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" />
            </svg>
            <p className="text-sm">Place passport face-down on scanner</p>
          </div>
        )}
      </div>

      <div className="flex gap-4">
        <Button variant="secondary" onClick={() => goToStep('identify')}>
          Back
        </Button>
        <Button onClick={doScan} isLoading={isScanning}>
          {isScanning ? 'Scanning...' : 'Scan Passport'}
        </Button>
      </div>
    </div>
  );
}
