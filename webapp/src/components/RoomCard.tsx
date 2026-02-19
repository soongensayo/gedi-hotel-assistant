import type { Room } from '@/lib/types';

const typeLabels: Record<string, string> = {
  standard: 'Standard',
  deluxe: 'Deluxe',
  suite: 'Suite',
  penthouse: 'Penthouse',
};

interface Props {
  room: Room;
  selected: boolean;
  onSelect: () => void;
}

export function RoomCard({ room, selected, onSelect }: Props) {
  return (
    <button
      onClick={onSelect}
      className={`
        w-full text-left p-5 rounded-xl border transition-all duration-200
        ${selected
          ? 'border-gold bg-gold/5 shadow-sm'
          : 'border-warm-gray-lighter bg-white hover:border-gold/40 hover:shadow-sm'
        }
      `}
    >
      <div className="flex justify-between items-start mb-3">
        <div>
          <span className="text-[10px] font-semibold tracking-widest uppercase text-gold">
            {typeLabels[room.type] || room.type}
          </span>
          <p className="text-lg font-medium text-charcoal">Room {room.room_number}</p>
          <p className="text-xs text-warm-gray">Floor {room.floor} · {room.bed_type} · Up to {room.max_occupancy} guests</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-charcoal">
            {room.currency} {room.price_per_night}
          </p>
          <p className="text-[10px] text-warm-gray">per night</p>
        </div>
      </div>

      {room.description && (
        <p className="text-sm text-warm-gray mb-3">{room.description}</p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {room.amenities.slice(0, 5).map((a) => (
          <span key={a} className="text-[10px] px-2 py-0.5 rounded-full bg-cream-dark text-warm-gray">
            {a}
          </span>
        ))}
        {room.amenities.length > 5 && (
          <span className="text-[10px] px-2 py-0.5 text-warm-gray">+{room.amenities.length - 5} more</span>
        )}
      </div>

      {selected && (
        <div className="mt-3 flex items-center gap-1.5 text-gold text-xs font-medium">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Selected
        </div>
      )}
    </button>
  );
}
