import { useState } from 'react';
import { lookupReservation } from '../services/api';
import type { Reservation } from '../types';

type Props = {
  onPushReservation: (r: Reservation) => void;
};

export function ReservationLookup({ onPushReservation }: Props) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<Reservation | null>(null);

  const search = async () => {
    setLoading(true);
    setError(null);
    setFound(null);
    try {
      const r = await lookupReservation(query.trim());
      if (!r) setError('No reservation found for that reference or name.');
      else setFound(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-[var(--color-hotel-border)] bg-black/40 p-3">
      <p className="text-sm font-medium text-[var(--color-hotel-accent)]">
        Reservation lookup
      </p>
      <p className="text-xs text-[var(--color-hotel-text-dim)]">
        Last name, confirmation code, or booking ref (uses backend /checkin/lookup).
      </p>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. SNG1234 or Tan"
          className="min-w-0 flex-1 rounded border border-white/20 bg-black/50 px-2 py-1.5 text-sm text-white"
        />
        <button
          type="button"
          className="shrink-0 rounded bg-[var(--color-hotel-accent)] px-3 py-1.5 text-sm font-medium text-black"
          onClick={() => void search()}
          disabled={loading || !query.trim()}
        >
          {loading ? '…' : 'Find'}
        </button>
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
      {found && (
        <div className="text-xs text-white/80">
          <p>
            {found.guest?.firstName} {found.guest?.lastName} ·{' '}
            {found.confirmationCode}
          </p>
          <button
            type="button"
            className="mt-2 w-full rounded border border-[var(--color-hotel-accent)] py-1.5 text-[var(--color-hotel-accent)]"
            onClick={() => onPushReservation(found)}
          >
            Show on guest tablet
          </button>
        </div>
      )}
    </div>
  );
}
