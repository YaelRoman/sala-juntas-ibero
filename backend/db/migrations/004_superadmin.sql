-- Migration 004: Super-admin setup and modification requests table

-- Activate super-admin flag for known users
UPDATE users SET is_admin = true
WHERE email IN ('maya.diaz.yael@gmail.com', 'julieta.esquinca@ibero.mx');

-- Secretary modification request table
-- Allows a secretary to request a time change on another secretary's reservation
CREATE TABLE IF NOT EXISTS modification_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id   UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  requested_by     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_start_time   TIMESTAMPTZ NOT NULL,
  new_end_time     TIMESTAMPTZ NOT NULL,
  reason           TEXT,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected')),
  resolved_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ
);
