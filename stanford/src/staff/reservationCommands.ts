import type { Reservation, StaffToGuestCommand } from '../types';

export function pushReservationCommand(
  push: (c: StaffToGuestCommand) => void,
  r: Reservation
): void {
  push({ type: 'show_reservation', reservation: r });
}
