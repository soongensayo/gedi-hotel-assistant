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
  email?: string | null;
  phone?: string | null;
  nationality?: string | null;
  passportNumber?: string | null;
  passportPath?: string | null;
  preferredName?: string | null;
  languagePreference?: string | null;
  loyaltyTier?: string | null;
  vipNotes?: string | null;
  accessibilityNotes?: string | null;
  identityVerifiedAt?: string | null;
  dateOfBirth?: string | null;
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
  roomForRobot?: string | null;
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
  source?: string | null;
  arrivalStatus?: string | null;
  paymentStatus?: string | null;
  scheduledArrivalAt?: string | null;
  checkedInAt?: string | null;
}

export interface CheckinSession {
  id: string;
  reservationId: string | null;
  guestId: string | null;
  sessionKey: string | null;
  channel: string;
  status: string;
  currentStep: string | null;
  identityStatus: string | null;
  paymentStatus: string | null;
  keyStatus: string | null;
  roomPreferences: Record<string, unknown>;
  luggage: Record<string, unknown>;
  selectedServices: unknown[];
  artifacts: Record<string, unknown>;
  staffNotes?: string | null;
  startedAt?: string | null;
  lastEventAt?: string | null;
  completedAt?: string | null;
}

export interface CheckinEventRecord {
  id: string;
  sessionId: string | null;
  reservationId: string | null;
  guestId: string | null;
  eventType: string;
  eventPayload: Record<string, unknown>;
  createdAt: string;
}

export interface ReservationProfile {
  reservation: Reservation;
  activeSession: CheckinSession | null;
  recentEvents: CheckinEventRecord[];
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
