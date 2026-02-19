'use client';

import type { GuestFormData, Room } from '@/lib/types';
import { formatDate, getNights, computeTotalAmount } from '@/lib/utils';

interface Props {
  guest: GuestFormData;
  room: Room | null;
  checkIn: string;
  checkOut: string;
  numberOfGuests: number;
  specialRequests: string;
  onSpecialRequestsChange: (v: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  isSubmitting: boolean;
}

export function ReviewStep({
  guest, room, checkIn, checkOut, numberOfGuests, specialRequests,
  onSpecialRequestsChange, onSubmit, onBack, isSubmitting,
}: Props) {
  if (!room) return null;

  const nights = getNights(checkIn, checkOut);
  const total = computeTotalAmount(room.price_per_night, checkIn, checkOut);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-light tracking-tight text-charcoal">Review Your Booking</h2>
        <p className="text-warm-gray text-sm mt-1">Please confirm your details before submitting</p>
      </div>

      <div className="bg-white border border-warm-gray-lighter rounded-xl p-6 space-y-5">
        {/* Guest info */}
        <div>
          <h3 className="text-xs font-semibold tracking-widest uppercase text-gold mb-3">Guest</h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <Row label="Name" value={`${guest.first_name} ${guest.last_name}`} />
            {guest.email && <Row label="Email" value={guest.email} />}
            {guest.phone && <Row label="Phone" value={guest.phone} />}
            {guest.nationality && <Row label="Nationality" value={guest.nationality} />}
            {guest.passport_number && <Row label="Passport" value={guest.passport_number} />}
          </div>
        </div>

        <hr className="border-warm-gray-lighter" />

        {/* Room info */}
        <div>
          <h3 className="text-xs font-semibold tracking-widest uppercase text-gold mb-3">Room</h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <Row label="Room" value={`${room.room_number} — ${room.type.charAt(0).toUpperCase() + room.type.slice(1)}`} />
            <Row label="Floor" value={String(room.floor)} />
            <Row label="Bed" value={room.bed_type || '—'} />
            <Row label="Guests" value={String(numberOfGuests)} />
          </div>
        </div>

        <hr className="border-warm-gray-lighter" />

        {/* Stay info */}
        <div>
          <h3 className="text-xs font-semibold tracking-widest uppercase text-gold mb-3">Stay</h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <Row label="Check-in" value={formatDate(checkIn)} />
            <Row label="Check-out" value={formatDate(checkOut)} />
            <Row label="Duration" value={`${nights} night${nights > 1 ? 's' : ''}`} />
            <Row label="Rate" value={`${room.currency} ${room.price_per_night}/night`} />
          </div>
        </div>

        <hr className="border-warm-gray-lighter" />

        {/* Total */}
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium text-charcoal">Total Amount</span>
          <span className="text-xl font-semibold text-charcoal">{room.currency} {total.toLocaleString()}</span>
        </div>
      </div>

      {/* Special requests */}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-charcoal-light tracking-wide">Special Requests (optional)</span>
        <textarea
          value={specialRequests}
          onChange={(e) => onSpecialRequestsChange(e.target.value)}
          placeholder="Extra pillows, late check-in, celebrations..."
          rows={3}
          className="px-4 py-2.5 text-sm border border-warm-gray-light rounded-lg bg-white focus:outline-none focus:border-gold transition-colors placeholder:text-warm-gray/50 resize-none"
        />
      </label>

      <div className="flex justify-between pt-2">
        <button onClick={onBack} className="px-6 py-3 text-sm text-warm-gray hover:text-charcoal transition-colors">
          Back
        </button>
        <button
          onClick={onSubmit}
          disabled={isSubmitting}
          className="px-10 py-3 bg-gold text-white text-sm font-medium rounded-lg hover:bg-gold-dark transition-colors disabled:opacity-60"
        >
          {isSubmitting ? 'Booking...' : 'Confirm Booking'}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-warm-gray">{label}</span>
      <span className="text-charcoal font-medium">{value}</span>
    </>
  );
}
