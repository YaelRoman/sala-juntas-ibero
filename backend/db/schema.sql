-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  email VARCHAR(200) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('secretaria', 'academico')),
  is_admin BOOLEAN DEFAULT FALSE,
  active BOOLEAN DEFAULT TRUE,
  last_login TIMESTAMPTZ,
  reset_token_hash VARCHAR(255),
  reset_token_expires TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recurring groups
CREATE TABLE recurring_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern VARCHAR(20) NOT NULL CHECK (pattern IN ('daily', 'weekly', 'biweekly', 'monthly')),
  end_date DATE,
  max_occurrences INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reservations table
CREATE TABLE reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  responsible_id UUID REFERENCES users(id) ON DELETE SET NULL,
  responsible_name VARCHAR(200) NOT NULL,
  area VARCHAR(200) NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  observations TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'past')),
  is_recurring BOOLEAN DEFAULT FALSE,
  recurring_group UUID REFERENCES recurring_groups(id),
  grouped_id UUID,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  last_modified_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Calendar events (holidays and closures)
CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  name VARCHAR(200) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('holiday', 'closure', 'evento')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  entity VARCHAR(100),
  entity_id UUID,
  details JSONB,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Backups
CREATE TABLE backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cloud_url TEXT NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failed')),
  size_bytes INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_reset_token ON users(reset_token_hash) WHERE reset_token_hash IS NOT NULL;
CREATE INDEX idx_reservations_status ON reservations(status);
CREATE INDEX idx_reservations_start_time ON reservations(start_time);
CREATE INDEX idx_reservations_created_by ON reservations(created_by);
CREATE INDEX idx_reservations_responsible_id ON reservations(responsible_id);
CREATE INDEX idx_reservations_grouped_id ON reservations(grouped_id) WHERE grouped_id IS NOT NULL;
CREATE INDEX idx_calendar_events_date ON calendar_events(date);
CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp);
