import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '../ui/Button';
import { useCheckin } from '../../hooks/useCheckin';
import {
  startPassportScan,
  getPassportScanStatus,
  stopPassportScan,
} from '../../services/api';
import type { PassportScanStatus } from '../../services/api';

type ScanPhase = 'scanning' | 'success' | 'failed';

const POLL_INTERVAL_MS = 1500;
const SUCCESS_DISPLAY_MS = 1800;

export function PassportScanScreen() {
  const { handlePassportScanResult, handlePassportBypass } = useCheckin();

  const [phase, setPhase] = useState<ScanPhase>('scanning');
  const [attempts, setAttempts] = useState(0);
  const [scanData, setScanData] = useState<PassportScanStatus['data'] | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Keep a ref to handlePassportScanResult so the polling closure always
  // calls the latest version without being a useEffect dependency.
  const resultHandlerRef = useRef(handlePassportScanResult);
  resultHandlerRef.current = handlePassportScanResult;

  const clearPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const doStart = useCallback(async () => {
    setPhase('scanning');
    setAttempts(0);
    setScanData(null);

    try {
      await startPassportScan();
    } catch {
      setPhase('failed');
      return;
    }

    pollRef.current = setInterval(async () => {
      if (!mountedRef.current) return;
      try {
        const status = await getPassportScanStatus();
        if (!mountedRef.current) return;

        setAttempts(status.attempts || 0);

        if (status.status === 'success') {
          clearPolling();
          setScanData(status.data ?? null);
          setPhase('success');
          setTimeout(() => {
            if (mountedRef.current) {
              resultHandlerRef.current(status);
            }
          }, SUCCESS_DISPLAY_MS);
        } else if (status.status === 'failed') {
          clearPolling();
          setPhase('failed');
        }
      } catch {
        // Network blip -- keep polling
      }
    }, POLL_INTERVAL_MS);
  }, [clearPolling]);

  // Run exactly once on mount; clean up on unmount only.
  useEffect(() => {
    mountedRef.current = true;
    doStart();
    return () => {
      mountedRef.current = false;
      clearPolling();
      stopPassportScan().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRetry = useCallback(() => {
    clearPolling();
    doStart();
  }, [doStart, clearPolling]);

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 py-8 gap-6">
      <h2 className="text-2xl font-light text-hotel-text">Passport Scanner</h2>

      {phase === 'scanning' && <ScanningIndicator attempts={attempts} />}
      {phase === 'success' && <SuccessIndicator data={scanData} />}

      {phase === 'failed' && (
        <>
          <FailedIndicator />
          <div className="flex gap-3">
            <Button onClick={handleRetry}>
              Try Again
            </Button>
            <Button variant="secondary" onClick={handlePassportBypass}>
              Enter Manually
            </Button>
          </div>
        </>
      )}

      {phase === 'scanning' && (
        <Button variant="secondary" onClick={handlePassportBypass}>
          Enter Manually Instead
        </Button>
      )}
    </div>
  );
}

function ScanningIndicator({ attempts }: { attempts: number }) {
  return (
    <>
      <div className="relative w-80 h-52 rounded-2xl border-2 border-dashed border-hotel-accent/30 bg-hotel-accent/5 flex items-center justify-center overflow-hidden">
        <style>{`
          @keyframes scanLine {
            0%, 100% { top: 0; }
            50% { top: calc(100% - 4px); }
          }
        `}</style>
        <div className="absolute inset-0">
          <div
            className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-hotel-accent to-transparent"
            style={{ animation: 'scanLine 2s ease-in-out infinite' }}
          />
        </div>
        <div className="flex flex-col items-center gap-3">
          <svg className="w-12 h-12 text-hotel-accent animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" />
          </svg>
          <p className="text-hotel-accent text-sm font-medium animate-pulse">Scanning passport...</p>
        </div>
      </div>
      <p className="text-hotel-text-dim text-sm text-center max-w-sm">
        Please place your passport face-down on the scanner. It will be read automatically.
      </p>
      {attempts > 0 && (
        <p className="text-hotel-text-dim/50 text-xs tabular-nums">
          Scan attempt {attempts}
        </p>
      )}
    </>
  );
}

function SuccessIndicator({ data }: { data?: PassportScanStatus['data'] | null }) {
  const displayName = data
    ? `${data.firstName} ${data.lastName}`.trim()
    : '';

  return (
    <>
      <div className="relative w-80 h-52 rounded-2xl border-2 border-emerald-400/40 bg-emerald-400/5 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <svg className="w-14 h-14 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-emerald-400 text-sm font-medium">Passport detected</p>
          {displayName && (
            <p className="text-hotel-text text-base font-medium">{displayName}</p>
          )}
          {data?.passportNumber && (
            <p className="text-hotel-text-dim text-xs tracking-wider">{data.passportNumber}</p>
          )}
        </div>
      </div>
    </>
  );
}

function FailedIndicator() {
  return (
    <>
      <div className="relative w-80 h-52 rounded-2xl border-2 border-dashed border-red-400/30 bg-red-400/5 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <svg className="w-12 h-12 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <p className="text-red-400 text-sm font-medium">Could not read passport</p>
        </div>
      </div>
      <p className="text-hotel-text-dim text-sm text-center max-w-sm">
        The scanner could not read your passport. You can try again or enter your details manually.
      </p>
    </>
  );
}
