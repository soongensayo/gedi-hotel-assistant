-- =============================================================================
-- Webapp RLS Policies — Booking + Admin Operations
-- =============================================================================
-- Run this against your Supabase project to allow the webapp to insert, update,
-- and delete records via the anon key. For production, restrict these policies
-- with proper authentication.

-- Booking flow: guests and reservations can be inserted
CREATE POLICY "Public insert guests" ON guests FOR INSERT WITH CHECK (true);
CREATE POLICY "Public insert reservations" ON reservations FOR INSERT WITH CHECK (true);

-- Admin: full CRUD on guests
CREATE POLICY "Public update guests" ON guests FOR UPDATE USING (true);
CREATE POLICY "Public delete guests" ON guests FOR DELETE USING (true);

-- Admin: full CRUD on rooms
CREATE POLICY "Public insert rooms" ON rooms FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update rooms" ON rooms FOR UPDATE USING (true);
CREATE POLICY "Public delete rooms" ON rooms FOR DELETE USING (true);

-- Admin: update and delete reservations
CREATE POLICY "Public update reservations" ON reservations FOR UPDATE USING (true);
CREATE POLICY "Public delete reservations" ON reservations FOR DELETE USING (true);
