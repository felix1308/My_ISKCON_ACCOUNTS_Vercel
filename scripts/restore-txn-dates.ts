// ============================================================================
// restore-txn-dates — restores transactions.txn_date values that were
// wrongly blanked by the first (buggy) fix-bad-dates run.
//
// Source of truth: the mirrored bookings row for each transaction, matched
// on donor_id + voucherNo parsed from remarks ("voucherNo:XXX | bank:...").
// Bookings were never touched by the buggy run, so their dates are intact.
//
// Run with:  node --env-file=.env.local node_modules/.bin/tsx scripts/restore-txn-dates.ts
// Idempotent: only fills rows where txn_date is currently empty.
// ============================================================================

import { directSql } from "../lib/db-direct";
import { getEnv } from "../lib/env";

const VALID = `^\\d{4}-\\d{2}-\\d{2}`;

async function main() {
  getEnv();
  const sql = directSql();

  const before = await sql`
    SELECT count(*)::int AS n FROM transactions WHERE txn_date = ''
  `;
  console.log(`Empty txn_date before restore: ${before[0]?.n ?? 0}`);

  // Restore from mirrored booking (same donor + same voucherNo in remarks).
  // split_part(remarks,' ',1) extracts "voucherNo:XXX" exactly, avoiding
  // prefix collisions like voucher "5068" matching "50681...".
  const restored = await sql`
    WITH matches AS (
      SELECT t.id AS txn_id, min(b.booking_date) AS d
      FROM transactions t
      JOIN bookings b
        ON b.donor_id = t.donor_id
       AND split_part(b.remarks, ' ', 1) = 'voucherNo:' || t.voucher_no
       AND b.booking_date ~ ${VALID}
      WHERE t.txn_date = ''
      GROUP BY t.id
    )
    UPDATE transactions t
    SET txn_date = m.d
    FROM matches m
    WHERE t.id = m.txn_id
  `;

  const after = await sql`
    SELECT count(*)::int AS n FROM transactions WHERE txn_date = ''
  `;
  const emptyAfter = after[0]?.n ?? 0;
  console.log(`Empty txn_date after restore:  ${emptyAfter}`);
  console.log(`Restored: ${(before[0]?.n ?? 0) - emptyAfter}`);
  console.log(`Remaining empty = the ${emptyAfter} rows that legitimately had garbage/blank dates (expected ~1180)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
