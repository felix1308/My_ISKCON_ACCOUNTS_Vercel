// ============================================================================
// Bulk import — port of bulkImportDonors / bulkImportTransactions /
// bulkPatchBookingRemarks from Code.gs. Used by the data migration script
// (scripts/migrate-from-json.ts) and the admin bulk import UI.
//
// All writes are parameterized SQL inserts. PAN/email encrypted with AES-GCM.
// ============================================================================

import { sql, sqlOne, sqlTyped } from "../db";
import { encrypt, decrypt } from "../crypto";
import { resolvePrincipal, type Principal } from "../context";
import { getAllowedCenterIdsForUser, isSuperuserRole } from "../permissions";
import { addAuditLog } from "../audit";
import { generateId } from "../ids";
import type { ApiResult } from "../types";

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
function derivePaymentMode(txnType: unknown): string {
  const t = String(txnType ?? "").toLowerCase();
  if (t.includes("razorpay") || t.includes("online")) return "online";
  if (t.includes("cheque") || t.includes("check")) return "cheque";
  if (t.includes("upi")) return "upi";
  if (t.includes("card")) return "card";
  return "cash";
}
function ipFrom(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
}
function isAdminish(p: Principal): boolean {
  return isSuperuserRole(p.role) || p.role === "admin";
}

// ---------------------------------------------------------------------------
// BULK IMPORT DONORS
// ---------------------------------------------------------------------------

export async function bulkImportDonors(params: {
  sessionId?: string;
  donors?: Array<Record<string, unknown>>;
  ipAddress?: string;
}, req: Request): Promise<ApiResult> {
  const principal = await resolvePrincipal(params.sessionId);
  if (!isAdminish(principal)) return { isOk: false, error: "Only superadmin or temple admins can bulk import donors" };
  const donors = params.donors ?? [];
  if (!donors.length) return { isOk: false, error: "donors array is required" };
  const allowed = await getAllowedCenterIdsForUser(principal);

  // Load existing mobile + PAN into a dedup map. PAN is encrypted at rest, so
  // we decrypt for comparison. The donor count is ~3.7k so a single fetch is fine.
  const existing = await sqlTyped<{ id: string; mobile: string; pan: string }>`SELECT id, mobile, pan FROM donors`;
  const existingMobiles = new Set<string>();
  const existingPans = new Set<string>();
  for (const d of existing) {
    const m = normalizeMobile(d.mobile);
    if (m) existingMobiles.add(m);
    if (d.pan) {
      try { const p = decrypt(d.pan).toUpperCase(); if (p) existingPans.add(p); } catch { /* */ }
    }
  }

  const ts = new Date().toISOString();
  let created = 0, skipped = 0;
  const errors: string[] = [];
  const maxErrors = 100;

  for (let i = 0; i < donors.length; i++) {
    const rec = donors[i] ?? {};
    if (!rec.name || (!rec.mobile && !rec.pan)) {
      skipped++;
      if (errors.length < maxErrors) errors.push(`Row ${i + 1}: missing name and mobile/pan`);
      continue;
    }
    let centerId = String(rec.centerId ?? "").trim();
    if (!isSuperuserRole(principal.role)) {
      if (!centerId || !allowed.includes(centerId)) {
        skipped++;
        if (errors.length < maxErrors) errors.push(`Row ${i + 1}: centerId not allowed for your account`);
        continue;
      }
    } else if (!centerId) {
      centerId = "center_bangalore";
    }
    const mob = normalizeMobile(rec.mobile);
    const pan = String(rec.pan ?? "").trim().toUpperCase();
    if (mob && existingMobiles.has(mob)) { skipped++; continue; }
    if (!mob && pan && existingPans.has(pan)) { skipped++; continue; }
    if (mob) existingMobiles.add(mob);
    if (pan) existingPans.add(pan);

    const id = generateId("donor");
    try {
      await sql`
        INSERT INTO donors
          (id, name, spiritual_name, indian_passport, pan, mobile, whatsapp, email,
           flat, road, po, area, pincode, district, state, country, tally_name,
           center_id, password_hash, password_scheme, created_by, created_at, updated_at)
        VALUES
          (${id}, ${String(rec.name).trim()}, ${String(rec.spiritualName ?? "").trim()},
           ${rec.indianPassport === true || rec.indianPassport === "true"},
           ${encrypt(pan)}, ${String(rec.mobile ?? "").trim()},
           ${String(rec.whatsapp ?? "").trim() || String(rec.mobile ?? "").trim()},
           ${encrypt(String(rec.email ?? "").trim())},
           ${String(rec.flat ?? "").trim()}, ${String(rec.road ?? "").trim()},
           ${String(rec.po ?? "").trim()}, ${String(rec.area ?? "").trim()},
           ${String(rec.pincode ?? "").trim()}, ${String(rec.district ?? "").trim()},
           ${String(rec.state ?? "").trim()}, ${String(rec.country ?? "India").trim()},
           ${String(rec.tallyName ?? "").trim()}, ${centerId || null},
           "", 'bcrypt', ${principal.username}, ${ts}, ${ts})
      `;
      created++;
    } catch (e) {
      skipped++;
      if (errors.length < maxErrors) errors.push(`Row ${i + 1}: ${e instanceof Error ? e.message : "insert failed"}`);
    }
  }

  await addAuditLog({ userId: principal.backendId, username: principal.username,
    action: "BULK_IMPORT_DONORS", resourceType: "donor", details: { created, skipped },
    ipAddress: params.ipAddress ?? ipFrom(req) });
  return { isOk: true, created, skipped, errors };
}

// ---------------------------------------------------------------------------
// BULK IMPORT TRANSACTIONS
//   Each txn becomes a booking row (status=paid) with a `voucherNo:` remark
//   for dedup, mirroring the legacy behavior.
// ---------------------------------------------------------------------------

export async function bulkImportTransactions(params: {
  sessionId?: string;
  transactions?: Array<Record<string, unknown>>;
  ipAddress?: string;
}, req: Request): Promise<ApiResult> {
  const principal = await resolvePrincipal(params.sessionId);
  if (!isAdminish(principal)) return { isOk: false, error: "Only superadmin or temple admins can bulk import transactions" };
  const txns = params.transactions ?? [];
  if (!txns.length) return { isOk: false, error: "transactions array is required" };
  const allowed = await getAllowedCenterIdsForUser(principal);

  // Donor lookup by mobile (plaintext) and PAN (decrypt for compare).
  const allDonors = await sqlTyped<{ id: string; mobile: string; pan: string; center_id: string | null }>`
    SELECT id, mobile, pan, center_id FROM donors
  `;
  const donorByMobile = new Map<string, typeof allDonors[number]>();
  const donorByPan = new Map<string, typeof allDonors[number]>();
  for (const d of allDonors) {
    const m = normalizeMobile(d.mobile);
    if (m) donorByMobile.set(m, d);
    if (d.pan) {
      try { const p = decrypt(d.pan).toUpperCase(); if (p) donorByPan.set(p, d); } catch { /* */ }
    }
  }

  // Dedup from existing bookings' remarks (voucherNo:... prefix).
  const existing = await sqlTyped<{ remarks: string; donor_id: string }>`SELECT remarks, donor_id FROM bookings WHERE remarks LIKE 'voucherNo:%'`;
  const existingKeys = new Set<string>();
  for (const b of existing) {
    const m = String(b.remarks).match(/^voucherNo:([^\s|]+)/);
    if (m) existingKeys.add(`${m[1]}|${b.donor_id}`);
  }

  const ts = new Date().toISOString();
  let created = 0, skipped = 0;
  const errors: string[] = [];
  const maxErrors = 100;

  for (let i = 0; i < txns.length; i++) {
    const txn = txns[i] ?? {};
    const voucherNo = String(txn.voucherNo ?? "").trim();
    if (!voucherNo) {
      skipped++;
      if (errors.length < maxErrors) errors.push(`Row ${i + 1}: missing voucherNo`);
      continue;
    }
    let donor: typeof allDonors[number] | undefined;
    const mob = normalizeMobile(txn.donorMobile);
    if (mob) donor = donorByMobile.get(mob);
    if (!donor && txn.donorPan) {
      const pan = String(txn.donorPan).trim().toUpperCase();
      if (pan) donor = donorByPan.get(pan);
    }
    if (!donor) {
      skipped++;
      if (errors.length < maxErrors) errors.push(`Row ${i + 1} voucherNo=${voucherNo}: donor not found`);
      continue;
    }
    const dedupeKey = `${voucherNo}|${donor.id}`;
    if (existingKeys.has(dedupeKey)) { skipped++; continue; }
    existingKeys.add(dedupeKey);

    const branchRaw = String(txn.branch ?? "").trim().toUpperCase().split(/[\s\-_\/|,]+/)[0];
    let centerId = IMPORT_BRANCH_MAP[branchRaw] || donor.center_id || "center_bangalore";
    if (!isSuperuserRole(principal.role) && !allowed.includes(centerId)) {
      centerId = donor.center_id || allowed[0] || "center_bangalore";
    }
    const paymentMode = derivePaymentMode(txn.transactionType);
    const sevaName = String(txn.tallyLedger ?? "Donation").trim();
    const amount = Number(parseFloat(String(txn.amount ?? 0)) || 0);
    const rawDate = String(txn.date ?? "").trim();
    const bookingDate = isValidDate(rawDate) ? rawDate : ts.split("T")[0];
    const txnDetails = String(txn.transactionDetails ?? "").trim();
    const razorpayPaymentId = txnDetails.startsWith("pay_") ? txnDetails : "";
    const tenBeUrl = String(txn.tenBeUrl ?? "").trim();
    const remarks = `voucherNo:${voucherNo}${txn.bank ? ` | bank:${txn.bank}` : ""}${tenBeUrl ? ` | 10beUrl:${tenBeUrl}` : ""}`;
    const items = [{ sevaId: "imported", name: sevaName, description: String(txn.status80G ?? "").trim(), amount, quantity: 1, bookingDate }];
    const id = generateId("bk");

    try {
      await sql`
        INSERT INTO bookings
          (id, donor_id, items, total_amount, payment_status, payment_mode, booking_date,
           center_id, collected_by, collected_by_center, cheque_bank_account_id, festival_qr,
           razorpay_order_id, razorpay_payment_id, paid_at, remarks, created_at, updated_at)
        VALUES
          (${id}, ${donor.id}, ${JSON.stringify(items)}::jsonb, ${amount}, 'paid', ${paymentMode},
           ${bookingDate}, ${centerId || null}, 'import', ${centerId}, '', FALSE,
           '', ${razorpayPaymentId}, ${bookingDate + "T00:00:00.000Z"}, ${remarks}, ${ts}, ${ts})
      `;
      created++;
    } catch (e) {
      skipped++;
      if (errors.length < maxErrors) errors.push(`Row ${i + 1}: ${e instanceof Error ? e.message : "insert failed"}`);
    }
  }

  await addAuditLog({ userId: principal.backendId, username: principal.username,
    action: "BULK_IMPORT_TRANSACTIONS", resourceType: "booking",
    details: { created, skipped }, ipAddress: params.ipAddress ?? ipFrom(req) });
  return { isOk: true, created, skipped, errors };
}

// ---------------------------------------------------------------------------
// BULK PATCH BOOKING REMARKS (add 10BE URLs to existing bookings)
// ---------------------------------------------------------------------------

export async function bulkPatchBookingRemarks(params: {
  sessionId?: string;
  patches?: Array<{ id: string; remarks: string }>;
  ipAddress?: string;
}, req: Request): Promise<ApiResult> {
  const principal = await resolvePrincipal(params.sessionId);
  if (!isAdminish(principal)) return { isOk: false, error: "Only admins can patch booking remarks" };
  const patches = params.patches ?? [];
  if (!patches.length) return { isOk: false, error: "patches array is required" };
  let updated = 0;
  for (const p of patches) {
    if (!p.id || !p.remarks) continue;
    const res = await sql`UPDATE bookings SET remarks = ${p.remarks}, updated_at = now() WHERE id = ${p.id}`;
    if ((res as unknown as { count: number }).count > 0) updated++;
  }
  await addAuditLog({ userId: principal.backendId, username: principal.username,
    action: "BULK_PATCH_REMARKS", resourceType: "booking",
    details: { updated }, ipAddress: params.ipAddress ?? ipFrom(req) });
  return { isOk: true, updated };
}

// re-export for dispatcher
export { sqlOne };
