-- =============================================================================
-- Add room_for_robot column to rooms table
-- =============================================================================
-- This column stores the Sesto robot waypoint ID for each room.
-- The Sesto robot uses this ID to navigate to the correct room location.
-- Values should match the waypoint labels configured on the Sesto robot side.

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS room_for_robot TEXT;

CREATE INDEX IF NOT EXISTS idx_rooms_robot_waypoint ON rooms(room_for_robot);
