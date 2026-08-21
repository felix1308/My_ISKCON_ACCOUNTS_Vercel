-- ---------------------------------------------------------------------------
-- Add sevas.notify_numbers (comma-separated phone numbers for WhatsApp seva
-- reminders on paid bookings). Idempotent — safe to run multiple times.
--
-- Apply with:
--   psql "$DATABASE_URL_DIRECT" -f scripts/apply-notify-numbers.sql
-- ---------------------------------------------------------------------------

ALTER TABLE sevas ADD COLUMN IF NOT EXISTS notify_numbers TEXT NOT NULL DEFAULT '';
