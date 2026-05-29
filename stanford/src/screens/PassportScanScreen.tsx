import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getPassportScanStatus,
  startPassportScan,
  stopPassportScan,
  turnOnPassportGuide,
} from '../services/api';

type Props = {
  mode: 'camera' | 'hardware';
  captureRequestId?: number;
  onPreview?: (photoDataUrl: string) => void;
  onComplete: (passportNumber?: string, photoDataUrl?: string) => void;
};

export function PassportScanScreen({
  mode,
  captureRequestId = 0,
  onPreview,
  onComplete,
}: Props) {
  if (mode === 'hardware') {
    return <HardwarePassportScan onComplete={onComplete} />;
  }
  return (
    <CameraPassportScan
      captureRequestId={captureRequestId}
      onPreview={onPreview}
      onComplete={onComplete}
    />
  );
}

// ---------------------------------------------------------------------------
// Camera mode: use the guest tablet's own camera via getUserMedia
// ---------------------------------------------------------------------------

function CameraPassportScan({
  captureRequestId,
  onPreview,
  onComplete,
}: {
  captureRequestId: number;
  onPreview?: (photoDataUrl: string) => void;
  onComplete: (passportNumber?: string, photoDataUrl?: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onCompleteRef = useRef(onComplete);
  const onPreviewRef = useRef(onPreview);
  const lastCaptureRequestRef = useRef(captureRequestId);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);

  useEffect(() => {
    onCompleteRef.current = onComplete;
    onPreviewRef.current = onPreview;
  }, [onComplete, onPreview]);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            aspectRatio: { ideal: 1.42 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setCameraReady(true);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : 'Cannot access camera. Check permissions.'
        );
      }
    };

    void start();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const captureFrame = useCallback((options?: { stopStream?: boolean }) => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

    if (options?.stopStream) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    return dataUrl;
  }, []);

  const capture = useCallback(() => {
    const dataUrl = captureFrame({ stopStream: true });
    if (!dataUrl) return;
    setCaptured(dataUrl);
  }, [captureFrame]);

  useEffect(() => {
    if (!cameraReady || captured || !onPreviewRef.current) return;

    const interval = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;

      const canvas = document.createElement('canvas');
      canvas.width = 420;
      canvas.height = Math.round(420 * (video.videoHeight / video.videoWidth));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      onPreviewRef.current?.(canvas.toDataURL('image/jpeg', 0.45));
    }, 650);

    return () => window.clearInterval(interval);
  }, [cameraReady, captured]);

  useEffect(() => {
    if (captureRequestId === lastCaptureRequestRef.current) return;
    lastCaptureRequestRef.current = captureRequestId;
    if (!cameraReady || captured) return;

    const timer = window.setTimeout(() => {
      const dataUrl = captureFrame({ stopStream: true });
      if (!dataUrl) return;
      setCaptured(dataUrl);
      onCompleteRef.current(undefined, dataUrl);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [cameraReady, captureFrame, captureRequestId, captured]);

  const retake = useCallback(() => {
    setCaptured(null);
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            aspectRatio: { ideal: 1.42 },
          },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setCameraReady(true);
      } catch {
        setError('Cannot restart camera');
      }
    };
    void start();
  }, []);

  return (
    <div className="space-y-4">
      <h3 className="text-center text-xl text-[var(--color-hotel-accent)]">
        Passport scan
      </h3>
      <p className="text-center text-sm text-[var(--color-hotel-text-dim)]">
        Position your passport photo page within the frame, then tap Capture.
      </p>

      {error && <p className="text-center text-sm text-red-300">{error}</p>}

      {!captured && (
        <div className="relative mx-auto overflow-hidden rounded-lg border-2 border-[var(--color-hotel-accent)]">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-56 w-full bg-black object-cover"
          />
          {/* Passport placement overlay guide */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex h-[75%] w-[85%] flex-col justify-between rounded-lg border-2 border-dashed border-[var(--color-hotel-accent)]/60">
              <span className="ml-2 mt-1 text-[10px] text-[var(--color-hotel-accent)]/80">
                Chip / photo page
              </span>
              <span className="mb-1 ml-2 text-[10px] text-[var(--color-hotel-accent)]/80">
                MRZ lines &darr;
              </span>
            </div>
          </div>
        </div>
      )}

      {captured && (
        <div className="mx-auto overflow-hidden rounded-lg border border-[var(--color-hotel-accent)]">
          <img src={captured} alt="Captured passport" className="h-56 w-full object-cover" />
        </div>
      )}

      {!captured && cameraReady && (
        <button
          type="button"
          className="w-full rounded-lg bg-[var(--color-hotel-accent)] py-3 font-medium text-white"
          onClick={capture}
        >
          Capture
        </button>
      )}

      {captured && (
        <div className="flex gap-3">
          <button
            type="button"
            className="flex-1 rounded-lg border border-white/20 py-3 text-sm text-white/80"
            onClick={retake}
          >
            Retake
          </button>
          <button
            type="button"
            className="flex-1 rounded-lg bg-[var(--color-hotel-accent)] py-3 font-medium text-white"
            onClick={() => onCompleteRef.current(undefined, captured)}
          >
            Send to concierge
          </button>
        </div>
      )}

      <button
        type="button"
        className="w-full rounded-lg border border-white/20 py-2 text-xs text-white/50"
        onClick={() => onCompleteRef.current(undefined, undefined)}
      >
        Skip (demo)
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hardware mode: calls backend passport scanner APIs (existing flow)
// ---------------------------------------------------------------------------

function HardwarePassportScan({
  onComplete,
}: {
  onComplete: (passportNumber?: string, photoDataUrl?: string) => void;
}) {
  const [status, setStatus] = useState<string>('idle');
  const [error, setError] = useState<string | null>(null);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval>;

    const run = async () => {
      try {
        setStatus('starting');
        await turnOnPassportGuide();
        await startPassportScan();
        setStatus('scanning');
        interval = setInterval(async () => {
          if (cancelled) return;
          try {
            const s = await getPassportScanStatus();
            if (s.status === 'success' && s.data) {
              clearInterval(interval);
              await stopPassportScan();
              if (!cancelled) {
                setStatus('done');
                onCompleteRef.current(s.data.passportNumber, undefined);
              }
            } else if (s.status === 'failed') {
              setError(s.error ?? 'Scan failed');
            }
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Status error');
          }
        }, 800);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not start scanner');
        setStatus('error');
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      void stopPassportScan();
    };
  }, []);

  return (
    <div className="space-y-4">
      <h3 className="text-center text-xl text-[var(--color-hotel-accent)]">
        Passport scan
      </h3>
      <p className="text-center text-sm text-[var(--color-hotel-text-dim)]">
        Place your passport photo page face-up, aligned with the guide on the scanner.
      </p>
      <div className="mx-auto flex h-28 w-44 items-center justify-center rounded-lg border-2 border-dashed border-[var(--color-hotel-accent)] bg-black/50 text-xs text-[var(--color-hotel-text-dim)]">
        MRZ at bottom · chip top-left
      </div>
      <p className="text-center text-sm capitalize text-white/80">{status}</p>
      {error && <p className="text-center text-sm text-red-300">{error}</p>}
      <button
        type="button"
        className="w-full rounded-lg border border-white/20 py-2 text-sm"
        onClick={() => onCompleteRef.current(undefined, undefined)}
      >
        Skip (demo) — continue without scan
      </button>
    </div>
  );
}
