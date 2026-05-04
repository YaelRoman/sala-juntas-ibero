-- Migration 003: Add 'evento' as a calendar_events type
-- Eventos mark a day with a tag but do NOT block reservations

ALTER TABLE calendar_events
  DROP CONSTRAINT calendar_events_type_check;

ALTER TABLE calendar_events
  ADD CONSTRAINT calendar_events_type_check
  CHECK (type IN ('holiday', 'closure', 'evento'));
