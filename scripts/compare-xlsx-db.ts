// Compare xlsx export (/tmp/xlsx_export.json) against live Postgres.
import { readFileSync } from "node:fs";
import { directSql } from "../lib/db-direct";
import { getEnv } from "../lib/env";

async function main() {
  getEnv();
  const sql = directSql();
  const x = JSON.parse(readFileSync("/tmp/xlsx_export.json", "utf8")) as {
    donor_mobiles: string[];
    booking_vouchers: string[];
    booking_rows: Array<{ voucher: string; donorId: string; bookingDate: string }>;
  };

  // Donors: coverage by mobile
  const dbDonors = await sql`SELECT mobile FROM donors`;
  const dbMobiles = new Set(dbDonors.map((d) => String(d.mobile ?? "").replace(/\D/g, "").slice(-10)));
  const xMobiles = new Set(x.donor_mobiles.filter(Boolean));
  let donorsMissingInDb = 0;
  for (const m of xMobiles) if (!dbMobiles.has(m)) donorsMissingInDb++;
  let donorsMissingInXlsx = 0;
  for (const m of dbMobiles) if (m && !xMobiles.has(m)) donorsMissingInXlsx++;
  console.log(`Donors: xlsx=${xMobiles.size} unique mobiles, db=${dbMobiles.size}`);
  console.log(`  in xlsx but NOT in db: ${donorsMissingInDb}`);
  console.log(`  in db but NOT in xlsx: ${donorsMissingInXlsx}`);

  // Bookings: coverage by voucherNo (from remarks)
  const dbBookings = await sql`SELECT remarks FROM bookings WHERE remarks LIKE 'voucherNo:%'`;
  const dbVouchers = new Set<string>();
  for (const b of dbBookings) {
    const m = String(b.remarks).match(/^voucherNo:([^\s|]+)/);
    if (m) dbVouchers.add(m[1]);
  }
  const xVouchers = new Set(x.booking_vouchers.filter(Boolean));
  let vMissingInDb = 0; const missingSamples: string[] = [];
  for (const v of xVouchers) if (!dbVouchers.has(v)) { vMissingInDb++; if (missingSamples.length < 10) missingSamples.push(v); }
  let vMissingInXlsx = 0;
  for (const v of dbVouchers) if (!xVouchers.has(v)) vMissingInXlsx++;
  console.log(`Booking vouchers: xlsx=${xVouchers.size}, db=${dbVouchers.size}`);
  console.log(`  in xlsx but NOT in db: ${vMissingInDb}`, missingSamples);
  console.log(`  in db but NOT in xlsx: ${vMissingInXlsx}`);

  // Orphan txns (236 not found in .bak): are their vouchers in the xlsx?
  const orphans = await sql`
    SELECT t.voucher_no FROM transactions t WHERE t.txn_date = ''
  `;
  let orphanInXlsx = 0;
  for (const o of orphans) if (xVouchers.has(String(o.voucher_no).trim())) orphanInXlsx++;
  console.log(`Empty-date txns in db: ${orphans.length}; of those, voucher present in xlsx: ${orphanInXlsx}`);

  // For orphans present in xlsx: does xlsx have a valid date for them?
  const xlsDateByVoucher = new Map<string, string>();
  for (const r of x.booking_rows) {
    if (r.voucher && !xlsDateByVoucher.has(r.voucher)) xlsDateByVoucher.set(r.voucher, r.bookingDate);
  }
  let recoverable = 0; const recSamples: Array<[string, string]> = [];
  for (const o of orphans) {
    const d = xlsDateByVoucher.get(String(o.voucher_no).trim());
    if (d && /^\d{4}-\d{2}-\d{2}/.test(d)) { recoverable++; if (recSamples.length < 10) recSamples.push([String(o.voucher_no), d]); }
  }
  console.log(`  ...with VALID date in xlsx (recoverable): ${recoverable}`, recSamples);
}

main().catch((e) => { console.error(e); process.exit(1); });
