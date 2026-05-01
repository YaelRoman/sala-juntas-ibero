-- Migration: Add grouped_id to reservations for multi-interval bookings
-- Links several reservation rows that were created together as one logical booking.
-- Idempotent.

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS grouped_id UUID;

CREATE INDEX IF NOT EXISTS idx_reservations_grouped_id
  ON reservations(grouped_id) WHERE grouped_id IS NOT NULL;
