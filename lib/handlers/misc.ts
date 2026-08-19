// ============================================================================
// Misc handlers — validateQR / flushSevas / toggleSuperadminAccess /
// initializeDatabase. Ported from Code.gs.
// ============================================================================

import { sql, sqlOne } from "../db";
import { getEnv } from "../env";
import { resolvePrincipal, type Principal } from "../context";
import { setConfigFlag } from "../context";
import { addAuditLog } from "../audit";
import { hashPassword } from "../password";
import { ForbiddenError } from "../errors";
import { generateId } from "../ids";
import { isSuperuserRole } from "../permissions";
import type { ApiResult } from "../types";

function ipFrom(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// VALIDATE QR  (superadmin / developer / scanner roles)
// ---------------------------------------------------------------------------

export async function validateQR(params: {
  sessionId?: string;
  payload?: string;
}, req: Request): Promise<ApiResult> {
  const principal = await resolvePrincipal(params.sessionId);
  // Scanner roles aren't first-class in the new schema yet — restrict to
  // superuser for now. Volunteers with booking permission can be added later.
  if (!isSuperuserRole(principal.role)) {
    throw new ForbiddenError("Only superadmin/developer can validate QR codes");
  }
  const payload = String(params.payload ?? "").trim();
  if (!payload) return { isOk: false, error: "Invalid payload" };
  const parts = payload.split("|");
  if (parts.length !== 3) return { isOk: false, error: "Invalid QR format. Expected: bookingId|itemIndex|type" };
  const bookingId = parts[0].trim();
  const itemIndex = parts[1].trim();
  let type = parts[2].trim().toLowerCase();
  if (type === "entry") type = "darshan";
  if (!["darshan", "seva", "prasadam"].includes(type)) {
    return { isOk: false, error: "Invalid type. Must be entry, seva or prasadam" };
  }

  const booking = await sqlOne<{ payment_status: string }>`SELECT payment_status FROM bookings WHERE id = ${bookingId} LIMIT 1`;
  if (!booking) return { isOk: false, error: "Booking not found" };
  if (String(booking.payment_status).toLowerCase() !== "paid") {
    return { isOk: false, error: "Booking is not paid" };
  }

  const already = await sqlOne<{ scanned_at: string; scanned_by: string }>`
    SELECT scanned_at, scanned_by FROM qr_scans
    WHERE booking_id = ${bookingId} AND item_index = ${Number(itemIndex) || 0}
      AND type = ${type} LIMIT 1
  `;
  if (already) {
    return { isOk: false, error: "QR already used", scannedAt: already.scanned_at, scannedBy: already.scanned_by };
  }

  const id = generateId("scan");
  await sql`
    INSERT INTO qr_scans (id, booking_id, item_index, type, scanned_at, scanned_by)
    VALUES (${id}, ${bookingId}, ${Number(itemIndex) || 0}, ${type}, now(), ${principal.username})
  `;
  await addAuditLog({ userId: principal.backendId, username: principal.username,
    action: "QR_VALIDATED", resourceType: "booking", resourceId: bookingId,
    details: { type, itemIndex }, ipAddress: ipFrom(req) });
  return { isOk: true, message: "Valid", type, bookingId, scannedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// FLUSH SEVAS (superadmin / developer only)
// ---------------------------------------------------------------------------

export async function flushSevas(params: { sessionId?: string }, req: Request): Promise<ApiResult> {
  const principal = await resolvePrincipal(params.sessionId);
  if (!isSuperuserRole(principal.role)) throw new ForbiddenError("Only superadmin or developer can flush sevas");
  await sql`DELETE FROM sevas`;
  await addAuditLog({ userId: principal.backendId, username: principal.username,
    action: "FLUSH_SEVAS", resourceType: "seva", details: "All sevas cleared",
    ipAddress: ipFrom(req) });
  return { isOk: true, message: "All sevas cleared. New sevas you add will be stored in the sevas table." };
}

// ---------------------------------------------------------------------------
// TOGGLE SUPERADMIN ACCESS (developer only)
// ---------------------------------------------------------------------------

export async function toggleSuperadminAccess(params: {
  sessionId?: string;
  detain?: boolean | string;
}, req: Request): Promise<ApiResult> {
  const principal = await resolvePrincipal(params.sessionId);
  if (principal.role !== "developer") throw new ForbiddenError("Only the developer can control superadmin access");
  const detained = params.detain === true || params.detain === "true";
  await setConfigFlag("SUPERADMIN_DETAINED", detained);
  const env = getEnv();
  await addAuditLog({ userId: "developer-001", username: env.DEVELOPER_USERNAME,
    action: detained ? "SUPERADMIN_DETAINED" : "SUPERADMIN_RELEASED",
    resourceType: "user", resourceId: "superadmin-001",
    details: detained ? "Superadmin access detained by developer" : "Superadmin access restored by developer",
    ipAddress: ipFrom(req) });
  return { isOk: true, detained, message: detained ? "Superadmin access has been detained." : "Superadmin access has been restored." };
}

// ---------------------------------------------------------------------------
// INITIALIZE DATABASE — seeds default centers/sevas if empty, and bootstraps
// the superadmin + developer password hashes from env if not set.
// Intended to be called once after `npm run db:push`.
// ---------------------------------------------------------------------------

export async function initializeDatabase(params: {
  sessionId?: string;
  superadminPassword?: string;
  developerPassword?: string;
} = {}): Promise<ApiResult> {
  // Allow unauthenticated bootstrap (one-time setup), but require an explicit
  // password payload so this can't be triggered by a stray request.
  if (params.sessionId) {
    try { await resolvePrincipal(params.sessionId); } catch { /* allow */ }
  }

  const env = getEnv();
  const seeded: string[] = [];

  // Seed default centers if none exist.
  const centerCount = await sqlOne<{ cnt: string }>`SELECT COUNT(*)::text AS cnt FROM centers`;
  if (Number(centerCount?.cnt ?? 0) === 0) {
    const defaults = [
      ["center_bangalore", "ISKCON Bangalore", "Bangalore", "Karnataka"],
      ["center_iyf", "ISKCON Yatrayatra Force (IYF)", "Bangalore", "Karnataka"],
      ["center_kalaburgi", "ISKCON Kalaburgi", "Kalaburgi", "Karnataka"],
      ["center_rajarajeshwari_nagar", "ISKCON Rajarajeshwari Nagar", "Bangalore", "Karnataka"],
      ["center_begur", "ISKCON Begur", "Bangalore", "Karnataka"],
      ["center_tumkur", "ISKCON Tumkur", "Tumkur", "Karnataka"],
    ] as const;
    const ts = new Date().toISOString();
    for (const [id, name, city, state] of defaults) {
      await sql`INSERT INTO centers (id, name, city, state, is_active, created_at, updated_at) VALUES (${id}, ${name}, ${city}, ${state}, TRUE, ${ts}, ${ts}) ON CONFLICT (id) DO NOTHING`;
    }
    seeded.push("default centers");
  }

  // Bootstrap superadmin / developer password hashes.
  const superadminHash = await sqlOne<{ value: string }>`SELECT value FROM app_config WHERE key = 'SUPERADMIN_HASH'`;
  if (!superadminHash?.value && params.superadminPassword) {
    const fresh = await hashPassword(params.superadminPassword);
    await sql`INSERT INTO app_config (key, value, updated_at) VALUES ('SUPERADMIN_HASH', ${fresh}, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    seeded.push("superadmin password");
  }
  const developerHash = await sqlOne<{ value: string }>`SELECT value FROM app_config WHERE key = 'DEVELOPER_HASH'`;
  if (!developerHash?.value && params.developerPassword) {
    const fresh = await hashPassword(params.developerPassword);
    await sql`INSERT INTO app_config (key, value, updated_at) VALUES ('DEVELOPER_HASH', ${fresh}, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    seeded.push("developer password");
  }

  return { isOk: true, message: "Database initialized", seeded };
}
