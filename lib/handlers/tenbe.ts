// ============================================================================
// 10BE lookup handler — port of find10BEUrl() from myiskcon.html.
// Queries the ten_be_records table (imported from the legacy ten_be_*_map.js
// data files) with the same 5-level fallback matching:
//   1. PAN + VoucherNo + Amount + Date   (first hit)
//   2. PAN + VoucherNo + Amount          (first hit)
//   3. VoucherNo + Amount + Date         (only if exactly 1 hit)
//   4. VoucherNo + Amount                (only if exactly 1 hit)
//   5. PAN + VoucherNo                   (only if exactly 1 hit)
//
// Normalisation (matches legacy):
//   PAN:      uppercase, trimmed
//   Voucher:  lowercase, trimmed (compared case-insensitively)
//   Amount:   rounded to paise
//   Date:     normalised to YYYY-MM-DD (accepts DD-MM-YYYY / DD/MM/YYYY)
//
// Register in app/api/[...action]/route.ts as:
//   lookup10BeUrl: (p, req) => lookup10BeUrl(p, req),
// ============================================================================

import { sqlTyped } from "../db";
import { resolvePrincipal } from "../context";
import { isSuperuserRole } from "../permissions";
import { ForbiddenError } from "../errors";
import type { ApiResult } from "../types";

function normPan(p: unknown): string {
  return String(p ?? "").trim().toUpperCase();
}
function normVoucher(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}
/** Amount in paise, or null when not a usable number. */
function normAmountPaise(a: unknown): number | null {
  if (a === null || a === undefined || a === "") return null;
  const n = parseFloat(String(a));
  if (!isFinite(n)) return null;
  return Math.round(n * 100);
}
/** Normalise a date string to YYYY-MM-DD (matches legacy normDate). */
function normDate(d: unknown): string | null {
  const s = String(d ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m1 = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
  return s;
}

interface TenBeRow { url: string }

export async function lookup10BeUrl(params: {
  sessionId?: string;
  pan?: string;
  voucherNo?: string;
  amount?: number | string;
  date?: string;
}, req: Request): Promise<ApiResult> {
  void req;
  const principal = await resolvePrincipal(params.sessionId);
  // Same gate as the Acknowledgement / 10BE buttons in reports.
  if (!isSuperuserRole(principal.role) && principal.permissions?.receipts !== true) {
    throw new ForbiddenError("You do not have permission to download 10BE receipts");
  }

  const pan = normPan(params.pan);
  const voucher = normVoucher(params.voucherNo);
  const amountPaise = normAmountPaise(params.amount);
  const date = normDate(params.date);

  if (!pan && !voucher) {
    return { isOk: false, error: "not found" };
  }

  // Level 1: PAN + VoucherNo + Amount + Date
  if (pan && voucher && amountPaise !== null && date) {
    const rows = await sqlTyped<TenBeRow>`
      SELECT url FROM ten_be_records
      WHERE upper(trim(pan)) = ${pan}
        AND lower(trim(voucher_no)) = ${voucher}
        AND round(amount * 100) = ${amountPaise}
        AND txn_date = ${date}
      ORDER BY id LIMIT 1
    `;
    if (rows.length >= 1 && rows[0].url) return { isOk: true, url: rows[0].url, matchLevel: 1 };
  }

  // Level 2: PAN + VoucherNo + Amount
  if (pan && voucher && amountPaise !== null) {
    const rows = await sqlTyped<TenBeRow>`
      SELECT url FROM ten_be_records
      WHERE upper(trim(pan)) = ${pan}
        AND lower(trim(voucher_no)) = ${voucher}
        AND round(amount * 100) = ${amountPaise}
      ORDER BY id LIMIT 1
    `;
    if (rows.length >= 1 && rows[0].url) return { isOk: true, url: rows[0].url, matchLevel: 2 };
  }

  // Level 3: VoucherNo + Amount + Date (PAN may differ between app and Excel)
  if (voucher && amountPaise !== null && date) {
    const rows = await sqlTyped<TenBeRow>`
      SELECT url FROM ten_be_records
      WHERE lower(trim(voucher_no)) = ${voucher}
        AND round(amount * 100) = ${amountPaise}
        AND txn_date = ${date}
      ORDER BY id LIMIT 2
    `;
    if (rows.length === 1 && rows[0].url) return { isOk: true, url: rows[0].url, matchLevel: 3 };
  }

  // Level 4: VoucherNo + Amount
  if (voucher && amountPaise !== null) {
    const rows = await sqlTyped<TenBeRow>`
      SELECT url FROM ten_be_records
      WHERE lower(trim(voucher_no)) = ${voucher}
        AND round(amount * 100) = ${amountPaise}
      ORDER BY id LIMIT 2
    `;
    if (rows.length === 1 && rows[0].url) return { isOk: true, url: rows[0].url, matchLevel: 4 };
  }

  // Level 5: PAN + VoucherNo (original fallback)
  if (pan && voucher) {
    const rows = await sqlTyped<TenBeRow>`
      SELECT url FROM ten_be_records
      WHERE upper(trim(pan)) = ${pan}
        AND lower(trim(voucher_no)) = ${voucher}
      ORDER BY id LIMIT 2
    `;
    if (rows.length === 1 && rows[0].url) return { isOk: true, url: rows[0].url, matchLevel: 5 };
  }

  return { isOk: false, error: "not found" };
}
