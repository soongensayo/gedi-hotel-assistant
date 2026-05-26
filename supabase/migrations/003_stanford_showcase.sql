-- =============================================================================
-- Stanford Showcase Extensions
-- =============================================================================
-- Keeps Stanford on the same guests/reservations/rooms tables while adding a
-- session/event layer for the staff-guided prototype experience.

-- Shared profile fields used by both the original kiosk and Stanford staff UI.
ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS preferred_name TEXT,
  ADD COLUMN IF NOT EXISTS language_preference TEXT DEFAULT 'English',
  ADD COLUMN IF NOT EXISTS loyalty_tier TEXT DEFAULT 'None',
  ADD COLUMN IF NOT EXISTS vip_notes TEXT,
  ADD COLUMN IF NOT EXISTS accessibility_notes TEXT,
  ADD COLUMN IF NOT EXISTS passport_path TEXT,
  ADD COLUMN IF NOT EXISTS identity_verified_at TIMESTAMPTZ;

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS room_for_robot TEXT;

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'webapp',
  ADD COLUMN IF NOT EXISTS arrival_status TEXT DEFAULT 'expected'
    CHECK (arrival_status IN ('expected', 'en_route', 'arrived', 'checking_in', 'completed', 'needs_help')),
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'authorized', 'paid', 'waived', 'failed')),
  ADD COLUMN IF NOT EXISTS scheduled_arrival_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;

-- One live/prototype interaction with a guest. This table is intentionally
-- generic so kiosk, car/tablet, and staff-assisted demos can share it.
CREATE TABLE IF NOT EXISTS checkin_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
  session_key TEXT,
  channel TEXT NOT NULL DEFAULT 'stanford-showcase'
    CHECK (channel IN ('kiosk', 'webapp', 'stanford-showcase', 'staff-assisted')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'abandoned', 'escalated')),
  current_step TEXT DEFAULT 'video-only',
  staff_display_name TEXT,
  identity_status TEXT DEFAULT 'not_started'
    CHECK (identity_status IN ('not_started', 'scanning', 'verified', 'skipped', 'failed')),
  payment_status TEXT DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'authorized', 'paid', 'waived', 'failed')),
  key_status TEXT DEFAULT 'not_started'
    CHECK (key_status IN ('not_started', 'issuing', 'issued', 'failed')),
  room_preferences JSONB DEFAULT '{}'::jsonb,
  luggage JSONB DEFAULT '{}'::jsonb,
  selected_services JSONB DEFAULT '[]'::jsonb,
  artifacts JSONB DEFAULT '{}'::jsonb,
  staff_notes TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_event_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkin_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES checkin_sessions(id) ON DELETE CASCADE,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  event_payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guests_name ON guests(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_guests_email ON guests(email);
CREATE INDEX IF NOT EXISTS idx_reservations_arrival_status ON reservations(arrival_status);
CREATE INDEX IF NOT EXISTS idx_reservations_source ON reservations(source);
CREATE INDEX IF NOT EXISTS idx_checkin_sessions_reservation ON checkin_sessions(reservation_id);
CREATE INDEX IF NOT EXISTS idx_checkin_sessions_guest ON checkin_sessions(guest_id);
CREATE INDEX IF NOT EXISTS idx_checkin_sessions_session_key ON checkin_sessions(session_key);
CREATE INDEX IF NOT EXISTS idx_checkin_sessions_status ON checkin_sessions(status);
CREATE INDEX IF NOT EXISTS idx_checkin_events_session ON checkin_events(session_id);
CREATE INDEX IF NOT EXISTS idx_checkin_events_reservation ON checkin_events(reservation_id);
CREATE INDEX IF NOT EXISTS idx_checkin_events_type ON checkin_events(event_type);

ALTER TABLE checkin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkin_events ENABLE ROW LEVEL SECURITY;

-- Prototype policies. Keep these permissive to match the current webapp demo
-- policies; tighten behind staff auth before production.
CREATE POLICY "Public read checkin_sessions" ON checkin_sessions FOR SELECT USING (true);
CREATE POLICY "Public insert checkin_sessions" ON checkin_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update checkin_sessions" ON checkin_sessions FOR UPDATE USING (true);

CREATE POLICY "Public read checkin_events" ON checkin_events FOR SELECT USING (true);
CREATE POLICY "Public insert checkin_events" ON checkin_events FOR INSERT WITH CHECK (true);
