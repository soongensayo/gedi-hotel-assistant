import { useState } from 'react';

type Props = {
  signatureDataUrl: string | null;
  passportPhotoUrl: string | null;
  passportNumber: string | null;
  preferences: { temperature: number; pillows: string; celebration?: string } | null;
  selectedServices: { id: string; label: string }[];
  luggageInfo: { count: number; needsHelp: boolean; etaNote?: string } | null;
};

export function ArtifactViewer({
  signatureDataUrl,
  passportPhotoUrl,
  passportNumber,
  preferences,
  selectedServices,
  luggageInfo,
}: Props) {
  const [expandedImg, setExpandedImg] = useState<string | null>(null);

  const hasAnything =
    signatureDataUrl ||
    passportPhotoUrl ||
    passportNumber ||
    preferences ||
    selectedServices.length > 0 ||
    luggageInfo;

  if (!hasAnything) return null;

  return (
    <div className="space-y-3 rounded-lg border border-[var(--color-hotel-border)] bg-black/40 p-3">
      <p className="text-xs font-medium uppercase tracking-widest text-[var(--color-hotel-accent)]">
        Received from guest
      </p>

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
            <p className="font-mono text-xs text-white/80">#{passportNumber}</p>
          )}
        </div>
      )}
      {!passportPhotoUrl && passportNumber && (
        <p className="text-xs text-white/80">
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
        <div className="text-xs text-white/80">
          <p className="text-[10px] text-[var(--color-hotel-text-dim)]">Room preferences</p>
          <p>
            {preferences.temperature}°C · {preferences.pillows}
            {preferences.celebration ? ` · ${preferences.celebration}` : ''}
          </p>
        </div>
      )}

      {/* Services */}
      {selectedServices.length > 0 && (
        <div className="text-xs text-white/80">
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
        <div className="text-xs text-white/80">
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
