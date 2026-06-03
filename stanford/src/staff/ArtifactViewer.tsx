import { useState } from 'react';

type Props = {
  signatureDataUrl: string | null;
  passportLivePreviewUrl: string | null;
  passportPhotoUrl: string | null;
  passportNumber: string | null;
  preferences: { temperature: number; pillows: string; celebration?: string } | null;
  selectedServices: { id: string; label: string }[];
  luggageInfo: { count: number; needsHelp: boolean; etaNote?: string } | null;
  onCapturePassportCamera: () => void;
};

export function ArtifactViewer({
  signatureDataUrl,
  passportLivePreviewUrl,
  passportPhotoUrl,
  passportNumber,
  preferences,
  selectedServices,
  luggageInfo,
  onCapturePassportCamera,
}: Props) {
  const [expandedImg, setExpandedImg] = useState<string | null>(null);

  const hasAnything =
    signatureDataUrl ||
    passportLivePreviewUrl ||
    passportPhotoUrl ||
    passportNumber ||
    preferences ||
    selectedServices.length > 0 ||
    luggageInfo;

  if (!hasAnything) return null;

  return (
    <div className="space-y-3 rounded-lg border border-[var(--color-hotel-border)] bg-[var(--staff-surface)] p-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-widest text-[var(--color-hotel-accent)]">
        Received from guest
      </p>

      {/* Live passport camera */}
      {passportLivePreviewUrl && !passportPhotoUrl && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-[var(--color-hotel-text-dim)]">
              Live passport camera
            </p>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] uppercase tracking-widest text-emerald-800">
              live
            </span>
          </div>
          <button type="button" onClick={() => setExpandedImg(passportLivePreviewUrl)}>
            <img
              src={passportLivePreviewUrl}
              alt="Live passport camera"
              className="h-28 w-full rounded border border-[var(--color-hotel-border)] object-cover"
            />
          </button>
          <button
            type="button"
            className="w-full rounded border border-[var(--color-hotel-accent)] bg-[var(--color-hotel-accent)]/10 py-2 text-xs font-medium uppercase tracking-wide text-[var(--color-hotel-accent)]"
            onClick={onCapturePassportCamera}
          >
            Capture passport camera
          </button>
        </div>
      )}

      {/* Passport photo */}
      {passportPhotoUrl && (
        <div className="space-y-1">
          <p className="text-[10px] text-[var(--color-hotel-text-dim)]">Passport photo</p>
          <button type="button" onClick={() => setExpandedImg(passportPhotoUrl)}>
            <img
              src={passportPhotoUrl}
              alt="Passport"
              className="h-20 rounded border border-[var(--color-hotel-border)] object-cover"
            />
          </button>
          {passportNumber && (
            <p className="font-mono text-xs text-[var(--color-hotel-text)]">#{passportNumber}</p>
          )}
        </div>
      )}
      {!passportPhotoUrl && passportNumber && (
        <p className="text-xs text-[var(--color-hotel-text)]">
          Passport (OCR): <span className="font-mono">{passportNumber}</span>
        </p>
      )}

      {/* Signature */}
      {signatureDataUrl && (
        <div className="space-y-1">
          <p className="text-[10px] text-[var(--color-hotel-text-dim)]">Signature</p>
          <button type="button" onClick={() => setExpandedImg(signatureDataUrl)}>
            <img
              src={signatureDataUrl}
              alt="Signature"
              className="h-16 rounded border border-[var(--color-hotel-border)] bg-[var(--color-hotel-dark)]"
            />
          </button>
        </div>
      )}

      {/* Preferences */}
      {preferences && (
        <div className="text-xs text-[var(--color-hotel-text)]">
          <p className="text-[10px] text-[var(--color-hotel-text-dim)]">Room preferences</p>
          <p>
            {preferences.temperature}°C · {preferences.pillows}
            {preferences.celebration ? ` · ${preferences.celebration}` : ''}
          </p>
        </div>
      )}

      {/* Services */}
      {selectedServices.length > 0 && (
        <div className="text-xs text-[var(--color-hotel-text)]">
          <p className="text-[10px] text-[var(--color-hotel-text-dim)]">Services booked</p>
          <ul className="list-inside list-disc">
            {selectedServices.map((s) => (
              <li key={s.id}>{s.label}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Luggage */}
      {luggageInfo && (
        <div className="text-xs text-[var(--color-hotel-text)]">
          <p className="text-[10px] text-[var(--color-hotel-text-dim)]">Luggage</p>
          <p>
            {luggageInfo.count} bag{luggageInfo.count !== 1 ? 's' : ''}
            {luggageInfo.needsHelp ? ' — help requested' : ''}
            {luggageInfo.etaNote ? ` · ETA: ${luggageInfo.etaNote}` : ''}
          </p>
        </div>
      )}

      {/* Expanded image modal */}
      {expandedImg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
          <div className="relative max-h-[90vh] max-w-[90vw]">
            <img src={expandedImg} alt="Expanded" className="max-h-[85vh] rounded-lg" />
            <button
              type="button"
              className="absolute -right-2 -top-2 rounded-full bg-black px-2.5 py-1 text-xs text-white"
              onClick={() => setExpandedImg(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
