// ============================================================================
// fix-bad-dates — one-shot fixup script to blank out invalid dates in the
// transactions and bookings tables that were imported with garbage values
// like "Receipt", "SJ - DONATION RECEIPT", "DONATION RECEIPT - IYF", etc.
//
// Run with:  npx tsx scripts/fix-bad-dates.ts
//
// Requires DATABASE_URL_DIRECT in .env (same as migrate / db:push).
// Idempotent: safe to re-run — only updates rows where dates are still bad.
// ============================================================================

import { directSql } from "../lib/db-direct";
import { getEnv } from "../lib/env";

const VALID_DATE_RE = /^\d{4}-\d{2}-\d{2}/; // starts with YYYY-MM-DD

async function main() {
  getEnv();
  const sql = directSql();

  // --- Fix transactions.txn_date ---
  const badTxns = await sql`
    SELECT id, txn_date FROM transactions
    WHERE txn_date != '' AND txn_date !~ '^\d{4}-\d{2}-\d{2}'
  `;
  console.log(`Found ${badTxns.length} transactions with invalid txn_date`);
  let txnFixed = 0;
  for (const row of badTxns) {
    await sql`UPDATE transactions SET txn_date = '' WHERE id = ${row.id}`;
    txnFixed++;
  }
  console.log(`  Fixed ${txnFixed} transaction dates (set to empty string)`);

  // --- Fix bookings.booking_date ---
  const badBookings = await sql`
    SELECT id, booking_date FROM bookings
    WHERE booking_date != '' AND booking_date !~ '^\d{4}-\d{2}-\d{2}'
  `;
  console.log(`Found ${badBookings.length} bookings with invalid booking_date`);
  let bookingFixed = 0;
  for (const row of badBookings) {
    await sql`UPDATE bookings SET booking_date = '' WHERE id = ${row.id}`;
    bookingFixed++;
  }
  console.log(`  Fixed ${bookingFixed} booking dates (set to empty string)`);

  // --- Fix bookings.paid_at (e.g. "ReceiptT00:00:00.000Z") ---
  const badPaidAt = await sql`
    SELECT id, paid_at FROM bookings
    WHERE paid_at != '' AND paid_at !~ '^\d{4}-\d{2}-\d{2}'
  `;
  console.log(`Found ${badPaidAt.length} bookings with invalid paid_at`);
  let paidAtFixed = 0;
  for (const row of badPaidAt) {
    await sql`UPDATE bookings SET paid_at = '' WHERE id = ${row.id}`;
    paidAtFixed++;
  }
  console.log(`  Fixed ${paidAtFixed} paid_at values (set to empty string)`);

  // --- Fix bookings.items JSONB (bookingDate inside items array) ---
  const badItems = await sql`
    SELECT id, items FROM bookings
    WHERE items::text ~ '"bookingDate"\s*:\s*"[^"0-9]'
  `;
  console.log(`Found ${badItems.length} bookings with invalid bookingDate inside items JSONB`);
  let itemsFixed = 0;
  for (const row of badItems) {
    const items = (row.items as Array<Record<string, unknown>>).map((item) => {
      const bd = String(item.bookingDate ?? "");
      if (bd && !VALID_DATE_RE.test(bd)) {
        return { ...item, bookingDate: "" };
      }
      return item;
    });
    await sql`UPDATE bookings SET items = ${JSON.stringify(items)}::jsonb WHERE id = ${row.id}`;
    itemsFixed++;
  }
  console.log(`  Fixed ${itemsFixed} booking items JSONB`);

  console.log("\nDone!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
