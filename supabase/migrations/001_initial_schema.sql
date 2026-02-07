-- =============================================================================
-- AI Hotel Check-in Kiosk — Initial Database Schema
-- =============================================================================
-- Run this against your Supabase project to create the tables.
-- Alternatively, the backend uses in-memory mock data when Supabase is not configured.

-- Hotel Information
CREATE TABLE IF NOT EXISTS hotel_info (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  website TEXT,
  description TEXT,
  amenities TEXT[] DEFAULT '{}',
  check_in_time TEXT DEFAULT '3:00 PM',
  check_out_time TEXT DEFAULT '11:00 AM',
  wifi_password TEXT,
  emergency_contact TEXT,
  nearby_attractions JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Guests
CREATE TABLE IF NOT EXISTS guests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  nationality TEXT,
  passport_number TEXT UNIQUE,
  date_of_birth DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rooms
CREATE TABLE IF NOT EXISTS rooms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_number TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('standard', 'deluxe', 'suite', 'penthouse')),
  floor INTEGER NOT NULL,
  price_per_night DECIMAL(10, 2) NOT NULL,
  currency TEXT DEFAULT 'SGD',
  max_occupancy INTEGER DEFAULT 2,
  bed_type TEXT,
  amenities TEXT[] DEFAULT '{}',
  image_url TEXT,
  is_available BOOLEAN DEFAULT true,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reservations
CREATE TABLE IF NOT EXISTS reservations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  confirmation_code TEXT NOT NULL UNIQUE,
  guest_id UUID REFERENCES guests(id),
  room_id UUID REFERENCES rooms(id),
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  number_of_guests INTEGER DEFAULT 1,
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'checked-in', 'checked-out', 'cancelled')),
  special_requests TEXT,
  total_amount DECIMAL(10, 2) NOT NULL,
  currency TEXT DEFAULT 'SGD',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Room Upgrades
CREATE TABLE IF NOT EXISTS room_upgrades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  from_room_type TEXT NOT NULL,
  to_room_type TEXT NOT NULL,
  additional_cost_per_night DECIMAL(10, 2) NOT NULL,
  currency TEXT DEFAULT 'SGD',
  description TEXT,
  highlights TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Check-in Logs (for tracking completed check-ins)
CREATE TABLE IF NOT EXISTS checkin_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reservation_id UUID REFERENCES reservations(id),
  key_card_number TEXT,
  room_number TEXT,
  checked_in_at TIMESTAMPTZ DEFAULT NOW(),
  session_data JSONB DEFAULT '{}'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reservations_confirmation ON reservations(confirmation_code);
CREATE INDEX IF NOT EXISTS idx_reservations_guest ON reservations(guest_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_guests_passport ON guests(passport_number);
CREATE INDEX IF NOT EXISTS idx_rooms_available ON rooms(is_available);
CREATE INDEX IF NOT EXISTS idx_rooms_type ON rooms(type);

-- Enable Row Level Security (optional for Supabase)
ALTER TABLE hotel_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_upgrades ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkin_logs ENABLE ROW LEVEL SECURITY;

-- Allow public read access (adjust for production)
CREATE POLICY "Public read hotel_info" ON hotel_info FOR SELECT USING (true);
CREATE POLICY "Public read rooms" ON rooms FOR SELECT USING (true);
CREATE POLICY "Public read room_upgrades" ON room_upgrades FOR SELECT USING (true);
CREATE POLICY "Public read reservations" ON reservations FOR SELECT USING (true);
CREATE POLICY "Public read guests" ON guests FOR SELECT USING (true);
CREATE POLICY "Service role full access checkin_logs" ON checkin_logs FOR ALL USING (true);
