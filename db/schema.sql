-- ============================================================================
-- MyISKCON Accounts — Postgres schema
-- Run via: npm run db:push   (which executes this against DATABASE_URL_DIRECT)
-- ============================================================================

-- Extension for fast UUID-ish id generation is NOT required; we use the same
-- id scheme as the legacy Apps Script backend (id_<epoch>_<rand>) so migrated
-- rows keep their existing ids and frontend links don't break.

-- ---------------------------------------------------------------------------
-- Temples (top-level org; a temple has many centers)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS temples (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  city         TEXT NOT NULL DEFAULT '',
  state        TEXT NOT NULL DEFAULT '',
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Centers (branches under a temple)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS centers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  city         TEXT NOT NULL DEFAULT '',
  state        TEXT NOT NULL DEFAULT '',
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  temple_id    TEXT REFERENCES temples(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_centers_temple ON centers(temple_id);

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT '',
  center_id    TEXT REFERENCES centers(id) ON DELETE SET NULL,
  temple_id    TEXT REFERENCES temples(id) ON DELETE SET NULL,
  description  TEXT NOT NULL DEFAULT '',
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_departments_center ON departments(center_id);
CREATE INDEX IF NOT EXISTS idx_departments_temple ON departments(temple_id);

-- ---------------------------------------------------------------------------
-- Department heads
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS department_heads (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT '',
  role         TEXT NOT NULL DEFAULT '',
  phone        TEXT NOT NULL DEFAULT '',
  temple_id    TEXT REFERENCES temples(id) ON DELETE SET NULL,
  center_id    TEXT REFERENCES centers(id) ON DELETE SET NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Users (admins / volunteers — NOT donors)
--   password_hash: bcrypt hash (modern) OR legacy 64-hex-char SHA-256 hash.
--   password_scheme: 'bcrypt' | 'legacy_sha256'  (drives verification path)
--   legacy_password_hash: kept until the user logs in once and is rehashed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  username          TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  password_scheme   TEXT NOT NULL DEFAULT 'bcrypt',  -- 'bcrypt' | 'legacy_sha256'
  role              TEXT NOT NULL DEFAULT 'volunteer',  -- superadmin | admin | volunteer | developer
  center_id         TEXT REFERENCES centers(id) ON DELETE SET NULL,
  temple_id         TEXT REFERENCES temples(id) ON DELETE SET NULL,
  department_id     TEXT REFERENCES departments(id) ON DELETE SET NULL,
  permissions       JSONB NOT NULL DEFAULT '{}'::jsonb,
  cashbooks         JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by        TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_users_center ON users(center_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ---------------------------------------------------------------------------
-- Donors
--   pan / email are stored encrypted (AES-256-GCM, ciphertext TEXT).
--   password_hash / password_scheme mirror users (donor self-login).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS donors (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL DEFAULT '',
  spiritual_name    TEXT NOT NULL DEFAULT '',
  indian_passport   BOOLEAN NOT NULL DEFAULT FALSE,
  pan               TEXT NOT NULL DEFAULT '',       -- AES-256-GCM ciphertext (b64)
  mobile            TEXT NOT NULL DEFAULT '',
  whatsapp          TEXT NOT NULL DEFAULT '',
  email             TEXT NOT NULL DEFAULT '',       -- AES-256-GCM ciphertext (b64)
  flat              TEXT NOT NULL DEFAULT '',
  road              TEXT NOT NULL DEFAULT '',
  po                TEXT NOT NULL DEFAULT '',
  area              TEXT NOT NULL DEFAULT '',
  pincode           TEXT NOT NULL DEFAULT '',
  district          TEXT NOT NULL DEFAULT '',
  state             TEXT NOT NULL DEFAULT '',
  country           TEXT NOT NULL DEFAULT '',
  tally_name        TEXT NOT NULL DEFAULT '',
  center_id         TEXT REFERENCES centers(id) ON DELETE SET NULL,
  password_hash     TEXT NOT NULL DEFAULT '',
  password_scheme   TEXT NOT NULL DEFAULT 'bcrypt',
  created_by        TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_donors_center ON donors(center_id);
CREATE INDEX IF NOT EXISTS idx_donors_mobile ON donors(mobile);
CREATE INDEX IF NOT EXISTS idx_donors_name_lower ON donors(lower(name));

-- ---------------------------------------------------------------------------
-- Sevas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sevas (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL DEFAULT '',
  description      TEXT NOT NULL DEFAULT '',
  amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
  center_id        TEXT REFERENCES centers(id) ON DELETE SET NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  darshan_qr       TEXT NOT NULL DEFAULT '',
  seva_qr          TEXT NOT NULL DEFAULT '',
  prasadam_qr      TEXT NOT NULL DEFAULT '',
  notify_whatsapp  BOOLEAN NOT NULL DEFAULT FALSE,
  -- Comma-separated phone numbers (pujari/cook) that receive a WhatsApp
  -- reminder when a paid booking includes this seva. Port of the legacy
  -- notifyWhatsapp CSV field (see scripts/apply-notify-numbers.sql).
  notify_numbers   TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sevas_center ON sevas(center_id);

-- ---------------------------------------------------------------------------
-- Bookings (seva / donation bookings)
--   items: JSONB array of seva line items.
--   total_amount: NUMERIC(12,2) in INR.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
  id                    TEXT PRIMARY KEY,
  donor_id              TEXT REFERENCES donors(id) ON DELETE CASCADE,
  items                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_status        TEXT NOT NULL DEFAULT 'pending',  -- pending | paid
  payment_mode          TEXT NOT NULL DEFAULT '',         -- cash | cheque | razorpay | etc.
  booking_date          TEXT NOT NULL DEFAULT '',         -- kept as text to preserve legacy format
  center_id             TEXT REFERENCES centers(id) ON DELETE SET NULL,
  collected_by          TEXT NOT NULL DEFAULT '',
  collected_by_center   TEXT NOT NULL DEFAULT '',
  cheque_bank_account_id TEXT NOT NULL DEFAULT '',
  festival_qr           BOOLEAN NOT NULL DEFAULT FALSE,
  razorpay_order_id     TEXT NOT NULL DEFAULT '',
  razorpay_payment_id   TEXT NOT NULL DEFAULT '',
  paid_at               TEXT NOT NULL DEFAULT '',
  remarks               TEXT NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bookings_donor ON bookings(donor_id);
CREATE INDEX IF NOT EXISTS idx_bookings_center ON bookings(center_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(payment_status);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date);

-- ---------------------------------------------------------------------------
-- Transactions (Tally import — donor financial history)
--   Maps to the legacy bulkImportTransactions flow.
--   booking_id: optional link to a bookings row when reconciled.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id                  TEXT PRIMARY KEY,
  donor_id            TEXT REFERENCES donors(id) ON DELETE CASCADE,
  voucher_no          TEXT NOT NULL DEFAULT '',
  txn_date            TEXT NOT NULL DEFAULT '',       -- legacy date string preserved
  amount              NUMERIC(12,2) NOT NULL DEFAULT 0,
  transaction_details TEXT NOT NULL DEFAULT '',
  bank                TEXT NOT NULL DEFAULT '',
  transaction_type    TEXT NOT NULL DEFAULT '',       -- Receipt | Payment | etc.
  tally_ledger        TEXT NOT NULL DEFAULT '',
  status_80g          TEXT NOT NULL DEFAULT '',
  branch              TEXT NOT NULL DEFAULT '',
  booking_id          TEXT REFERENCES bookings(id) ON DELETE SET NULL,
  center_id           TEXT REFERENCES centers(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_txns_donor ON transactions(donor_id);
CREATE INDEX IF NOT EXISTS idx_txns_voucher ON transactions(voucher_no);
CREATE INDEX IF NOT EXISTS idx_txns_branch ON transactions(branch);
CREATE INDEX IF NOT EXISTS idx_txns_date ON transactions(txn_date);

-- ---------------------------------------------------------------------------
-- Payment gateways
--   razorpay_key_secret_enc: AES-256-GCM ciphertext (b64), key from ENCRYPTION_KEY_HEX.
--   (Defined before bank_accounts because bank_accounts references it.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_gateways (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL DEFAULT '',
  razorpay_key_id       TEXT NOT NULL DEFAULT '',
  razorpay_key_secret_enc TEXT NOT NULL DEFAULT '',
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Bank accounts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bank_accounts (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL DEFAULT '',
  account_number      TEXT NOT NULL DEFAULT '',
  bank_name           TEXT NOT NULL DEFAULT '',
  center_id           TEXT REFERENCES centers(id) ON DELETE SET NULL,
  payment_gateway_id  TEXT REFERENCES payment_gateways(id) ON DELETE SET NULL,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  event_date    TEXT NOT NULL DEFAULT '',
  event_time    TEXT NOT NULL DEFAULT '',
  venue         TEXT NOT NULL DEFAULT '',
  price         NUMERIC(12,2) NOT NULL DEFAULT 0,
  capacity      INTEGER NOT NULL DEFAULT 0,
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  center_id     TEXT REFERENCES centers(id) ON DELETE SET NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_center ON events(center_id);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);

-- ---------------------------------------------------------------------------
-- Event bookings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_bookings (
  id                  TEXT PRIMARY KEY,
  event_id            TEXT REFERENCES events(id) ON DELETE CASCADE,
  donor_id            TEXT REFERENCES donors(id) ON DELETE CASCADE,
  quantity            INTEGER NOT NULL DEFAULT 1,
  total_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_status      TEXT NOT NULL DEFAULT 'pending',
  payment_mode        TEXT NOT NULL DEFAULT '',
  razorpay_order_id   TEXT NOT NULL DEFAULT '',
  razorpay_payment_id TEXT NOT NULL DEFAULT '',
  paid_at             TEXT NOT NULL DEFAULT '',
  remarks             TEXT NOT NULL DEFAULT '',
  booked_by           TEXT NOT NULL DEFAULT '',
  center_id           TEXT REFERENCES centers(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_bookings_event ON event_bookings(event_id);
CREATE INDEX IF NOT EXISTS idx_event_bookings_donor ON event_bookings(donor_id);

-- ---------------------------------------------------------------------------
-- QR scans (validation log for festival / darshan / prasadam QRs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qr_scans (
  id          TEXT PRIMARY KEY,
  booking_id  TEXT REFERENCES bookings(id) ON DELETE CASCADE,
  item_index  INTEGER NOT NULL DEFAULT 0,
  type        TEXT NOT NULL DEFAULT '',     -- darshan | seva | prasadam
  scanned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  scanned_by  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_qr_scans_booking ON qr_scans(booking_id);

-- ---------------------------------------------------------------------------
-- 10BE records (Drive URL lookup for 80G/10BE receipts)
--   pan stored uppercase; voucher_no matched case-insensitively (trimmed).
--   txn_date normalized to YYYY-MM-DD. amount in INR.
--   Imported from the legacy ten_be_*_map.js files via scripts/import-tenbe.ts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ten_be_records (
  id          BIGSERIAL PRIMARY KEY,
  pan         TEXT NOT NULL DEFAULT '',
  voucher_no  TEXT NOT NULL DEFAULT '',
  txn_date    TEXT NOT NULL DEFAULT '',       -- YYYY-MM-DD
  amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  url         TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (voucher_no, url)
);
CREATE INDEX IF NOT EXISTS idx_ten_be_voucher ON ten_be_records(voucher_no);
CREATE INDEX IF NOT EXISTS idx_ten_be_pan ON ten_be_records(pan);

-- ---------------------------------------------------------------------------
-- Sessions
--   session_id is the HMAC-signed token sent to the client.
--   stored_hash is sha256(session_id) for constant-time lookup by token.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id            BIGSERIAL PRIMARY KEY,
  session_id    TEXT NOT NULL UNIQUE,        -- opaque token (HMAC-signed)
  stored_hash   TEXT NOT NULL UNIQUE,        -- sha256(session_id)
  user_id       TEXT NOT NULL,
  username      TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT '',
  center_id     TEXT NOT NULL DEFAULT '',
  is_donor      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  ip_address    TEXT NOT NULL DEFAULT '',
  user_agent    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ---------------------------------------------------------------------------
-- App config (small key-value store for things like SUPERADMIN_DETAINED)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGSERIAL PRIMARY KEY,
  timestamp     TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       TEXT NOT NULL DEFAULT '',
  username      TEXT NOT NULL DEFAULT '',
  action        TEXT NOT NULL DEFAULT '',
  resource_type TEXT NOT NULL DEFAULT '',
  resource_id   TEXT NOT NULL DEFAULT '',
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address    TEXT NOT NULL DEFAULT '',
  success       BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);

-- ---------------------------------------------------------------------------
-- Sadhana entries — one row per devotee per day. STRICTLY private: rows are
-- only ever read by their owner (enforced in lib/handlers/sadhana.ts).
-- The 5 avenues: wake/sleep times, chanting rounds, hearing, reading, service.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sadhana_entries (
  id               TEXT PRIMARY KEY,
  principal_id     TEXT NOT NULL,            -- users.id or donors.id
  principal_type   TEXT NOT NULL DEFAULT 'user',  -- 'user' | 'donor'
  entry_date       TEXT NOT NULL,            -- YYYY-MM-DD
  wake_up_at       TEXT NOT NULL DEFAULT '', -- HH:MM
  sleep_at         TEXT NOT NULL DEFAULT '', -- HH:MM (previous night)
  chanting_rounds  INT  NOT NULL DEFAULT 0,
  hearing_minutes  INT  NOT NULL DEFAULT 0,
  reading_minutes  INT  NOT NULL DEFAULT 0,
  reading_book     TEXT NOT NULL DEFAULT '',
  service_minutes  INT  NOT NULL DEFAULT 0,
  service_note     TEXT NOT NULL DEFAULT '',
  notes            TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (principal_id, principal_type, entry_date)
);
CREATE INDEX IF NOT EXISTS idx_sadhana_owner ON sadhana_entries(principal_id, entry_date DESC);

-- ---------------------------------------------------------------------------
-- updated_at trigger (kept lightweight; one function reused by all tables)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'temples','centers','departments','department_heads','users','donors',
    'sevas','bookings','bank_accounts','payment_gateways','events',
    'event_bookings','sadhana_entries'
  ]) LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_updated ON %1$s; '
      'CREATE TRIGGER trg_%1$s_updated BEFORE UPDATE ON %1$s '
      'FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t);
  END LOOP;
END $$;
