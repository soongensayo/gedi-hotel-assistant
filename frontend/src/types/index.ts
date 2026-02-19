// =============================================================================
// Shared TypeScript Types
// =============================================================================

// --- Check-in Flow ---

export type CheckinStep =
  | 'welcome'
  | 'identify'
  | 'passport-scan'
  | 'reservation-found'
  // | 'room-selection' // Room is pre-selected on the booking website
  | 'upgrade-offer'
  | 'payment'
  | 'key-card'
  | 'farewell';

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
  type: 'standard' | 'deluxe' | 'suite' | 'penthouse';
  floor: number;
  pricePerNight: number;
  currency: string;
  maxOccupancy: number;
  bedType: string;
  amenities: string[];
  imageUrl?: string;
  isAvailable: boolean;
  description: string;
}

export interface RoomUpgrade {
  id: string;
  fromRoomType: string;
  toRoomType: string;
  additionalCostPerNight: number;
  currency: string;
  description: string;
  highlights: string[];
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
  status: 'confirmed' | 'checked-in' | 'checked-out' | 'cancelled';
  specialRequests?: string;
  totalAmount: number;
  currency: string;
}

export interface HotelInfo {
  id: string;
  name: string;
  address: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  description: string;
  amenities: string[];
  checkInTime: string;
  checkOutTime: string;
  wifiPassword: string;
  emergencyContact: string;
  nearbyAttractions: NearbyAttraction[];
}

export interface NearbyAttraction {
  name: string;
  distance: string;
  description: string;
}

// --- Passport Scanner (Mock) ---

export interface PassportScanResult {
  success: boolean;
  data?: {
    firstName: string;
    lastName: string;
    nationality: string;
    passportNumber: string;
    dateOfBirth: string;
    expiryDate: string;
    gender: string;
    photoUrl?: string;
  };
  error?: string;
}

// --- Payment (Mock) ---

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  amount?: number;
  currency?: string;
  last4?: string;
  error?: string;
}

// --- Conversation / AI ---

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface ConversationState {
  messages: ChatMessage[];
  isLoading: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  error: string | null;
}

// --- Avatar ---

export interface AvatarState {
  isConnected: boolean;
  isLoading: boolean;
  isSpeaking: boolean;
  videoStream: MediaStream | null;
  error: string | null;
}

// --- Voice ---

export interface VoiceState {
  isRecording: boolean;
  isProcessing: boolean;
  audioLevel: number;
  transcript: string;
  error: string | null;
}
