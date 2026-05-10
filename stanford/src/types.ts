/** Guest flow phases (local navigation before / during concierge) */
export type GuestPhase =
  | 'welcome'
  | 'checkin-options'
  | 'stub-front-desk'
  | 'stub-ai'
  | 'concierge'
  | 'media';

/** Screens the concierge can push onto the guest tablet */
export type GuestScreenId =
  | 'video-only'
  | 'reservation'
  | 'passport'
  | 'payment'
  | 'signature'
  | 'key-card'
  | 'personalization'
  | 'services'
  | 'property-tour'
  | 'luggage'
  | 'custom';

export interface Guest {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  nationality: string;
  passportNumber: string;
  dateOfBirth: string;
}

export interface Room {
  id: string;
  roomNumber: string;
  type: string;
  floor: number;
  pricePerNight: number;
  currency: string;
  maxOccupancy: number;
  bedType: string;
  amenities: string[];
  description: string;
}

export interface Reservation {
  id: string;
  confirmationCode: string;
  guestId: string;
  guest?: Guest;
  roomId: string;
  room?: Room;
  checkInDate: string;
  checkOutDate: string;
  numberOfGuests: number;
  status: string;
  specialRequests?: string;
  totalAmount: number;
  currency: string;
}

/** Payloads for staff -> guest commands */
export type StaffToGuestCommand =
  | { type: 'show_screen'; screen: GuestScreenId }
  | { type: 'show_reservation'; reservation: Reservation }
  | { type: 'activate_passport_scan'; mode?: 'camera' | 'hardware' }
  | { type: 'show_payment_qr'; qrValue: string; instructions?: string }
  | { type: 'request_signature' }
  | { type: 'dispense_key_card' }
  | { type: 'show_services'; services: ServiceOffer[] }
  | { type: 'show_map' }
  | { type: 'end_session' }
  | { type: 'custom_message'; title?: string; body: string };

export type GuestToStaffEvent =
  | { type: 'screen_changed'; phase: GuestPhase; screen: GuestScreenId }
  | { type: 'reservation_confirmed'; reservationId: string }
  | { type: 'passport_scanned'; passportNumber?: string; photoDataUrl?: string }
  | { type: 'payment_complete' }
  | { type: 'signature_submitted'; dataUrl: string }
  | { type: 'key_card_received' }
  | { type: 'preferences_submitted'; temperature: number; pillows: string; celebration?: string }
  | { type: 'service_selected'; serviceId: string; label: string }
  | { type: 'luggage_info'; count: number; needsHelp: boolean; etaNote?: string }
  | { type: 'call_concierge' };

export interface ServiceOffer {
  id: string;
  category: 'dining' | 'spa' | 'other';
  name: string;
  description: string;
}

export interface JoinPayload {
  role: 'guest' | 'staff';
  roomId: string;
}

/** Staff-side event log entry for display */
export interface StaffEventLogEntry {
  id: string;
  ts: number;
  event: GuestToStaffEvent;
}
