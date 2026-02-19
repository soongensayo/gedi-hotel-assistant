'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Room } from '@/lib/types';
import { RoomCard } from './RoomCard';
import { todayStr, tomorrowStr } from '@/lib/utils';

interface Props {
  selectedRoomId: string;
  checkIn: string;
  checkOut: string;
  numberOfGuests: number;
  onSelect: (roomId: string) => void;
  onDatesChange: (checkIn: string, checkOut: string) => void;
  onGuestsChange: (n: number) => void;
  onNext: () => void;
  onBack: () => void;
}

export function RoomSelectionStep({
  selectedRoomId, checkIn, checkOut, numberOfGuests,
  onSelect, onDatesChange, onGuestsChange, onNext, onBack,
}: Props) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('rooms')
        .select('*')
        .eq('is_available', true)
        .order('price_per_night', { ascending: true });
      if (!error && data) setRooms(data as Room[]);
      setLoading(false);
    }
    load();
  }, []);

  const canProceed = selectedRoomId && checkIn && checkOut && checkIn < checkOut;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-light tracking-tight text-charcoal">Select Your Room</h2>
        <p className="text-warm-gray text-sm mt-1">Choose a room and your stay dates</p>
      </div>

      {/* Date & guest inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-charcoal-light tracking-wide">Check-in</span>
          <input
            type="date"
            value={checkIn}
            min={todayStr()}
            onChange={(e) => onDatesChange(e.target.value, checkOut)}
            className="px-4 py-2.5 text-sm border border-warm-gray-light rounded-lg bg-white focus:outline-none focus:border-gold transition-colors"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-charcoal-light tracking-wide">Check-out</span>
          <input
            type="date"
            value={checkOut}
            min={checkIn || todayStr()}
            onChange={(e) => onDatesChange(checkIn, e.target.value)}
            className="px-4 py-2.5 text-sm border border-warm-gray-light rounded-lg bg-white focus:outline-none focus:border-gold transition-colors"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-charcoal-light tracking-wide">Guests</span>
          <select
            value={numberOfGuests}
            onChange={(e) => onGuestsChange(Number(e.target.value))}
            className="px-4 py-2.5 text-sm border border-warm-gray-light rounded-lg bg-white focus:outline-none focus:border-gold transition-colors"
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>{n} {n === 1 ? 'Guest' : 'Guests'}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Room list */}
      {loading ? (
        <div className="py-12 text-center text-warm-gray text-sm">Loading available rooms...</div>
      ) : rooms.length === 0 ? (
        <div className="py-12 text-center text-warm-gray text-sm">No rooms available. Please check back later.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              selected={selectedRoomId === room.id}
              onSelect={() => onSelect(room.id)}
            />
          ))}
        </div>
      )}

      <div className="flex justify-between pt-2">
        <button onClick={onBack} className="px-6 py-3 text-sm text-warm-gray hover:text-charcoal transition-colors">
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!canProceed}
          className="px-8 py-3 bg-gold text-white text-sm font-medium rounded-lg hover:bg-gold-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Review Booking
        </button>
      </div>
    </div>
  );
}
