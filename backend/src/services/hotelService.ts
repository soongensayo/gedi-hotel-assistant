import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

// Supabase client (if configured)
let supabase: SupabaseClient | null = null;

if (config.supabaseUrl && config.supabaseServiceKey) {
  supabase = createClient(config.supabaseUrl, config.supabaseServiceKey);
} else if (config.supabaseUrl && config.supabaseAnonKey) {
  supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
}

// =============================================================================
// In-memory mock data (used when Supabase is not configured)
// =============================================================================

const MOCK_HOTEL_INFO = {
  id: '1',
  name: 'The Grand Azure Hotel',
  address: '1 Marina Boulevard',
  city: 'Singapore',
  country: 'Singapore',
  phone: '+65 6888 8888',
  email: 'info@grandazure.com',
  website: 'https://grandazure.com',
  description: 'A luxury 5-star hotel overlooking Marina Bay, offering world-class amenities and personalized service.',
  amenities: [
    'Infinity Pool', 'Spa & Wellness Center', 'Fitness Center',
    'Azure Restaurant', 'Rooftop Bar', 'Business Center',
    'Concierge Service', 'Valet Parking', 'Free Wi-Fi',
    'Room Service 24/7', 'Laundry Service', 'Airport Shuttle',
  ],
  checkInTime: '3:00 PM',
  checkOutTime: '11:00 AM',
  wifiPassword: 'AZURE2024',
  emergencyContact: '+65 6888 8999',
  nearbyAttractions: [
    { name: 'Gardens by the Bay', distance: '0.5 km', description: 'Iconic nature park with Supertrees and Cloud Forest' },
    { name: 'Marina Bay Sands', distance: '0.3 km', description: 'Entertainment complex with SkyPark observation deck' },
    { name: 'Merlion Park', distance: '1.0 km', description: 'Iconic Singapore landmark and photo spot' },
    { name: 'Chinatown', distance: '2.5 km', description: 'Vibrant cultural district with food and shopping' },
  ],
};

const MOCK_ROOMS = [
  {
    id: 'room-1',
    roomNumber: '1204',
    type: 'standard',
    floor: 12,
    pricePerNight: 350,
    currency: 'SGD',
    maxOccupancy: 2,
    bedType: 'King',
    amenities: ['City View', 'Mini Bar', 'Rain Shower', '55" Smart TV', 'Nespresso Machine'],
    isAvailable: true,
    description: 'Elegant room with city skyline views and modern amenities.',
  },
  {
    id: 'room-2',
    roomNumber: '1508',
    type: 'deluxe',
    floor: 15,
    pricePerNight: 520,
    currency: 'SGD',
    maxOccupancy: 2,
    bedType: 'King',
    amenities: ['Marina Bay View', 'Mini Bar', 'Rainfall Shower', '65" Smart TV', 'Nespresso Machine', 'Bathrobe & Slippers', 'Turndown Service'],
    isAvailable: true,
    description: 'Spacious room with panoramic Marina Bay views and premium touches.',
  },
  {
    id: 'room-3',
    roomNumber: '2001',
    type: 'suite',
    floor: 20,
    pricePerNight: 880,
    currency: 'SGD',
    maxOccupancy: 3,
    bedType: 'King + Sofa Bed',
    amenities: ['Panoramic Bay View', 'Separate Living Area', 'Walk-in Closet', 'Jacuzzi Tub', 'Premium Mini Bar', '75" Smart TV', 'Butler Service', 'Complimentary Breakfast'],
    isAvailable: true,
    description: 'Luxurious suite with separate living area and butler service.',
  },
  {
    id: 'room-4',
    roomNumber: '2501',
    type: 'penthouse',
    floor: 25,
    pricePerNight: 2200,
    currency: 'SGD',
    maxOccupancy: 4,
    bedType: 'King + Twin',
    amenities: ['360° Panoramic View', 'Private Terrace', 'Full Kitchen', 'Dining Room', 'Private Pool', 'Home Theater', 'Butler Service', 'Complimentary Spa', 'Airport Transfer'],
    isAvailable: true,
    description: 'The pinnacle of luxury — a private penthouse with terrace pool and 360° views.',
  },
];

const MOCK_UPGRADES = [
  {
    id: 'upgrade-1',
    fromRoomType: 'standard',
    toRoomType: 'Deluxe Room',
    additionalCostPerNight: 170,
    currency: 'SGD',
    description: 'Upgrade to a Deluxe Room with Marina Bay views',
    highlights: ['Bay View', 'Turndown Service', 'Premium Amenities'],
  },
  {
    id: 'upgrade-2',
    fromRoomType: 'standard',
    toRoomType: 'Suite',
    additionalCostPerNight: 530,
    currency: 'SGD',
    description: 'Upgrade to a Suite with living area and butler service',
    highlights: ['Living Area', 'Jacuzzi', 'Butler Service', 'Free Breakfast'],
  },
  {
    id: 'upgrade-3',
    fromRoomType: 'deluxe',
    toRoomType: 'Suite',
    additionalCostPerNight: 360,
    currency: 'SGD',
    description: 'Upgrade to a Suite with living area and butler service',
    highlights: ['Living Area', 'Jacuzzi', 'Butler Service', 'Free Breakfast'],
  },
  {
    id: 'upgrade-4',
    fromRoomType: 'deluxe',
    toRoomType: 'Penthouse',
    additionalCostPerNight: 1680,
    currency: 'SGD',
    description: 'Upgrade to the Penthouse with private pool and terrace',
    highlights: ['Private Pool', 'Terrace', '360° Views', 'Home Theater'],
  },
];

const MOCK_GUESTS = [
  {
    id: 'guest-1',
    firstName: 'James',
    lastName: 'Chen',
    email: 'james.chen@email.com',
    phone: '+65 9123 4567',
    nationality: 'Singapore',
    passportNumber: 'E1234567A',
    dateOfBirth: '1985-03-15',
  },
  {
    id: 'guest-2',
    firstName: 'Sarah',
    lastName: 'Williams',
    email: 'sarah.w@email.com',
    phone: '+44 7700 900123',
    nationality: 'United Kingdom',
    passportNumber: 'GB9876543',
    dateOfBirth: '1990-07-22',
  },
  {
    id: 'guest-3',
    firstName: 'Yuki',
    lastName: 'Tanaka',
    email: 'yuki.t@email.com',
    phone: '+81 90 1234 5678',
    nationality: 'Japan',
    passportNumber: 'TK5551234',
    dateOfBirth: '1988-11-08',
  },
];

const MOCK_RESERVATIONS = [
  {
    id: 'res-1',
    confirmationCode: 'GAH-2024-001',
    guestId: 'guest-1',
    roomId: 'room-1',
    checkInDate: new Date().toISOString().split('T')[0],
    checkOutDate: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
    numberOfGuests: 2,
    status: 'confirmed',
    specialRequests: 'High floor, extra pillows',
    totalAmount: 1050,
    currency: 'SGD',
  },
  {
    id: 'res-2',
    confirmationCode: 'GAH-2024-002',
    guestId: 'guest-2',
    roomId: 'room-2',
    checkInDate: new Date().toISOString().split('T')[0],
    checkOutDate: new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0],
    numberOfGuests: 1,
    status: 'confirmed',
    specialRequests: null,
    totalAmount: 2600,
    currency: 'SGD',
  },
  {
    id: 'res-3',
    confirmationCode: 'GAH-2024-003',
    guestId: 'guest-3',
    roomId: 'room-3',
    checkInDate: new Date().toISOString().split('T')[0],
    checkOutDate: new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0],
    numberOfGuests: 2,
    status: 'confirmed',
    specialRequests: 'Late check-in, Japanese newspaper',
    totalAmount: 1760,
    currency: 'SGD',
  },
];

// =============================================================================
// Service Functions
// =============================================================================

export async function getHotelInfo() {
  if (supabase) {
    const { data, error } = await supabase.from('hotel_info').select('*').single();
    if (!error && data) return data;
  }
  return MOCK_HOTEL_INFO;
}

export async function getAvailableRooms(_checkIn?: string, _checkOut?: string) {
  if (supabase) {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('is_available', true)
      .order('price_per_night', { ascending: true });
    if (!error && data) return data;
  }
  return MOCK_ROOMS.filter((r) => r.isAvailable);
}

export async function getRoomUpgrades(currentRoomType: string) {
  if (supabase) {
    const { data, error } = await supabase
      .from('room_upgrades')
      .select('*')
      .eq('from_room_type', currentRoomType);
    if (!error && data) return data;
  }
  return MOCK_UPGRADES.filter((u) => u.fromRoomType === currentRoomType);
}

export async function lookupReservation(query: string) {
  if (supabase) {
    const { data, error } = await supabase
      .from('reservations')
      .select('*, guest:guests(*), room:rooms(*)')
      .or(`confirmation_code.eq.${query},id.eq.${query}`)
      .single();
    if (!error && data) return data;
  }

  // Mock lookup
  const reservation = MOCK_RESERVATIONS.find(
    (r) => r.confirmationCode.toLowerCase() === query.toLowerCase() || r.id === query
  );
  if (reservation) {
    const guest = MOCK_GUESTS.find((g) => g.id === reservation.guestId);
    const room = MOCK_ROOMS.find((r) => r.id === reservation.roomId);
    return { ...reservation, guest, room };
  }
  return null;
}

export async function lookupReservationByPassport(passportNumber: string) {
  if (supabase) {
    const { data: guest, error: guestError } = await supabase
      .from('guests')
      .select('id')
      .eq('passport_number', passportNumber)
      .single();

    if (!guestError && guest) {
      const { data, error } = await supabase
        .from('reservations')
        .select('*, guest:guests(*), room:rooms(*)')
        .eq('guest_id', guest.id)
        .eq('status', 'confirmed')
        .single();
      if (!error && data) return data;
    }
  }

  // Mock lookup
  const guest = MOCK_GUESTS.find((g) => g.passportNumber === passportNumber);
  if (guest) {
    const reservation = MOCK_RESERVATIONS.find(
      (r) => r.guestId === guest.id && r.status === 'confirmed'
    );
    if (reservation) {
      const room = MOCK_ROOMS.find((r) => r.id === reservation.roomId);
      return { ...reservation, guest, room };
    }
  }
  return null;
}

export async function lookupReservationByName(firstName: string, lastName: string) {
  const firstLower = firstName.toLowerCase();
  const lastLower = lastName.toLowerCase();

  if (supabase) {
    // Case-insensitive search by first and last name via Supabase
    const { data: guests, error: guestError } = await supabase
      .from('guests')
      .select('id')
      .ilike('first_name', firstLower)
      .ilike('last_name', lastLower);

    if (!guestError && guests && guests.length > 0) {
      // Try each matching guest for a confirmed reservation
      for (const guest of guests) {
        const { data, error } = await supabase
          .from('reservations')
          .select('*, guest:guests(*), room:rooms(*)')
          .eq('guest_id', guest.id)
          .eq('status', 'confirmed')
          .single();
        if (!error && data) return data;
      }
    }
  }

  // Mock lookup — case-insensitive match
  const guest = MOCK_GUESTS.find(
    (g) =>
      g.firstName.toLowerCase() === firstLower &&
      g.lastName.toLowerCase() === lastLower
  );
  if (guest) {
    const reservation = MOCK_RESERVATIONS.find(
      (r) => r.guestId === guest.id && r.status === 'confirmed'
    );
    if (reservation) {
      const room = MOCK_ROOMS.find((r) => r.id === reservation.roomId);
      return { ...reservation, guest, room };
    }
  }
  return null;
}

export async function getGuestByPassport(passportNumber: string) {
  if (supabase) {
    const { data, error } = await supabase
      .from('guests')
      .select('*')
      .eq('passport_number', passportNumber)
      .single();
    if (!error && data) return data;
  }
  return MOCK_GUESTS.find((g) => g.passportNumber === passportNumber) || null;
}
