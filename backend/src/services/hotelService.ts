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
    imageUrl: null,
    isAvailable: true,
    description: 'Elegant room with city skyline views and modern amenities.',
    roomForRobot: 'RM1204',
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
    imageUrl: null,
    isAvailable: true,
    description: 'Spacious room with panoramic Marina Bay views and premium touches.',
    roomForRobot: 'RM1508',
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
    imageUrl: null,
    isAvailable: true,
    description: 'Luxurious suite with separate living area and butler service.',
    roomForRobot: 'RM2001',
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
    imageUrl: null,
    isAvailable: true,
    description: 'The pinnacle of luxury — a private penthouse with terrace pool and 360° views.',
    roomForRobot: 'RM2501',
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
    passportPath: null,
    preferredName: 'James',
    languagePreference: 'English',
    loyaltyTier: 'Gold',
    vipNotes: 'Returning guest. Likes quiet rooms and early coffee.',
    accessibilityNotes: null,
    identityVerifiedAt: null,
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
    passportPath: null,
    preferredName: 'Sarah',
    languagePreference: 'English',
    loyaltyTier: 'Platinum',
    vipNotes: 'Prefers minimal small talk and fast check-in.',
    accessibilityNotes: null,
    identityVerifiedAt: null,
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
    passportPath: null,
    preferredName: 'Yuki',
    languagePreference: 'Japanese',
    loyaltyTier: 'Silver',
    vipNotes: 'Offer Japanese newspaper if available.',
    accessibilityNotes: null,
    identityVerifiedAt: null,
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
    source: 'stanford-showcase',
    arrivalStatus: 'arrived',
    paymentStatus: 'pending',
    scheduledArrivalAt: null,
    checkedInAt: null,
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
    source: 'webapp',
    arrivalStatus: 'expected',
    paymentStatus: 'pending',
    scheduledArrivalAt: null,
    checkedInAt: null,
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
    source: 'stanford-showcase',
    arrivalStatus: 'arrived',
    paymentStatus: 'pending',
    scheduledArrivalAt: null,
    checkedInAt: null,
  },
];

// =============================================================================
// Supabase → camelCase normalizers
// =============================================================================
// Supabase returns snake_case column names, but the frontend expects camelCase.
// These functions transform the data so the rest of the app always sees camelCase.

/* eslint-disable @typescript-eslint/no-explicit-any */

function normalizeGuest(row: any) {
  if (!row) return undefined;
  return {
    id: row.id,
    firstName: row.first_name ?? row.firstName,
    lastName: row.last_name ?? row.lastName,
    email: row.email,
    phone: row.phone,
    nationality: row.nationality,
    passportNumber: row.passport_number ?? row.passportNumber,
    passportPath: row.passport_path ?? row.passportPath,
    preferredName: row.preferred_name ?? row.preferredName,
    languagePreference: row.language_preference ?? row.languagePreference,
    loyaltyTier: row.loyalty_tier ?? row.loyaltyTier,
    vipNotes: row.vip_notes ?? row.vipNotes,
    accessibilityNotes: row.accessibility_notes ?? row.accessibilityNotes,
    identityVerifiedAt: row.identity_verified_at ?? row.identityVerifiedAt,
    dateOfBirth: row.date_of_birth ?? row.dateOfBirth,
  };
}

function normalizeRoom(row: any) {
  if (!row) return undefined;
  return {
    id: row.id,
    roomNumber: row.room_number ?? row.roomNumber,
    type: row.type,
    floor: row.floor,
    pricePerNight: Number(row.price_per_night ?? row.pricePerNight),
    currency: row.currency,
    maxOccupancy: row.max_occupancy ?? row.maxOccupancy,
    bedType: row.bed_type ?? row.bedType,
    amenities: row.amenities ?? [],
    imageUrl: row.image_url ?? row.imageUrl,
    isAvailable: row.is_available ?? row.isAvailable,
    description: row.description,
    roomForRobot: row.room_for_robot ?? row.roomForRobot,
  };
}

function normalizeReservation(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    confirmationCode: row.confirmation_code ?? row.confirmationCode,
    guestId: row.guest_id ?? row.guestId,
    roomId: row.room_id ?? row.roomId,
    checkInDate: row.check_in_date ?? row.checkInDate,
    checkOutDate: row.check_out_date ?? row.checkOutDate,
    numberOfGuests: row.number_of_guests ?? row.numberOfGuests,
    status: row.status,
    specialRequests: row.special_requests ?? row.specialRequests,
    totalAmount: Number(row.total_amount ?? row.totalAmount),
    currency: row.currency,
    source: row.source,
    arrivalStatus: row.arrival_status ?? row.arrivalStatus,
    paymentStatus: row.payment_status ?? row.paymentStatus,
    scheduledArrivalAt: row.scheduled_arrival_at ?? row.scheduledArrivalAt,
    checkedInAt: row.checked_in_at ?? row.checkedInAt,
    guest: row.guest ? normalizeGuest(row.guest) : undefined,
    room: row.room ? normalizeRoom(row.room) : undefined,
  };
}

function normalizeCheckinSession(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    reservationId: row.reservation_id,
    guestId: row.guest_id,
    sessionKey: row.session_key,
    channel: row.channel,
    status: row.status,
    currentStep: row.current_step,
    staffDisplayName: row.staff_display_name,
    identityStatus: row.identity_status,
    paymentStatus: row.payment_status,
    keyStatus: row.key_status,
    roomPreferences: row.room_preferences ?? {},
    luggage: row.luggage ?? {},
    selectedServices: row.selected_services ?? [],
    artifacts: row.artifacts ?? {},
    staffNotes: row.staff_notes,
    startedAt: row.started_at,
    lastEventAt: row.last_event_at,
    completedAt: row.completed_at,
  };
}

function normalizeCheckinEvent(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    reservationId: row.reservation_id,
    guestId: row.guest_id,
    eventType: row.event_type,
    eventPayload: row.event_payload ?? {},
    createdAt: row.created_at,
  };
}

function normalizeUpgrade(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    fromRoomType: row.from_room_type ?? row.fromRoomType,
    toRoomType: row.to_room_type ?? row.toRoomType,
    additionalCostPerNight: Number(row.additional_cost_per_night ?? row.additionalCostPerNight),
    currency: row.currency,
    description: row.description,
    highlights: row.highlights ?? [],
  };
}

function normalizeHotelInfo(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    city: row.city,
    country: row.country,
    phone: row.phone,
    email: row.email,
    website: row.website,
    description: row.description,
    amenities: row.amenities ?? [],
    checkInTime: row.check_in_time ?? row.checkInTime,
    checkOutTime: row.check_out_time ?? row.checkOutTime,
    wifiPassword: row.wifi_password ?? row.wifiPassword,
    emergencyContact: row.emergency_contact ?? row.emergencyContact,
    nearbyAttractions: row.nearby_attractions ?? row.nearbyAttractions ?? [],
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// =============================================================================
// Fuzzy Matching Utilities
// =============================================================================

const FUZZY_MAX_DISTANCE = 4;
const RESERVATION_SELECT = '*, guest:guests(*), room:rooms(*)';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function sanitizePostgrestSearch(value: string): string {
  return value.replace(/[%,()]/g, ' ').trim();
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

// =============================================================================
// Service Functions
// =============================================================================

export interface NameSuggestion {
  firstName: string;
  lastName: string;
  distance: number;
}

export interface NameLookupResult {
  reservation: ReturnType<typeof normalizeReservation> | (typeof MOCK_RESERVATIONS[number] & { guest?: typeof MOCK_GUESTS[number]; room?: typeof MOCK_ROOMS[number] }) | null;
  suggestions: NameSuggestion[];
}

export interface StanfordCheckinEventInput {
  reservationId?: string;
  sessionKey?: string;
  eventType: string;
  eventPayload?: Record<string, unknown>;
}

export interface ReservationProfile {
  reservation: ReturnType<typeof normalizeReservation>;
  activeSession: ReturnType<typeof normalizeCheckinSession>;
  recentEvents: Array<NonNullable<ReturnType<typeof normalizeCheckinEvent>>>;
}

/**
 * Fetch all guests and rank them by Levenshtein distance to the input name.
 * Returns guests within FUZZY_MAX_DISTANCE, sorted closest first.
 */
async function searchGuestsFuzzy(
  firstName: string,
  lastName: string
): Promise<NameSuggestion[]> {
  const firstLower = firstName.toLowerCase();
  const lastLower = lastName.toLowerCase();
  const hasLastName = lastLower.length > 0;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  let allGuests: Array<{ firstName: string; lastName: string }> = [];

  if (supabase) {
    const { data, error } = await supabase
      .from('guests')
      .select('first_name, last_name');
    if (!error && data) {
      allGuests = data.map((row: any) => ({
        firstName: row.first_name,
        lastName: row.last_name,
      }));
    }
  }

  if (allGuests.length === 0) {
    allGuests = MOCK_GUESTS.map((g) => ({
      firstName: g.firstName,
      lastName: g.lastName,
    }));
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const scored = allGuests.map((g) => {
    const firstDist = levenshteinDistance(firstLower, g.firstName.toLowerCase());
    const lastDist = hasLastName
      ? levenshteinDistance(lastLower, g.lastName.toLowerCase())
      : 0;
    return {
      firstName: g.firstName,
      lastName: g.lastName,
      distance: firstDist + lastDist,
    };
  });

  return scored
    .filter((s) => s.distance > 0 && s.distance <= FUZZY_MAX_DISTANCE)
    .sort((a, b) => a.distance - b.distance);
}

export async function getHotelInfo() {
  if (supabase) {
    const { data, error } = await supabase.from('hotel_info').select('*').single();
    if (!error && data) return normalizeHotelInfo(data);
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
    if (!error && data) return data.map(normalizeRoom);
  }
  return MOCK_ROOMS.filter((r) => r.isAvailable);
}

export async function getRoomUpgrades(currentRoomType: string) {
  if (supabase) {
    const { data, error } = await supabase
      .from('room_upgrades')
      .select('*')
      .eq('from_room_type', currentRoomType);
    if (!error && data) return data.map(normalizeUpgrade);
  }
  return MOCK_UPGRADES.filter((u) => u.fromRoomType === currentRoomType);
}

export async function lookupReservation(query: string) {
  if (supabase) {
    const cleanQuery = query.trim();
    let dbQuery = supabase
      .from('reservations')
      .select(RESERVATION_SELECT);

    if (isUuid(cleanQuery)) {
      dbQuery = dbQuery.or(`confirmation_code.eq.${cleanQuery},id.eq.${cleanQuery}`);
    } else {
      dbQuery = dbQuery.eq('confirmation_code', cleanQuery);
    }

    const { data, error } = await dbQuery.single();
    if (!error && data) return normalizeReservation(data);
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

export async function searchReservations(query: string, limit = 8) {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  if (supabase) {
    const normalized = sanitizePostgrestSearch(cleanQuery);
    const found = new Map<string, ReturnType<typeof normalizeReservation>>();

    const addRows = (rows: unknown[] | null) => {
      if (!rows) return;
      for (const row of rows) {
        const reservation = normalizeReservation(row);
        if (reservation) found.set(reservation.id, reservation);
      }
    };

    const codeFilters = [`confirmation_code.ilike.%${normalized}%`];
    if (isUuid(cleanQuery)) codeFilters.push(`id.eq.${cleanQuery}`);

    const { data: directRows } = await supabase
      .from('reservations')
      .select(RESERVATION_SELECT)
      .or(codeFilters.join(','))
      .order('check_in_date', { ascending: false })
      .limit(limit);
    addRows(directRows);

    const { data: guestRows } = await supabase
      .from('guests')
      .select('id')
      .or([
        `first_name.ilike.%${normalized}%`,
        `last_name.ilike.%${normalized}%`,
        `email.ilike.%${normalized}%`,
        `phone.ilike.%${normalized}%`,
        `passport_number.ilike.%${normalized}%`,
      ].join(','))
      .limit(limit);

    const guestIds = (guestRows ?? []).map((g) => g.id);
    if (guestIds.length > 0) {
      const { data: guestReservationRows } = await supabase
        .from('reservations')
        .select(RESERVATION_SELECT)
        .in('guest_id', guestIds)
        .order('check_in_date', { ascending: false })
        .limit(limit);
      addRows(guestReservationRows);
    }

    return Array.from(found.values()).slice(0, limit);
  }

  const lower = cleanQuery.toLowerCase();
  return MOCK_RESERVATIONS
    .map((reservation) => {
      const guest = MOCK_GUESTS.find((g) => g.id === reservation.guestId);
      const room = MOCK_ROOMS.find((r) => r.id === reservation.roomId);
      return { ...reservation, guest, room };
    })
    .filter((reservation) => {
      const guest = reservation.guest;
      return (
        reservation.confirmationCode.toLowerCase().includes(lower) ||
        reservation.id.toLowerCase().includes(lower) ||
        `${guest?.firstName ?? ''} ${guest?.lastName ?? ''}`.toLowerCase().includes(lower) ||
        (guest?.email ?? '').toLowerCase().includes(lower) ||
        (guest?.phone ?? '').toLowerCase().includes(lower) ||
        (guest?.passportNumber ?? '').toLowerCase().includes(lower)
      );
    })
    .slice(0, limit);
}

export async function getReservationProfile(reservationIdOrCode: string): Promise<ReservationProfile | null> {
  const reservation = await lookupReservation(reservationIdOrCode);
  if (!reservation) return null;

  if (!supabase) {
    return {
      reservation,
      activeSession: null,
      recentEvents: [],
    };
  }

  const { data: session } = await supabase
    .from('checkin_sessions')
    .select('*')
    .eq('reservation_id', reservation.id)
    .order('last_event_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const activeSession = normalizeCheckinSession(session);

  const { data: events } = await supabase
    .from('checkin_events')
    .select('*')
    .eq('reservation_id', reservation.id)
    .order('created_at', { ascending: false })
    .limit(20);

  return {
    reservation,
    activeSession,
    recentEvents: (events ?? [])
      .map(normalizeCheckinEvent)
      .filter((event): event is NonNullable<ReturnType<typeof normalizeCheckinEvent>> => Boolean(event)),
  };
}

export async function recordStanfordCheckinEvent(input: StanfordCheckinEventInput) {
  if (!input.eventType) return { success: false, error: 'eventType is required' };

  const eventPayload = input.eventPayload ?? {};
  const reservation = input.reservationId
    ? await lookupReservation(input.reservationId)
    : null;

  if (!supabase) {
    console.log('[Hotel Service] Mock Stanford event:', input.eventType, {
      reservationId: input.reservationId,
      sessionKey: input.sessionKey,
      eventPayload,
    });
    return { success: true, session: null };
  }

  try {
    let session = null;

    if (reservation) {
      let sessionQuery = supabase
        .from('checkin_sessions')
        .select('*')
        .eq('reservation_id', reservation.id)
        .eq('status', 'active')
        .order('last_event_at', { ascending: false })
        .limit(1);

      if (input.sessionKey) {
        sessionQuery = sessionQuery.eq('session_key', input.sessionKey);
      }

      const { data: existingSession } = await sessionQuery.maybeSingle();
      session = existingSession;

      if (!session) {
        const { data: insertedSession, error: insertError } = await supabase
          .from('checkin_sessions')
          .insert({
            reservation_id: reservation.id,
            guest_id: reservation.guestId,
            session_key: input.sessionKey,
            channel: 'stanford-showcase',
            current_step: deriveStepFromEvent(input.eventType),
          })
          .select('*')
          .single();

        if (insertError) throw insertError;
        session = insertedSession;
      }
    }

    const sessionPatch = deriveSessionPatch(input.eventType, eventPayload);
    if (session) {
      const { error: updateError } = await supabase
        .from('checkin_sessions')
        .update({
          ...sessionPatch,
          last_event_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', session.id);

      if (updateError) throw updateError;
    }

    const { error: eventError } = await supabase
      .from('checkin_events')
      .insert({
        session_id: session?.id ?? null,
        reservation_id: reservation?.id ?? null,
        guest_id: reservation?.guestId ?? null,
        event_type: input.eventType,
        event_payload: eventPayload,
      });

    if (eventError) throw eventError;

    if (reservation && input.eventType === 'key_card_received') {
      await supabase
        .from('reservations')
        .update({
          status: 'checked-in',
          arrival_status: 'completed',
          payment_status: 'paid',
          checked_in_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', reservation.id);
    }

    return { success: true, session: normalizeCheckinSession(session) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to record Stanford event';
    console.error('[Hotel Service] Stanford event persistence failed:', message);
    return { success: false, error: message };
  }
}

function deriveStepFromEvent(eventType: string): string {
  switch (eventType) {
    case 'reservation_confirmed':
      return 'reservation';
    case 'passport_scanned':
      return 'passport';
    case 'payment_complete':
      return 'payment';
    case 'signature_submitted':
      return 'signature';
    case 'key_card_received':
      return 'key-card';
    case 'preferences_submitted':
      return 'personalization';
    case 'service_selected':
      return 'services';
    case 'luggage_info':
      return 'luggage';
    default:
      return 'video-only';
  }
}

function deriveSessionPatch(eventType: string, eventPayload: Record<string, unknown>) {
  const currentStep = deriveStepFromEvent(eventType);
  const patch: Record<string, unknown> = { current_step: currentStep };

  switch (eventType) {
    case 'passport_scanned':
      patch.identity_status = eventPayload.passportNumber ? 'verified' : 'skipped';
      patch.artifacts = {
        passportNumber: eventPayload.passportNumber ?? null,
        hasPassportPhoto: Boolean(eventPayload.photoDataUrl),
      };
      break;
    case 'payment_complete':
      patch.payment_status = 'paid';
      break;
    case 'signature_submitted':
      patch.artifacts = {
        signatureCaptured: true,
      };
      break;
    case 'key_card_received':
      patch.key_status = 'issued';
      patch.status = 'completed';
      patch.completed_at = new Date().toISOString();
      break;
    case 'preferences_submitted':
      patch.room_preferences = {
        temperature: eventPayload.temperature,
        pillows: eventPayload.pillows,
        celebration: eventPayload.celebration,
      };
      break;
    case 'service_selected':
      patch.selected_services = [{
        id: eventPayload.serviceId,
        label: eventPayload.label,
      }];
      break;
    case 'luggage_info':
      patch.luggage = {
        count: eventPayload.count,
        needsHelp: eventPayload.needsHelp,
        etaNote: eventPayload.etaNote,
      };
      break;
    default:
      break;
  }

  return patch;
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
      if (!error && data) return normalizeReservation(data);
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

export async function lookupReservationByName(
  firstName: string,
  lastName: string
): Promise<NameLookupResult> {
  const firstLower = firstName.toLowerCase();
  const lastLower = lastName.toLowerCase();

  // --- Exact match (Supabase) ---
  if (supabase) {
    const { data: guests, error: guestError } = await supabase
      .from('guests')
      .select('id')
      .ilike('first_name', firstLower)
      .ilike('last_name', lastLower);

    if (!guestError && guests && guests.length > 0) {
      for (const guest of guests) {
        const { data, error } = await supabase
          .from('reservations')
          .select('*, guest:guests(*), room:rooms(*)')
          .eq('guest_id', guest.id)
          .eq('status', 'confirmed')
          .single();
        if (!error && data) {
          return { reservation: normalizeReservation(data), suggestions: [] };
        }
      }
    }
  }

  // --- Exact match (mock) ---
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
      return { reservation: { ...reservation, guest, room }, suggestions: [] };
    }
  }

  // --- No exact match — fall back to fuzzy search ---
  const suggestions = await searchGuestsFuzzy(firstName, lastName);
  return { reservation: null, suggestions };
}

/**
 * Look up the Sesto robot waypoint ID for a given room.
 * Returns the `room_for_robot` value (e.g. "RM1204") or null if not set.
 */
export async function getRoomWaypointId(roomId: string): Promise<string | null> {
  if (supabase) {
    const { data, error } = await supabase
      .from('rooms')
      .select('room_for_robot')
      .eq('id', roomId)
      .single();
    if (!error && data?.room_for_robot) return data.room_for_robot;
  }

  const room = MOCK_ROOMS.find((r) => r.id === roomId);
  return room?.roomForRobot ?? null;
}

export async function getGuestByPassport(passportNumber: string) {
  if (supabase) {
    const { data, error } = await supabase
      .from('guests')
      .select('*')
      .eq('passport_number', passportNumber)
      .single();
    if (!error && data) return normalizeGuest(data);
  }
  return MOCK_GUESTS.find((g) => g.passportNumber === passportNumber) || null;
}

const PASSPORT_STORAGE_BUCKET = 'passports';

/**
 * Upload a passport image to the private Supabase Storage bucket.
 * Mirrors the friend's Python upload_passport_image(): stores as <passportNumber>/<uuid>.png.
 * Returns the storage object path on success, or null on failure.
 */
async function uploadPassportImage(
  passportNumber: string,
  imageBase64: string
): Promise<string | null> {
  if (!supabase || !passportNumber || !imageBase64) return null;

  try {
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const uid = Math.random().toString(36).slice(2, 14);
    const filePath = `${passportNumber}/${uid}.png`;

    const { error } = await supabase.storage
      .from(PASSPORT_STORAGE_BUCKET)
      .upload(filePath, imageBuffer, {
        contentType: 'image/png',
        upsert: false,
      });

    if (error) {
      console.error('[Hotel Service] Passport image upload failed:', error.message);
      return null;
    }
    console.log(`[Hotel Service] Passport image uploaded to ${PASSPORT_STORAGE_BUCKET}/${filePath}`);
    return filePath;
  } catch (err) {
    console.error('[Hotel Service] Passport image upload error:', err);
    return null;
  }
}

/**
 * Persist scanned passport data to the guest record.
 * Uploads the image to Supabase Storage and saves only the path in the guests table.
 * For mock data: updates the in-memory guest object (transient).
 */
export async function updateGuestPassportData(
  guestId: string,
  passportData: {
    passportName: string;
    passportNumber: string;
    passportImageBase64?: string;
  }
): Promise<boolean> {
  if (supabase) {
    // Upload image to Storage first (if provided)
    let passportPath: string | null = null;
    if (passportData.passportImageBase64) {
      passportPath = await uploadPassportImage(
        passportData.passportNumber,
        passportData.passportImageBase64
      );
    }

    const updatePayload: Record<string, unknown> = {
      passport_number: passportData.passportNumber,
    };
    if (passportPath) {
      updatePayload.passport_path = passportPath;
    }

    const { error } = await supabase
      .from('guests')
      .update(updatePayload)
      .eq('id', guestId);

    if (error) {
      console.error('[Hotel Service] Failed to update guest passport data:', error);
      return false;
    }
    console.log(`[Hotel Service] Guest ${guestId} updated — passport_path: ${passportPath || '(no image)'}`);
    return true;
  }

  // Mock: update in-memory guest
  const guest = MOCK_GUESTS.find((g) => g.id === guestId);
  if (guest) {
    guest.passportNumber = passportData.passportNumber;
    (guest as Record<string, unknown>).passportPath = `mock/${passportData.passportNumber}/scan.png`;
    console.log(`[Hotel Service] Updated mock guest ${guestId} with passport data`);
    return true;
  }
  return false;
}
