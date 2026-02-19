'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';
import { supabase } from '@/lib/supabase';
import type { Reservation } from '@/lib/types';
import { formatDate, getNights } from '@/lib/utils';
import Link from 'next/link';

function ConfirmationContent() {
  const searchParams = useSearchParams();
  const code = searchParams.get('code');
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!code) { setLoading(false); return; }
    supabase
      .from('reservations')
      .select('*, guest:guests(*), room:rooms(*)')
      .eq('confirmation_code', code)
      .single()
      .then(({ data }) => {
        if (data) setReservation(data as unknown as Reservation);
        setLoading(false);
      });
  }, [code]);

  if (loading) {
    return <div className="text-center py-20 text-warm-gray">Loading...</div>;
  }

  if (!code || !reservation) {
    return (
      <div className="text-center py-20">
        <p className="text-warm-gray mb-4">No booking found.</p>
        <Link href="/book" className="text-gold hover:underline text-sm">Make a reservation</Link>
      </div>
    );
  }

  const nights = getNights(reservation.check_in_date, reservation.check_out_date);

  return (
    <div className="max-w-lg mx-auto text-center space-y-8">
      {/* Success icon */}
      <div className="flex justify-center">
        <div className="w-16 h-16 rounded-full bg-success/10 border border-success/25 flex items-center justify-center">
          <svg className="w-8 h-8 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-light text-charcoal">Booking Confirmed</h1>
        <p className="text-warm-gray text-sm mt-2">Your reservation has been successfully created</p>
      </div>

      {/* Confirmation code */}
      <div className="bg-white border border-warm-gray-lighter rounded-xl p-8">
        <p className="text-xs font-semibold tracking-widest uppercase text-gold mb-2">Confirmation Code</p>
        <p className="text-3xl font-mono font-semibold text-charcoal tracking-wider">{code}</p>
      </div>

      {/* Booking summary */}
      <div className="bg-white border border-warm-gray-lighter rounded-xl p-6 text-left space-y-3 text-sm">
        {reservation.guest && (
          <Row label="Guest" value={`${reservation.guest.first_name} ${reservation.guest.last_name}`} />
        )}
        {reservation.room && (
          <Row label="Room" value={`${reservation.room.room_number} — ${reservation.room.type}`} />
        )}
        <Row label="Check-in" value={formatDate(reservation.check_in_date)} />
        <Row label="Check-out" value={formatDate(reservation.check_out_date)} />
        <Row label="Duration" value={`${nights} night${nights > 1 ? 's' : ''}`} />
        <Row label="Guests" value={String(reservation.number_of_guests)} />
        <hr className="border-warm-gray-lighter" />
        <div className="flex justify-between font-medium">
          <span>Total</span>
          <span>{reservation.currency} {reservation.total_amount.toLocaleString()}</span>
        </div>
      </div>

      {/* Next steps */}
      <div className="bg-gold/5 border border-gold/15 rounded-xl p-6 text-sm text-charcoal-light space-y-2">
        <p className="font-medium text-charcoal">What&apos;s next?</p>
        <p>Head to the check-in kiosk and share your name or confirmation code to get started with our AI concierge.</p>
      </div>

      <Link href="/book" className="inline-block text-gold text-sm hover:underline">
        Make another booking
      </Link>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-warm-gray">{label}</span>
      <span className="text-charcoal font-medium">{value}</span>
    </div>
  );
}

export default function ConfirmationPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-16">
      <Suspense fallback={<div className="text-center py-20 text-warm-gray">Loading...</div>}>
        <ConfirmationContent />
      </Suspense>
    </div>
  );
}
