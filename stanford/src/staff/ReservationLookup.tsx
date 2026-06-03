import { useState } from 'react';
import { getReservationProfile, searchReservations } from '../services/api';
import type { Reservation, ReservationProfile } from '../types';

type Props = {
  onPushReservation: (r: Reservation) => void;
  onProfileLoaded?: (profile: ReservationProfile) => void;
};

export function ReservationLookup({ onPushReservation, onProfileLoaded }: Props) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Reservation[]>([]);
  const [profile, setProfile] = useState<ReservationProfile | null>(null);

  const search = async () => {
    setLoading(true);
    setError(null);
    setProfile(null);
    try {
      const found = await searchReservations(query.trim());
      setResults(found);
      if (found.length === 0) {
        setError('No matching guest or reservation.');
        return;
      }
      if (found.length === 1) {
        await loadProfile(found[0]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const loadProfile = async (reservation: Reservation) => {
    setLoading(true);
    setError(null);
    try {
      const nextProfile = await getReservationProfile(reservation.id);
      setProfile(nextProfile);
      onProfileLoaded?.(nextProfile);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Profile failed');
    } finally {
      setLoading(false);
    }
  };

  const activeReservation = profile?.reservation;
  const guest = activeReservation?.guest;
  const room = activeReservation?.room;

  return (
    <div className="space-y-2 rounded-lg border border-[var(--color-hotel-border)] bg-[var(--staff-surface)] p-3 shadow-sm">
      <p className="text-sm font-medium text-[var(--color-hotel-accent)]">
        Guest profile
      </p>
      <p className="text-xs text-[var(--color-hotel-text-dim)]">
        Search name, code, passport, email, or phone.
      </p>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query.trim()) void search();
          }}
          placeholder="James, GAH-2026-1, passport..."
          className="min-w-0 flex-1 rounded border border-[var(--staff-line)] bg-white px-2 py-1.5 text-sm text-[var(--color-hotel-text)] placeholder:text-[var(--color-hotel-text-dim)]"
        />
        <button
          type="button"
          className="shrink-0 rounded bg-[var(--color-hotel-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-55"
          onClick={() => void search()}
          disabled={loading || !query.trim()}
        >
          {loading ? '…' : 'Find'}
        </button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}

      {results.length > 1 && !profile && (
        <div className="space-y-1">
          {results.map((reservation) => (
            <button
              key={reservation.id}
              type="button"
              className="w-full rounded border border-[var(--staff-line)] bg-white px-2 py-2 text-left text-xs text-[var(--color-hotel-text-dim)] shadow-sm hover:border-[var(--color-hotel-accent)]"
              onClick={() => void loadProfile(reservation)}
            >
              <span className="block text-sm text-[var(--color-hotel-text)]">
                {guestName(reservation)}
              </span>
              <span className="font-mono text-[var(--color-hotel-accent)]">
                {reservation.confirmationCode}
              </span>
              <span className="text-[var(--color-hotel-text-dim)]"> · </span>
              <span>{reservation.room?.roomNumber ?? 'room pending'}</span>
            </button>
          ))}
        </div>
      )}

      {activeReservation && (
        <div className="space-y-3 text-xs text-[var(--color-hotel-text)]">
          <div className="rounded border border-[var(--staff-line)] bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-base text-[var(--color-hotel-text)]">{guestName(activeReservation)}</p>
                <p className="font-mono text-[var(--color-hotel-accent)]">
                  {activeReservation.confirmationCode}
                </p>
              </div>
              <StatusPill label={activeReservation.arrivalStatus ?? activeReservation.status} />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Info label="Room" value={room ? `${room.roomNumber} · ${room.type}` : 'Pending'} />
              <Info label="Dates" value={`${formatDate(activeReservation.checkInDate)} - ${formatDate(activeReservation.checkOutDate)}`} />
              <Info label="Total" value={`${activeReservation.currency} ${activeReservation.totalAmount.toFixed(2)}`} />
              <Info label="Language" value={guest?.languagePreference ?? 'English'} />
            </div>

            {(guest?.loyaltyTier || guest?.vipNotes || guest?.accessibilityNotes || activeReservation.specialRequests) && (
              <div className="mt-3 space-y-1 border-t border-[var(--staff-line)] pt-2">
                {guest?.loyaltyTier && <Line label="Tier" value={guest.loyaltyTier} />}
                {guest?.vipNotes && <Line label="Notes" value={guest.vipNotes} />}
                {guest?.accessibilityNotes && <Line label="Access" value={guest.accessibilityNotes} />}
                {activeReservation.specialRequests && (
                  <Line label="Requests" value={activeReservation.specialRequests} />
                )}
              </div>
            )}

            {profile?.activeSession && (
              <div className="mt-3 border-t border-[var(--staff-line)] pt-2">
                <Line label="Live step" value={profile.activeSession.currentStep ?? 'video-only'} />
                <Line label="Identity" value={profile.activeSession.identityStatus ?? 'not started'} />
                <Line label="Payment" value={profile.activeSession.paymentStatus ?? 'pending'} />
              </div>
            )}
          </div>

          <button
            type="button"
            className="mt-2 w-full rounded border border-[var(--color-hotel-accent)] bg-white py-1.5 font-medium text-[var(--color-hotel-accent)] hover:bg-[var(--staff-surface-muted)]"
            onClick={() => onPushReservation(activeReservation)}
          >
            Show on guest tablet
          </button>
        </div>
      )}
    </div>
  );
}

function guestName(reservation: Reservation): string {
  const guest = reservation.guest;
  if (!guest) return 'Guest';
  return `${guest.preferredName || guest.firstName} ${guest.lastName}`.trim();
}

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[var(--color-hotel-text-dim)]">
        {label}
      </p>
      <p className="truncate text-[var(--color-hotel-text)]">{value}</p>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-[var(--color-hotel-text-dim)]">{label}: </span>
      <span>{value}</span>
    </p>
  );
}

function StatusPill({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded-full border border-[var(--color-hotel-accent)]/50 px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--color-hotel-accent)]">
      {label.replace(/_/g, ' ')}
    </span>
  );
}
