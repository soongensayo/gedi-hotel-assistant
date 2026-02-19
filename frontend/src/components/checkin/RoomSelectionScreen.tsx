// =============================================================================
// RoomSelectionScreen — TEMPORARILY DISABLED
// Room is now pre-selected on the booking website before the guest arrives.
// This component is kept for easy restoration if room selection is re-enabled.
// =============================================================================

/*
import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useCheckinStore } from '../../stores/checkinStore';
import { getAvailableRooms } from '../../services/api';
import type { Room } from '../../types';

export function RoomSelectionScreen() {
  const { reservation, selectedRoom, setSelectedRoom, setPendingMessage } = useCheckinStore();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadRooms() {
      try {
        const available = await getAvailableRooms(
          reservation?.checkInDate,
          reservation?.checkOutDate
        );
        setRooms(available);
        // Auto-select the reserved room if it matches
        if (reservation?.room) {
          setSelectedRoom(reservation.room);
        } else if (available.length > 0) {
          setSelectedRoom(available[0]);
        }
      } catch (err) {
        console.error('Failed to load rooms:', err);
      } finally {
        setLoading(false);
      }
    }
    loadRooms();
  }, [reservation, setSelectedRoom]);

  const roomTypeColors: Record<string, string> = {
    standard: 'text-hotel-text-dim',
    deluxe: 'text-hotel-accent',
    suite: 'text-hotel-gold',
    penthouse: 'text-hotel-accent-2',
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-hotel-accent/30 border-t-hotel-accent rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full px-8 py-6 gap-6">
      <div className="text-center">
        <h2 className="text-2xl font-light text-hotel-text">Select Your Room</h2>
        <p className="text-hotel-text-dim text-sm mt-1">Choose from available rooms</p>
      </div>

      <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4">
        {rooms.map((room) => (
          <Card
            key={room.id}
            onClick={() => setSelectedRoom(room)}
            selected={selectedRoom?.id === room.id}
            className="flex flex-col gap-3"
          >
            <div className="flex justify-between items-start">
              <div>
                <p className={`text-xs uppercase tracking-wider font-medium ${roomTypeColors[room.type] || 'text-hotel-text-dim'}`}>
                  {room.type}
                </p>
                <p className="text-hotel-text text-lg font-medium">Room {room.roomNumber}</p>
                <p className="text-hotel-text-dim text-xs">Floor {room.floor} · {room.bedType}</p>
              </div>
              <div className="text-right">
                <p className="text-hotel-gold font-medium">
                  {room.currency} {room.pricePerNight}
                </p>
                <p className="text-hotel-text-dim text-xs">per night</p>
              </div>
            </div>
            <p className="text-hotel-text-dim text-sm">{room.description}</p>
            <div className="flex flex-wrap gap-1.5">
              {room.amenities.slice(0, 4).map((amenity) => (
                <span
                  key={amenity}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-hotel-text-dim"
                >
                  {amenity}
                </span>
              ))}
              {room.amenities.length > 4 && (
                <span className="text-[10px] px-2 py-0.5 text-hotel-text-dim">
                  +{room.amenities.length - 4} more
                </span>
              )}
            </div>
          </Card>
        ))}
      </div>

      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => setPendingMessage("Actually, let me go back to review my reservation.")}>
          Back
        </Button>
        <Button
          onClick={() => setPendingMessage(
            selectedRoom
              ? `I'd like Room ${selectedRoom.roomNumber}, the ${selectedRoom.type} room.`
              : "I'll go with the assigned room."
          )}
          disabled={!selectedRoom}
        >
          Confirm Room
        </Button>
      </div>
    </div>
  );
}
*/
