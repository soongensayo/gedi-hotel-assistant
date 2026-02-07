import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useCheckinStore } from '../../stores/checkinStore';

export function ReservationFoundScreen() {
  const { reservation, guest, setStep } = useCheckinStore();

  if (!reservation) return null;

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 gap-6">
      <div className="text-center">
        <div className="w-14 h-14 rounded-full bg-hotel-success/10 border border-hotel-success/30 flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-hotel-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-light text-hotel-text">Reservation Found</h2>
      </div>

      <Card className="w-full max-w-lg">
        <div className="space-y-4">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-hotel-text-dim text-xs uppercase tracking-wider">Guest</p>
              <p className="text-hotel-text text-lg font-medium">
                {guest ? `${guest.firstName} ${guest.lastName}` : 'Valued Guest'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-hotel-text-dim text-xs uppercase tracking-wider">Confirmation</p>
              <p className="text-hotel-accent font-mono">{reservation.confirmationCode}</p>
            </div>
          </div>

          <div className="h-px bg-white/10" />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-hotel-text-dim text-xs uppercase tracking-wider">Check-in</p>
              <p className="text-hotel-text">{new Date(reservation.checkInDate).toLocaleDateString()}</p>
            </div>
            <div>
              <p className="text-hotel-text-dim text-xs uppercase tracking-wider">Check-out</p>
              <p className="text-hotel-text">{new Date(reservation.checkOutDate).toLocaleDateString()}</p>
            </div>
            <div>
              <p className="text-hotel-text-dim text-xs uppercase tracking-wider">Guests</p>
              <p className="text-hotel-text">{reservation.numberOfGuests}</p>
            </div>
            <div>
              <p className="text-hotel-text-dim text-xs uppercase tracking-wider">Total</p>
              <p className="text-hotel-gold font-medium">
                {reservation.currency} {reservation.totalAmount.toLocaleString()}
              </p>
            </div>
          </div>

          {reservation.specialRequests && (
            <>
              <div className="h-px bg-white/10" />
              <div>
                <p className="text-hotel-text-dim text-xs uppercase tracking-wider">Special Requests</p>
                <p className="text-hotel-text text-sm mt-1">{reservation.specialRequests}</p>
              </div>
            </>
          )}
        </div>
      </Card>

      <div className="flex gap-4">
        <Button variant="secondary" onClick={() => setStep('identify')}>
          Not Me
        </Button>
        <Button onClick={() => setStep('room-selection')}>
          Confirm & Continue
        </Button>
      </div>
    </div>
  );
}
