// ============================================================================
// migrate-from-json — one-shot data migration from the legacy
// donors_with_transactions.json export into the new Postgres schema.
//
// Run with:  npm run migrate
//
// What it does:
//   1. Reads scripts/donors_with_transactions.json (3,693 donors + txns).
//   2. Inserts donors (PAN/email encrypted with AES-256-GCM).
//   3. Inserts each transaction as a `transactions` row AND a paid `booking`
//      row (mirroring the legacy bulkImportTransactions flow which created
//      bookings from Tally history).
//   4. Skips donors already present (matched by mobile or PAN).
//   5. Reports counts. Idempotent: re-running skips already-migrated rows.
//
// IMPORTANT: this script reads PII from a local JSON file (gitignored). It does
// not exfiltrate anything — all inserts go to your own Neon Postgres instance.
// ============================================================================

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql, sqlTyped } from "../lib/db";
import { directSql } from "../lib/db-direct";
import { getEnv } from "../lib/env";
import { encrypt, decrypt } from "../lib/crypto";
import { generateId } from "../lib/ids";

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, "donors_with_transactions.json");

interface Txn {
  voucherNo: string;
  date: string;
  amount: number;
  transactionDetails: string;
  bank: string;
  transactionType: string;
  tallyLedger: string;
  status80g: string;
  branch: string;
}
interface DonorRecord {
  name: string;
  spiritualName?: string;
  indianPassport?: boolean;
  pan?: string;
  mobile: string;
  whatsapp?: string;
  email?: string;
  flat?: string;
  road?: string;
  po?: string;
  area?: string;
  pincode?: string;
  district?: string;
  state?: string;
  country?: string;
  tallyName?: string;
  centerId?: string;
  transactions?: Txn[];
  transactionCount?: number;
  totalDonated?: number;
}
interface ExportShape {
  donors: DonorRecord[];
  _meta?: Record<string, unknown>;
}

const IMPORT_BRANCH_MAP: Record<string, string> = {
  ICC: "center_bangalore",
  IYF: "center_iyf",
  KALABURGI: "center_kalaburgi",
  RRN: "center_rajarajeshwari_nagar",
  BEGUR: "center_begur",
  TUMKUR: "center_tumkur",
  KBK: "center_bangalore",
  YATRAS: "center_bangalore",
  PROJECT: "center_bangalore",
};

function normalizeMobile(m: unknown): string {
  return String(m ?? "").replace(/\D/g, "").slice(-10);
}
/** Returns true only for YYYY-MM-DD strings that parse to a real calendar date. */
function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}
function derivePaymentMode(t: unknown): string {
  const s = String(t ?? "").toLowerCase();
  if (s.includes("razorpay") || s.includes("online")) return "online";
  if (s.includes("cheque") || s.includes("check")) return "cheque";
  if (s.includes("upi")) return "upi";
  if (s.includes("card")) return "card";
  return "cash";
}

// Retry wrapper — Neon HTTP connections can drop under load. Retry with backoff.
async function withRetry<T>(fn: () => Promise<T>, retries = 5, baseDelay = 1000): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt < retries - 1 && (/fetch failed|connect timeout|ECONNRESET|socket hang up|ETIMEDOUT/i.test(msg))) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.error(`  [retry ${attempt + 1}/${retries}] ${msg.split("\n")[0]} — waiting ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
  throw new Error("unreachable");
}

async function main() {
  getEnv();
  const write = directSql(); // direct (non-pooled) for bulk inserts
  const raw = readFileSync(JSON_PATH, "utf8");
  const data = JSON.parse(raw) as ExportShape;
  console.log(`Loaded ${data.donors.length} donors from ${JSON_PATH}`);

  // Build dedup maps of existing donors by mobile and PAN.
  const existing = await withRetry(() => sqlTyped<{ id: string; mobile: string; pan: string }>`SELECT id, mobile, pan FROM donors`);
  const mobileMap = new Map<string, string>();
  const panMap = new Map<string, string>();
  for (const d of existing) {
    const m = normalizeMobile(d.mobile);
    if (m) mobileMap.set(m, d.id);
    if (d.pan) {
      try { const p = decrypt(d.pan).toUpperCase(); if (p) panMap.set(p, d.id); } catch { /* */ }
    }
  }

  // Existing booking dedup keys (voucherNo|donorId from remarks).
  const existingBookings = await withRetry(() => sqlTyped<{ remarks: string; donor_id: string }>`SELECT remarks, donor_id FROM bookings WHERE remarks LIKE 'voucherNo:%'`);
  const voucherKeys = new Set<string>();
  for (const b of existingBookings) {
    const m = String(b.remarks).match(/^voucherNo:([^\s|]+)/);
    if (m) voucherKeys.add(`${m[1]}|${b.donor_id}`);
  }

  let donorsCreated = 0, donorsSkipped = 0;
  let txnsCreated = 0, txnsSkipped = 0, bookingsCreated = 0, bookingsSkipped = 0;
  const ts = new Date().toISOString();

  for (let i = 0; i < data.donors.length; i++) {
    const d = data.donors[i];
    const mob = normalizeMobile(d.mobile);
    const pan = (d.pan ?? "").trim().toUpperCase();
    let donorId: string;
    const existingId = (mob && mobileMap.get(mob)) || (pan && panMap.get(pan));
    if (existingId) {
      donorId = existingId;
      donorsSkipped++;
    } else {
      donorId = generateId("donor");
      const centerId = (d.centerId ?? "").trim() || "center_bangalore";
      await withRetry(() => write`
        INSERT INTO donors
          (id, name, spiritual_name, indian_passport, pan, mobile, whatsapp, email,
           flat, road, po, area, pincode, district, state, country, tally_name,
           center_id, password_hash, password_scheme, created_by, created_at, updated_at)
        VALUES
          (${donorId}, ${d.name.trim()}, ${(d.spiritualName ?? "").trim()},
           ${d.indianPassport === true || String(d.indianPassport) === "true"},
           ${encrypt(pan)}, ${d.mobile.trim()},
           ${(d.whatsapp ?? "").trim() || d.mobile.trim()},
           ${encrypt((d.email ?? "").trim())},
           ${(d.flat ?? "").trim()}, ${(d.road ?? "").trim()},
           ${(d.po ?? "").trim()}, ${(d.area ?? "").trim()},
           ${(d.pincode ?? "").trim()}, ${(d.district ?? "").trim()},
           ${(d.state ?? "").trim()}, ${(d.country ?? "India").trim()},
           ${(d.tallyName ?? "").trim()}, ${centerId || null},
           '', 'bcrypt', 'migration', ${ts}, ${ts})
      `);
      if (mob) mobileMap.set(mob, donorId);
      if (pan) panMap.set(pan, donorId);
      donorsCreated++;
    }

    // Insert transactions + mirrored bookings.
    const txns = d.transactions ?? [];
    for (const t of txns) {
      const voucherNo = (t.voucherNo ?? "").trim();
      if (!voucherNo) { txnsSkipped++; continue; }
      const dedupeKey = `${voucherNo}|${donorId}`;
      if (voucherKeys.has(dedupeKey)) { txnsSkipped++; bookingsSkipped++; continue; }
      voucherKeys.add(dedupeKey);

      const branchRaw = (t.branch ?? "").trim().toUpperCase().split(/[\s\-_\/|,]+/)[0];
      const centerId = IMPORT_BRANCH_MAP[branchRaw] || (d.centerId ?? "").trim() || "center_bangalore";
      const amount = Number(t.amount ?? 0) || 0;
      const rawDate = (t.date ?? "").trim();
      const bookingDate = isValidDate(rawDate) ? rawDate : ts.split("T")[0];
      const txnDetails = (t.transactionDetails ?? "").trim();
      const razorpayPaymentId = txnDetails.startsWith("pay_") ? txnDetails : "";
      const remarks = `voucherNo:${voucherNo}${t.bank ? ` | bank:${t.bank}` : ""}`;

      // transactions row
      const txnId = generateId("txn");
      try {
        await withRetry(() => write`
          INSERT INTO transactions
            (id, donor_id, voucher_no, txn_date, amount, transaction_details,
             bank, transaction_type, tally_ledger, status_80g, branch, center_id, created_at)
          VALUES
            (${txnId}, ${donorId}, ${voucherNo}, ${bookingDate}, ${amount},
             ${txnDetails}, ${(t.bank ?? "").trim()}, ${(t.transactionType ?? "").trim()},
             ${(t.tallyLedger ?? "").trim()}, ${(t.status80g ?? "").trim()},
             ${(t.branch ?? "").trim()}, ${centerId || null}, ${ts})
        `);
        txnsCreated++;
      } catch (e) {
        txnsSkipped++;
        if (process.env.DEBUG_MIGRATE) console.error("  txn insert failed:", (e as Error).message);
      }

      // mirrored paid booking (so receipts/reports work the same as legacy)
      const bookingId = generateId("bk");
      const items = [{ sevaId: "imported", name: (t.tallyLedger ?? "Donation").trim(), description: (t.status80g ?? "").trim(), amount, quantity: 1, bookingDate }];
      try {
        await withRetry(() => write`
          INSERT INTO bookings
            (id, donor_id, items, total_amount, payment_status, payment_mode, booking_date,
             center_id, collected_by, collected_by_center, cheque_bank_account_id, festival_qr,
             razorpay_order_id, razorpay_payment_id, paid_at, remarks, created_at, updated_at)
          VALUES
            (${bookingId}, ${donorId}, ${JSON.stringify(items)}::jsonb, ${amount}, 'paid',
             ${derivePaymentMode(t.transactionType)}, ${bookingDate}, ${centerId || null},
             'migration', ${centerId}, '', FALSE, '', ${razorpayPaymentId},
             ${bookingDate + "T00:00:00.000Z"}, ${remarks}, ${ts}, ${ts})
        `);
        bookingsCreated++;
      } catch (e) {
        bookingsSkipped++;
        if (process.env.DEBUG_MIGRATE) console.error("  booking insert failed:", (e as Error).message);
      }
    }

    if ((i + 1) % 100 === 0) {
      console.log(`  ...processed ${i + 1}/${data.donors.length} donors (${donorsCreated} new, ${donorsSkipped} skipped)`);
    }
  }

  console.log("\nMigration complete:");
  console.log(`  Donors:    ${donorsCreated} created, ${donorsSkipped} skipped (already present)`);
  console.log(`  Txns:      ${txnsCreated} created, ${txnsSkipped} skipped`);
  console.log(`  Bookings:  ${bookingsCreated} created, ${bookingsSkipped} skipped`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
