-- =============================================================================
-- AI Hotel Check-in Kiosk — Seed Data
-- =============================================================================
-- Run after the migration to populate with mock hotel data.

-- Hotel Info
INSERT INTO hotel_info (name, address, city, country, phone, email, website, description, amenities, check_in_time, check_out_time, wifi_password, emergency_contact, nearby_attractions)
VALUES (
  'The Grand Azure Hotel',
  '1 Marina Boulevard',
  'Singapore',
  'Singapore',
  '+65 6888 8888',
  'info@grandazure.com',
  'https://grandazure.com',
  'A luxury 5-star hotel overlooking Marina Bay, offering world-class amenities and personalized service.',
  ARRAY['Infinity Pool', 'Spa & Wellness Center', 'Fitness Center', 'Azure Restaurant', 'Rooftop Bar', 'Business Center', 'Concierge Service', 'Valet Parking', 'Free Wi-Fi', 'Room Service 24/7', 'Laundry Service', 'Airport Shuttle'],
  '3:00 PM',
  '11:00 AM',
  'AZURE2024',
  '+65 6888 8999',
  '[
    {"name": "Gardens by the Bay", "distance": "0.5 km", "description": "Iconic nature park with Supertrees and Cloud Forest"},
    {"name": "Marina Bay Sands", "distance": "0.3 km", "description": "Entertainment complex with SkyPark observation deck"},
    {"name": "Merlion Park", "distance": "1.0 km", "description": "Iconic Singapore landmark and photo spot"},
    {"name": "Chinatown", "distance": "2.5 km", "description": "Vibrant cultural district with food and shopping"}
  ]'::jsonb
);

-- Guests
INSERT INTO guests (id, first_name, last_name, email, phone, nationality, passport_number, date_of_birth) VALUES
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'James', 'Chen', 'james.chen@email.com', '+65 9123 4567', 'Singapore', 'E1234567A', '1985-03-15'),
  ('b2c3d4e5-f6a7-8901-bcde-f12345678901', 'Sarah', 'Williams', 'sarah.w@email.com', '+44 7700 900123', 'United Kingdom', 'GB9876543', '1990-07-22'),
  ('c3d4e5f6-a7b8-9012-cdef-012345678912', 'Yuki', 'Tanaka', 'yuki.t@email.com', '+81 90 1234 5678', 'Japan', 'TK5551234', '1988-11-08'),
  ('d4e5f6a7-b8c9-0123-defa-123456789023', 'Marco', 'Rossi', 'marco.r@email.com', '+39 333 1234567', 'Italy', 'IT7654321', '1992-01-30'),
  ('e5f6a7b8-c9d0-1234-efab-234567890134', 'Emma', 'Anderson', 'emma.a@email.com', '+1 555 0123', 'United States', 'US4567890', '1987-09-12');

-- Rooms
INSERT INTO rooms (id, room_number, type, floor, price_per_night, currency, max_occupancy, bed_type, amenities, is_available, description) VALUES
  ('r001-0000-0000-0000-000000000001', '1204', 'standard', 12, 350, 'SGD', 2, 'King', ARRAY['City View', 'Mini Bar', 'Rain Shower', '55" Smart TV', 'Nespresso Machine'], true, 'Elegant room with city skyline views and modern amenities.'),
  ('r001-0000-0000-0000-000000000002', '1208', 'standard', 12, 350, 'SGD', 2, 'Twin', ARRAY['City View', 'Mini Bar', 'Rain Shower', '55" Smart TV', 'Nespresso Machine'], true, 'Comfortable twin room perfect for friends or colleagues.'),
  ('r001-0000-0000-0000-000000000003', '1508', 'deluxe', 15, 520, 'SGD', 2, 'King', ARRAY['Marina Bay View', 'Mini Bar', 'Rainfall Shower', '65" Smart TV', 'Nespresso Machine', 'Bathrobe & Slippers', 'Turndown Service'], true, 'Spacious room with panoramic Marina Bay views and premium touches.'),
  ('r001-0000-0000-0000-000000000004', '1512', 'deluxe', 15, 520, 'SGD', 2, 'King', ARRAY['Marina Bay View', 'Mini Bar', 'Rainfall Shower', '65" Smart TV', 'Nespresso Machine', 'Bathrobe & Slippers', 'Turndown Service'], true, 'Luxurious deluxe room with bay views and elegant furnishings.'),
  ('r001-0000-0000-0000-000000000005', '2001', 'suite', 20, 880, 'SGD', 3, 'King + Sofa Bed', ARRAY['Panoramic Bay View', 'Separate Living Area', 'Walk-in Closet', 'Jacuzzi Tub', 'Premium Mini Bar', '75" Smart TV', 'Butler Service', 'Complimentary Breakfast'], true, 'Luxurious suite with separate living area and butler service.'),
  ('r001-0000-0000-0000-000000000006', '2501', 'penthouse', 25, 2200, 'SGD', 4, 'King + Twin', ARRAY['360° Panoramic View', 'Private Terrace', 'Full Kitchen', 'Dining Room', 'Private Pool', 'Home Theater', 'Butler Service', 'Complimentary Spa', 'Airport Transfer'], true, 'The pinnacle of luxury — a private penthouse with terrace pool and 360° views.');

-- Reservations (dates relative to "today")
INSERT INTO reservations (id, confirmation_code, guest_id, room_id, check_in_date, check_out_date, number_of_guests, status, special_requests, total_amount, currency) VALUES
  ('res-0001', 'GAH-2026-1', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'r001-0000-0000-0000-000000000001', CURRENT_DATE, CURRENT_DATE + 3, 2, 'confirmed', 'High floor, extra pillows', 1050, 'SGD'),
  ('res-0002', 'GAH-2026-2', 'b2c3d4e5-f6a7-8901-bcde-f12345678901', 'r001-0000-0000-0000-000000000003', CURRENT_DATE, CURRENT_DATE + 5, 1, 'confirmed', NULL, 2600, 'SGD'),
  ('res-0003', 'GAH-2026-3', 'c3d4e5f6-a7b8-9012-cdef-012345678912', 'r001-0000-0000-0000-000000000005', CURRENT_DATE, CURRENT_DATE + 2, 2, 'confirmed', 'Late check-in, Japanese newspaper', 1760, 'SGD'),
  ('res-0004', 'GAH-2026-4', 'd4e5f6a7-b8c9-0123-defa-123456789023', 'r001-0000-0000-0000-000000000002', CURRENT_DATE + 1, CURRENT_DATE + 4, 1, 'confirmed', 'Ground floor if available', 1050, 'SGD'),
  ('res-0005', 'GAH-2026-5', 'e5f6a7b8-c9d0-1234-efab-234567890134', 'r001-0000-0000-0000-000000000004', CURRENT_DATE, CURRENT_DATE + 7, 2, 'confirmed', 'Anniversary celebration, champagne in room', 3640, 'SGD');

-- Room Upgrades
INSERT INTO room_upgrades (from_room_type, to_room_type, additional_cost_per_night, currency, description, highlights) VALUES
  ('standard', 'Deluxe Room', 170, 'SGD', 'Upgrade to a Deluxe Room with Marina Bay views', ARRAY['Bay View', 'Turndown Service', 'Premium Amenities']),
  ('standard', 'Suite', 530, 'SGD', 'Upgrade to a Suite with living area and butler service', ARRAY['Living Area', 'Jacuzzi', 'Butler Service', 'Free Breakfast']),
  ('deluxe', 'Suite', 360, 'SGD', 'Upgrade to a Suite with living area and butler service', ARRAY['Living Area', 'Jacuzzi', 'Butler Service', 'Free Breakfast']),
  ('deluxe', 'Penthouse', 1680, 'SGD', 'Upgrade to the Penthouse with private pool and terrace', ARRAY['Private Pool', 'Terrace', '360° Views', 'Home Theater']),
  ('suite', 'Penthouse', 1320, 'SGD', 'Upgrade to the Penthouse with private pool and terrace', ARRAY['Private Pool', 'Private Terrace', '360° Views', 'Airport Transfer']);
