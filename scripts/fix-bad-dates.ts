// ============================================================================
// fix-bad-dates — one-shot fixup script to blank out invalid dates in the
// transactions and bookings tables that were imported with garbage values
// like "Receipt", "SJ - DONATION RECEIPT", "DONATION RECEIPT - IYF", etc.
//
// Run with:  npm run fix-dates
//
// Requires DATABASE_URL_DIRECT in .env.local (same as migrate / db:push).
// Idempotent: safe to re-run — only touches rows where dates are still bad.
// Uses single bulk UPDATEs (one round-trip per section) so it finishes fast.
// ============================================================================

import { directSql } from "../lib/db-direct";
import { getEnv } from "../lib/env";

const BAD_DATE = `^\\d{4}-\\d{2}-\\d{2}`; // valid dates start with YYYY-MM-DD

async function main() {
  getEnv();
  const sql = directSql();

  // --- transactions.txn_date ---
  const txnCount = await sql`
    SELECT count(*)::int AS n FROM transactions
    WHERE txn_date != '' AND txn_date !~ ${BAD_DATE}
  `;
  await sql`
    UPDATE transactions SET txn_date = ''
    WHERE txn_date != '' AND txn_date !~ ${BAD_DATE}
  `;
  console.log(`transactions.txn_date:   fixed ${txnCount[0]?.n ?? 0} rows`);

  // --- bookings.booking_date ---
  const bookingCount = await sql`
    SELECT count(*)::int AS n FROM bookings
    WHERE booking_date != '' AND booking_date !~ ${BAD_DATE}
  `;
  await sql`
    UPDATE bookings SET booking_date = ''
    WHERE booking_date != '' AND booking_date !~ ${BAD_DATE}
  `;
  console.log(`bookings.booking_date:   fixed ${bookingCount[0]?.n ?? 0} rows`);

  // --- bookings.paid_at (e.g. "ReceiptT00:00:00.000Z") ---
  const paidAtCount = await sql`
    SELECT count(*)::int AS n FROM bookings
    WHERE paid_at != '' AND paid_at !~ ${BAD_DATE}
  `;
  await sql`
    UPDATE bookings SET paid_at = ''
    WHERE paid_at != '' AND paid_at !~ ${BAD_DATE}
  `;
  console.log(`bookings.paid_at:        fixed ${paidAtCount[0]?.n ?? 0} rows`);

  // --- bookings.items JSONB: blank bad bookingDate inside each item ---
  // (exclude already-blanked '' values so reruns report 0)
  const itemsCount = await sql`
    SELECT count(*)::int AS n FROM bookings
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(items) AS e
      WHERE e->>'bookingDate' IS NOT NULL AND e->>'bookingDate' != '' AND e->>'bookingDate' !~ ${BAD_DATE}
    )
  `;
  await sql`
    UPDATE bookings
    SET items = (
      SELECT jsonb_agg(
        CASE
          WHEN elem->>'bookingDate' IS NOT NULL AND elem->>'bookingDate' != '' AND elem->>'bookingDate' !~ ${BAD_DATE}
          THEN jsonb_set(elem, '{bookingDate}', '""')
          ELSE elem
        END
      )
      FROM jsonb_array_elements(items) AS elem
    )
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(items) AS e
      WHERE e->>'bookingDate' IS NOT NULL AND e->>'bookingDate' != '' AND e->>'bookingDate' !~ ${BAD_DATE}
    )
  `;
  console.log(`bookings.items JSONB:    fixed ${itemsCount[0]?.n ?? 0} rows`);

  console.log("\nDone!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
