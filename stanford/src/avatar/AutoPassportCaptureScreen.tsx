import { useEffect, useState } from 'react';
import { PassportScanScreen } from '../screens/PassportScanScreen';

type Props = {
  verifying?: boolean;
  onPreview?: (photoDataUrl: string) => void;
  onComplete: (passportNumber?: string, photoDataUrl?: string) => void;
};

export function AutoPassportCaptureScreen({ verifying = false, onPreview, onComplete }: Props) {
  const [captureRequestId, setCaptureRequestId] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setCaptureRequestId(1), 5200);
    return () => window.clearTimeout(timer);
  }, []);

  if (verifying) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-5 text-center">
        <div className="relative flex h-28 w-28 items-center justify-center">
          <div className="absolute inset-0 rounded-full border border-[var(--color-hotel-accent)]/20" />
          <div className="absolute inset-3 animate-spin rounded-full border-2 border-transparent border-t-[var(--color-hotel-accent)]" />
          <svg
            className="h-12 w-12 text-[var(--color-hotel-accent)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.7}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75 5.25 6v5.25c0 4.12 2.76 7.96 6.75 9 3.99-1.04 6.75-4.88 6.75-9V6L12 3.75Z" />
          </svg>
        </div>
        <div>
          <h3 className="text-xl text-[var(--color-hotel-accent)]">
            Verifying your ID
          </h3>
          <p className="mt-2 max-w-md text-sm leading-6 text-[var(--color-hotel-text-dim)]">
            Thanks. I am securely attaching the passport photo to your check-in.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PassportScanScreen
        mode="camera"
        captureRequestId={captureRequestId}
        onPreview={onPreview}
        onComplete={onComplete}
      />
      <p className="text-center text-xs text-[var(--color-hotel-text-dim)]">
        Hold still for a moment. The photo will capture automatically.
      </p>
    </div>
  );
}
