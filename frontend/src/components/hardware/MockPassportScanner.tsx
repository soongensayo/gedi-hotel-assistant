import { useState } from 'react';
import { Card } from '../ui/Card';
import type { PassportScanResult } from '../../types';

interface MockPassportScannerProps {
  onScanComplete: (result: PassportScanResult) => void;
}

// Mock passport data for demo
const MOCK_PASSPORTS = [
  {
    firstName: 'James',
    lastName: 'Chen',
    nationality: 'Singapore',
    passportNumber: 'E1234567A',
    dateOfBirth: '1985-03-15',
    expiryDate: '2028-03-14',
    gender: 'M',
  },
  {
    firstName: 'Sarah',
    lastName: 'Williams',
    nationality: 'United Kingdom',
    passportNumber: 'GB9876543',
    dateOfBirth: '1990-07-22',
    expiryDate: '2029-07-21',
    gender: 'F',
  },
  {
    firstName: 'Yuki',
    lastName: 'Tanaka',
    nationality: 'Japan',
    passportNumber: 'TK5551234',
    dateOfBirth: '1988-11-08',
    expiryDate: '2027-11-07',
    gender: 'F',
  },
];

/**
 * A realistic mock passport scanner UI component.
 * In production on Jetson, this would interface with a real USB document scanner.
 */
export function MockPassportScanner({ onScanComplete }: MockPassportScannerProps) {
  const [scanning, setScanning] = useState(false);
  const [selectedPassport, setSelectedPassport] = useState(0);

  const handleScan = async () => {
    setScanning(true);
    // Simulate scanning delay
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const passport = MOCK_PASSPORTS[selectedPassport];
    onScanComplete({
      success: true,
      data: passport,
    });
    setScanning(false);
  };

  return (
    <Card className="w-full max-w-sm">
      <div className="text-center mb-4">
        <p className="text-hotel-text-dim text-xs uppercase tracking-wider mb-1">
          🔧 Dev Mode: Mock Passport Scanner
        </p>
        <p className="text-hotel-text-dim text-xs">
          Select a test passport to simulate scanning
        </p>
      </div>

      <div className="space-y-2 mb-4">
        {MOCK_PASSPORTS.map((passport, i) => (
          <button
            key={i}
            onClick={() => setSelectedPassport(i)}
            className={`
              w-full text-left px-3 py-2 rounded-lg text-sm transition-colors
              ${selectedPassport === i
                ? 'bg-hotel-accent/15 text-hotel-text border border-hotel-accent/30'
                : 'bg-white/5 text-hotel-text-dim hover:bg-white/10'
              }
            `}
          >
            {passport.firstName} {passport.lastName} — {passport.nationality}
          </button>
        ))}
      </div>

      <button
        onClick={handleScan}
        disabled={scanning}
        className="w-full py-2.5 rounded-xl bg-hotel-accent/15 text-hotel-accent border border-hotel-accent/30 text-sm font-medium disabled:opacity-50 transition-all hover:bg-hotel-accent/25"
      >
        {scanning ? 'Scanning...' : 'Simulate Scan'}
      </button>
    </Card>
  );
}
