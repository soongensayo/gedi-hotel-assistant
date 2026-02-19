export interface Guest {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  nationality: string | null;
  passport_number: string | null;
  date_of_birth: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Room {
  id: string;
  room_number: string;
  type: 'standard' | 'deluxe' | 'suite' | 'penthouse';
  floor: number;
  price_per_night: number;
  currency: string;
  max_occupancy: number;
  bed_type: string | null;
  amenities: string[];
  image_url: string | null;
  is_available: boolean;
  description: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Reservation {
  id: string;
  confirmation_code: string;
  guest_id: string;
  room_id: string;
  check_in_date: string;
  check_out_date: string;
  number_of_guests: number;
  status: 'confirmed' | 'checked-in' | 'checked-out' | 'cancelled';
  special_requests: string | null;
  total_amount: number;
  currency: string;
  created_at?: string;
  updated_at?: string;
  // Joined data
  guest?: Guest;
  room?: Room;
}

export interface GuestFormData {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  nationality: string;
  passport_number: string;
  date_of_birth: string;
}

export interface BookingFormData {
  guest: GuestFormData;
  room_id: string;
  check_in_date: string;
  check_out_date: string;
  number_of_guests: number;
  special_requests: string;
}
