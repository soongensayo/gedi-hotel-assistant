import type { Reservation } from '../types';

type Props = {
  reservation: Reservation;
  onConfirm: () => void;
};

export function ReservationScreen({ reservation, onConfirm }: Props) {
  const guest = reservation.guest;
  const room = reservation.room;
  return (
    <div className="space-y-4">
      <h3 className="text-center text-xl text-[var(--color-hotel-accent)]">
        Confirm your reservation
      </h3>
      <div className="rounded-lg border border-[var(--color-hotel-border)] bg-white/5 p-4 text-sm">
        <p>
          <span className="text-[var(--color-hotel-text-dim)]">Confirmation</span>{' '}
          <span className="font-mono text-[var(--color-hotel-accent)]">
            {reservation.confirmationCode}
          </span>
        </p>
        {guest && (
          <p className="mt-2">
            Guest: {guest.firstName} {guest.lastName}
          </p>
        )}
        {room && (
          <>
            <p className="mt-1">
              Room {room.roomNumber} · {room.type}
            </p>
            <p className="mt-1 text-[var(--color-hotel-text-dim)]">
              {reservation.checkInDate} → {reservation.checkOutDate}
            </p>
          </>
        )}
        <p className="mt-2">
          {reservation.currency} {reservation.totalAmount.toFixed(2)} total
        </p>
      </div>
      <p className="text-center text-xs text-[var(--color-hotel-text-dim)]">
        Your concierge will confirm details with you on the call.
      </p>
      <button
        type="button"
        className="w-full rounded-lg bg-[var(--color-hotel-accent)] py-3 font-medium text-black"
        onClick={onConfirm}
      >
        Yes, this is my reservation
      </button>
    </div>
  );
}
