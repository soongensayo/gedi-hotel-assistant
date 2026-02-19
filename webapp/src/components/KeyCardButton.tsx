'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Reservation } from '@/lib/types';
import { formatDate } from '@/lib/utils';

interface KeyCardData {
  confirmationCode: string;
  guestName: string;
  roomNumber: string;
  roomType: string;
  floor: number;
  checkIn: string;
  checkOut: string;
  activatedAt: string;
}

function getStoredKey(): KeyCardData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('digital_key');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function activateKeyCard(reservation: Reservation) {
  const data: KeyCardData = {
    confirmationCode: reservation.confirmation_code,
    guestName: reservation.guest
      ? `${reservation.guest.first_name} ${reservation.guest.last_name}`
      : 'Guest',
    roomNumber: reservation.room?.room_number ?? '—',
    roomType: reservation.room?.type ?? 'standard',
    floor: reservation.room?.floor ?? 1,
    checkIn: reservation.check_in_date,
    checkOut: reservation.check_out_date,
    activatedAt: new Date().toISOString(),
  };
  localStorage.setItem('digital_key', JSON.stringify(data));
  window.dispatchEvent(new Event('keycard-update'));
}

export function KeyCardButton() {
  const [open, setOpen] = useState(false);
  const [keyData, setKeyData] = useState<KeyCardData | null>(null);
  const [pulse, setPulse] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lookupCode, setLookupCode] = useState('');
  const [lookupError, setLookupError] = useState('');

  const refresh = useCallback(() => setKeyData(getStoredKey()), []);

  useEffect(() => {
    refresh();
    window.addEventListener('keycard-update', refresh);
    return () => window.removeEventListener('keycard-update', refresh);
  }, [refresh]);

  useEffect(() => {
    if (!open || !keyData) return;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 2000);
    return () => clearTimeout(t);
  }, [open, keyData]);

  async function handleLookup() {
    if (!lookupCode.trim()) return;
    setLoading(true);
    setLookupError('');
    try {
      const { data } = await supabase
        .from('reservations')
        .select('*, guest:guests(*), room:rooms(*)')
        .eq('confirmation_code', lookupCode.trim().toUpperCase())
        .single();

      if (!data) {
        setLookupError('No reservation found with that code.');
      } else {
        activateKeyCard(data as unknown as Reservation);
        setLookupCode('');
        refresh();
      }
    } catch {
      setLookupError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleDeactivate() {
    localStorage.removeItem('digital_key');
    refresh();
  }

  return (
    <>
      {/* Floating trigger */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2.5 px-6 py-3.5 bg-charcoal text-white rounded-full shadow-lg shadow-charcoal/25 hover:bg-charcoal-light active:scale-95 transition-all cursor-pointer"
      >
        <svg className="w-5 h-5 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
        </svg>
        <span className="text-sm font-medium tracking-wide">Digital Key</span>
        {keyData && (
          <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
        )}
      </button>

      {/* Backdrop + Sheet */}
      {open && (
        <div className="fixed inset-0 z-[70]">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-[fadeIn_200ms_ease-out]"
            onClick={() => setOpen(false)}
          />

          <div className="absolute bottom-0 left-0 right-0 animate-[slideUp_300ms_ease-out] max-h-[90vh] overflow-y-auto">
            <div className="max-w-md mx-auto px-4 pb-8 pt-4">
              {/* Drag handle */}
              <div className="flex justify-center mb-4">
                <div className="w-10 h-1 rounded-full bg-white/40" />
              </div>

              {keyData ? (
                <ActiveKeyCard
                  data={keyData}
                  pulse={pulse}
                  onDeactivate={handleDeactivate}
                  onClose={() => setOpen(false)}
                />
              ) : (
                <EmptyKeyCard
                  lookupCode={lookupCode}
                  lookupError={lookupError}
                  loading={loading}
                  onCodeChange={setLookupCode}
                  onLookup={handleLookup}
                  onClose={() => setOpen(false)}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ActiveKeyCard({
  data,
  pulse,
  onDeactivate,
  onClose,
}: {
  data: KeyCardData;
  pulse: boolean;
  onDeactivate: () => void;
  onClose: () => void;
}) {
  const roomTypeLabel: Record<string, string> = {
    standard: 'Standard Room',
    deluxe: 'Deluxe Room',
    suite: 'Suite',
    penthouse: 'Penthouse Suite',
  };

  return (
    <div className="space-y-4">
      {/* The card */}
      <div className="relative bg-gradient-to-br from-charcoal via-charcoal to-charcoal-light rounded-2xl p-6 text-white overflow-hidden shadow-2xl">
        {/* Decorative pattern */}
        <div className="absolute top-0 right-0 w-40 h-40 opacity-[0.04]">
          <svg viewBox="0 0 100 100" fill="currentColor">
            {Array.from({ length: 5 }).map((_, i) => (
              <circle key={i} cx="50" cy="50" r={10 + i * 10} fill="none" stroke="currentColor" strokeWidth="0.5" />
            ))}
          </svg>
        </div>

        {/* Hotel branding */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-[10px] tracking-[0.3em] uppercase text-gold font-medium">The Grand Azure</p>
            <p className="text-[9px] tracking-[0.15em] uppercase text-warm-gray mt-0.5">Hotel & Residences</p>
          </div>
          <div className="w-8 h-8 rounded-full bg-gold/15 border border-gold/30 flex items-center justify-center">
            <svg className="w-4 h-4 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
        </div>

        {/* Room number — big & prominent */}
        <div className="mb-6">
          <p className="text-[10px] tracking-[0.2em] uppercase text-warm-gray mb-1">Room</p>
          <p className="text-5xl font-light tracking-wide">{data.roomNumber}</p>
          <p className="text-xs text-gold/80 mt-1">{roomTypeLabel[data.roomType] || data.roomType} — Floor {data.floor}</p>
        </div>

        {/* Guest & dates */}
        <div className="grid grid-cols-2 gap-4 text-[11px] mb-6">
          <div>
            <p className="text-warm-gray/70 uppercase tracking-wider text-[9px] mb-0.5">Guest</p>
            <p className="text-white/90">{data.guestName}</p>
          </div>
          <div>
            <p className="text-warm-gray/70 uppercase tracking-wider text-[9px] mb-0.5">Booking</p>
            <p className="text-white/90 font-mono text-[10px]">{data.confirmationCode}</p>
          </div>
          <div>
            <p className="text-warm-gray/70 uppercase tracking-wider text-[9px] mb-0.5">Check-in</p>
            <p className="text-white/90">{formatDate(data.checkIn)}</p>
          </div>
          <div>
            <p className="text-warm-gray/70 uppercase tracking-wider text-[9px] mb-0.5">Check-out</p>
            <p className="text-white/90">{formatDate(data.checkOut)}</p>
          </div>
        </div>

        {/* NFC tap area */}
        <div className="flex items-center justify-center gap-3 py-4 border-t border-white/10">
          <div className={`relative w-10 h-10 rounded-full border-2 border-gold/50 flex items-center justify-center ${pulse ? 'animate-pulse' : ''}`}>
            <svg className="w-5 h-5 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
            </svg>
            {pulse && (
              <>
                <span className="absolute inset-0 rounded-full border-2 border-gold/30 animate-ping" />
              </>
            )}
          </div>
          <div>
            <p className="text-xs text-white/80 font-medium">Hold near door lock</p>
            <p className="text-[10px] text-warm-gray">NFC digital key active</p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onClose}
          className="flex-1 py-3 text-sm font-medium text-white bg-white/10 backdrop-blur rounded-xl hover:bg-white/15 transition-colors cursor-pointer"
        >
          Close
        </button>
        <button
          onClick={onDeactivate}
          className="py-3 px-4 text-sm text-error/80 bg-white/10 backdrop-blur rounded-xl hover:bg-white/15 transition-colors cursor-pointer"
        >
          Remove Key
        </button>
      </div>
    </div>
  );
}

function EmptyKeyCard({
  lookupCode,
  lookupError,
  loading,
  onCodeChange,
  onLookup,
  onClose,
}: {
  lookupCode: string;
  lookupError: string;
  loading: boolean;
  onCodeChange: (v: string) => void;
  onLookup: () => void;
  onClose: () => void;
}) {
  return (
    <div className="bg-white rounded-2xl p-8 text-center space-y-6 shadow-2xl">
      <div className="flex justify-center">
        <div className="w-16 h-16 rounded-full bg-warm-gray-lighter/60 flex items-center justify-center">
          <svg className="w-8 h-8 text-warm-gray" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
          </svg>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-light text-charcoal">No Active Key Card</h3>
        <p className="text-sm text-warm-gray mt-1">
          Enter your confirmation code to activate your digital room key.
        </p>
      </div>

      <div className="space-y-3">
        <input
          type="text"
          value={lookupCode}
          onChange={(e) => onCodeChange(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && onLookup()}
          placeholder="e.g. GAH-2026-XXXX"
          className="w-full px-4 py-3 border border-warm-gray-lighter rounded-lg text-center font-mono text-sm tracking-wider placeholder:text-warm-gray-light focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold/30"
        />
        {lookupError && <p className="text-xs text-error">{lookupError}</p>}
        <button
          onClick={onLookup}
          disabled={loading || !lookupCode.trim()}
          className="w-full py-3 bg-gold text-white text-sm font-medium rounded-lg hover:bg-gold-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {loading ? 'Looking up...' : 'Activate Key Card'}
        </button>
      </div>

      <button
        onClick={onClose}
        className="text-sm text-warm-gray hover:text-charcoal transition-colors cursor-pointer"
      >
        Close
      </button>
    </div>
  );
}
