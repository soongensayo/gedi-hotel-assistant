'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { GuestFormData, Room } from '@/lib/types';
import { generateConfirmationCode, computeTotalAmount, todayStr, tomorrowStr } from '@/lib/utils';
import { GuestInfoStep } from './GuestInfoStep';
import { RoomSelectionStep } from './RoomSelectionStep';
import { ReviewStep } from './ReviewStep';

const STEPS = ['Guest Details', 'Room Selection', 'Review'];

export function BookingForm() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [guest, setGuest] = useState<GuestFormData>({
    first_name: '', last_name: '', email: '', phone: '',
    nationality: '', passport_number: '', date_of_birth: '',
  });
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [checkIn, setCheckIn] = useState(todayStr());
  const [checkOut, setCheckOut] = useState(tomorrowStr());
  const [numberOfGuests, setNumberOfGuests] = useState(1);
  const [specialRequests, setSpecialRequests] = useState('');
  const [rooms, setRooms] = useState<Room[]>([]);

  useEffect(() => {
    supabase.from('rooms').select('*').eq('is_available', true).then(({ data }) => {
      if (data) setRooms(data as Room[]);
    });
  }, []);

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) || null;

  const handleSubmit = async () => {
    if (!selectedRoom) return;
    setIsSubmitting(true);
    setError('');

    try {
      // 1. Upsert guest
      const guestPayload = {
        first_name: guest.first_name.trim(),
        last_name: guest.last_name.trim(),
        email: guest.email.trim() || null,
        phone: guest.phone.trim() || null,
        nationality: guest.nationality.trim() || null,
        passport_number: guest.passport_number.trim() || null,
        date_of_birth: guest.date_of_birth || null,
      };

      let guestId: string;

      if (guestPayload.passport_number) {
        const { data: upserted, error: guestErr } = await supabase
          .from('guests')
          .upsert(guestPayload, { onConflict: 'passport_number' })
          .select('id')
          .single();
        if (guestErr) throw new Error(`Failed to save guest: ${guestErr.message}`);
        guestId = upserted.id;
      } else {
        const { data: inserted, error: guestErr } = await supabase
          .from('guests')
          .insert(guestPayload)
          .select('id')
          .single();
        if (guestErr) throw new Error(`Failed to save guest: ${guestErr.message}`);
        guestId = inserted.id;
      }

      // 2. Create reservation
      const confirmationCode = generateConfirmationCode();
      const totalAmount = computeTotalAmount(selectedRoom.price_per_night, checkIn, checkOut);

      const { error: resErr } = await supabase.from('reservations').insert({
        confirmation_code: confirmationCode,
        guest_id: guestId,
        room_id: selectedRoomId,
        check_in_date: checkIn,
        check_out_date: checkOut,
        number_of_guests: numberOfGuests,
        status: 'confirmed',
        special_requests: specialRequests.trim() || null,
        total_amount: totalAmount,
        currency: selectedRoom.currency,
      });

      if (resErr) throw new Error(`Failed to create reservation: ${resErr.message}`);

      // 3. Redirect to confirmation
      router.push(`/confirmation?code=${confirmationCode}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                i <= step ? 'bg-gold text-white' : 'bg-warm-gray-lighter text-warm-gray'
              }`}>
                {i < step ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span className={`text-xs hidden sm:inline ${i <= step ? 'text-charcoal font-medium' : 'text-warm-gray'}`}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`w-12 h-px ${i < step ? 'bg-gold' : 'bg-warm-gray-lighter'}`} />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-error/10 border border-error/20 rounded-lg px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}

      {/* Steps */}
      {step === 0 && (
        <GuestInfoStep data={guest} onChange={setGuest} onNext={() => setStep(1)} />
      )}
      {step === 1 && (
        <RoomSelectionStep
          selectedRoomId={selectedRoomId}
          checkIn={checkIn}
          checkOut={checkOut}
          numberOfGuests={numberOfGuests}
          onSelect={setSelectedRoomId}
          onDatesChange={(ci, co) => { setCheckIn(ci); setCheckOut(co); }}
          onGuestsChange={setNumberOfGuests}
          onNext={() => setStep(2)}
          onBack={() => setStep(0)}
        />
      )}
      {step === 2 && (
        <ReviewStep
          guest={guest}
          room={selectedRoom}
          checkIn={checkIn}
          checkOut={checkOut}
          numberOfGuests={numberOfGuests}
          specialRequests={specialRequests}
          onSpecialRequestsChange={setSpecialRequests}
          onSubmit={handleSubmit}
          onBack={() => setStep(1)}
          isSubmitting={isSubmitting}
        />
      )}
    </div>
  );
}
