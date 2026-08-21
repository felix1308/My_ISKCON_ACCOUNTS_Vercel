// ============================================================================
// CRUD — port of handleCreate / handleUpdate / handleDelete from Code.gs.
//
// All writes use parameterized SQL — user input is NEVER concatenated.
// Donor PAN/email are encrypted with AES-256-GCM before storage.
// Payment gateway secrets are encrypted with AES-256-GCM before storage.
// Permission checks happen per-type via lib/permissions.ts.
// ============================================================================

import { sql, sqlOne } from "../db";
import { addAuditLog } from "../audit";
import { resolvePrincipal, type Principal } from "../context";
import {
  checkPermission,
  requirePermission,
  getAllowedCenterIdsForUser,
  isSuperuserRole,
  type ResourceType,
} from "../permissions";
import { encrypt, decrypt } from "../crypto";
import { hashPassword, detectScheme, verifyPassword } from "../password";
import { generateId, generateSevaId, generateCenterId, generateTempleId } from "../ids";
import { ForbiddenError, NotFoundError } from "../errors";
import type { ApiResult, Permissions } from "../types";

const now = () => new Date().toISOString();
const bool = (v: unknown) => v === true || v === "true";
const str = (v: unknown, dflt = "") => (v == null ? dflt : String(v).trim());
/** Convert "all_centers" to "" so FK constraints on center_id (→ centers.id) don't break. */
const fkCenter = (v: string) => (v === "all_centers" ? "" : v);
const num = (v: unknown, dflt = 0) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : dflt;
};
function permParse(v: unknown): Permissions {
  if (v && typeof v === "object") return v as Permissions;
  if (typeof v === "string") { try { return JSON.parse(v) || {}; } catch { return {}; } }
  return {};
}
function cashbooksParse(v: unknown): string[] | "*" {
  if (v === "*") return "*";
  if (Array.isArray(v)) return v as string[];
  if (typeof v === "string") {
    if (v.trim() === "*") return "*";
    try { const o = JSON.parse(v); if (Array.isArray(o)) return o; } catch { /* */ }
    if (v.trim()) return v.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

interface RecordPayload {
  type: string;
  __backendId?: string;
  [k: string]: unknown;
}

function ipFrom(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

export async function handleCreate(params: {
  sessionId?: string;
  record?: RecordPayload;
  ipAddress?: string;
}, req: Request): Promise<ApiResult> {
  const principal = await resolvePrincipal(params.sessionId);
  const ip = params.ipAddress ?? ipFrom(req);
  const record = params.record;
  if (!record || !record.type) return { isOk: false, error: "Record type is required" };
  const type = record.type;
  const recordCenterId = str(record.centerId);
  await requirePermission(principal, type as ResourceType, "create", recordCenterId || undefined);

  const id = generateId();
  const ts = now();
  let newRecord: Record<string, unknown> = { type, __backendId: id, createdAt: ts };

  switch (type) {
    case "user": {
      if (!record.username || !record.password)
        return { isOk: false, error: "Username and password are required" };
      const role = str(record.role, "volunteer");
      const isAdmin = role.toLowerCase() === "admin";
      const templeId = str(record.templeId);
      const centerId = str(record.centerId);
      const dup = await sqlOne<{ id: string }>`
        SELECT id FROM users WHERE username = ${record.username}
        AND ${isAdmin ? sql`temple_id` : sql`center_id`} = ${isAdmin ? templeId || null : centerId || null}
        LIMIT 1
      `;
      if (dup) return { isOk: false, error: `Username already exists in this ${isAdmin ? "temple" : "center"}` };
      const perms = record.permissions ?? {};
      const cashbooks = record.cashbooks ?? "";
      await sql`
        INSERT INTO users (id, username, password_hash, password_scheme, role, center_id,
                           temple_id, department_id, permissions, cashbooks, created_by,
                           created_at, updated_at, is_active)
        VALUES (${id}, ${str(record.username)}, ${await hashPassword(String(record.password))},
                'bcrypt', ${role}, ${isAdmin ? null : centerId || null},
                ${templeId || null}, ${str(record.departmentId) || null},
                ${JSON.stringify(perms)}::jsonb,
                ${Array.isArray(cashbooks) ? JSON.stringify(cashbooks) : cashbooks}::jsonb,
                ${principal.username}, ${ts}, ${ts}, TRUE)
      `;
      newRecord = {
        type, __backendId: id, username: record.username, role,
        centerId: isAdmin ? "" : centerId, templeId: isAdmin ? templeId : templeId,
        departmentId: str(record.departmentId), permissions: perms, cashbooks,
        createdBy: principal.username, createdAt: ts,
      };
      break;
    }

    case "donor": {
      if (!record.name || !record.mobile)
        return { isOk: false, error: "Name and mobile are required" };
      const centerId = fkCenter(str(record.centerId) || principal.centerId || "");
      await sql`
        INSERT INTO donors
          (id, name, spiritual_name, indian_passport, pan, mobile, whatsapp, email,
           flat, road, po, area, pincode, district, state, country, tally_name,
           center_id, password_hash, password_scheme, created_by, created_at, updated_at)
        VALUES
          (${id}, ${str(record.name)}, ${str(record.spiritualName)},
           ${bool(record.indianPassport)},
           ${encrypt(str(record.pan).toUpperCase())},
           ${str(record.mobile)}, ${str(record.whatsapp) || str(record.mobile)},
           ${encrypt(str(record.email))},
           ${str(record.flat)}, ${str(record.road)}, ${str(record.po)}, ${str(record.area)},
           ${str(record.pincode)}, ${str(record.district)}, ${str(record.state)},
           ${str(record.country, "India")}, ${str(record.tallyName)},
           ${centerId || null}, "", 'bcrypt', ${principal.username}, ${ts}, ${ts})
      `;
      newRecord = {
        type, __backendId: id, ...stripType(record),
        tallyName: str(record.tallyName),
        createdBy: principal.username, createdAt: ts,
      };
      break;
    }

    case "booking": {
      if (!record.donorId) return { isOk: false, error: "Donor ID is required" };
      const centerId = fkCenter(str(record.centerId) || principal.centerId || "");
      const festivalQR = bool(record.festivalQR);
      const items = record.items ?? [];
      const paymentStatus = str(record.paymentStatus, "pending");
      await sql`
        INSERT INTO bookings
          (id, donor_id, items, total_amount, payment_status, payment_mode, booking_date,
           center_id, collected_by, collected_by_center, cheque_bank_account_id,
           festival_qr, razorpay_order_id, razorpay_payment_id, paid_at, remarks,
           created_at, updated_at)
        VALUES
          (${id}, ${record.donorId}, ${JSON.stringify(items)}::jsonb,
           ${num(record.totalAmount)}, ${paymentStatus}, ${str(record.paymentMode, "online")},
           ${str(record.bookingDate, ts)}, ${centerId || null},
           ${str(record.collectedBy, principal.username)},
           ${fkCenter(str(record.collectedByCenter, principal.centerId))},
           ${str(record.chequeBankAccountId)}, ${festivalQR},
           ${str(record.razorpayOrderId)}, ${str(record.razorpayPaymentId)},
           ${str(record.paidAt)}, ${str(record.remarks)}, ${ts}, ${ts})
      `;
      newRecord = {
        type, __backendId: id, donorId: record.donorId, items,
        totalAmount: num(record.totalAmount), paymentStatus, paymentMode: str(record.paymentMode, "online"),
        bookingDate: str(record.bookingDate, ts), centerId, collectedBy: str(record.collectedBy, principal.username),
        collectedByCenter: str(record.collectedByCenter, principal.centerId),
        chequeBankAccountId: str(record.chequeBankAccountId), festivalQR,
        razorpayOrderId: "", razorpayPaymentId: "", paidAt: str(record.paidAt), remarks: str(record.remarks),
        createdAt: ts,
      };
      break;
    }

    case "seva": {
      const sevaId = str(record.id) || generateSevaId();
      const centerId = fkCenter(
        isSuperuserRole(principal.role)
          ? (str(record.centerId) || "all_centers")
          : (principal.centerId || "")
      );
      await sql`
        INSERT INTO sevas
          (id, name, description, amount, center_id, is_active, darshan_qr, seva_qr,
           prasadam_qr, notify_whatsapp, created_at, updated_at)
        VALUES
          (${sevaId}, ${str(record.name)}, ${str(record.description)},
           ${num(record.amount)}, ${centerId || null}, TRUE,
           ${str(record.darshanQR)}, ${str(record.sevaQR)}, ${str(record.prasadamQR)},
           ${bool(record.notifyWhatsapp)}, ${ts}, ${ts})
      `;
      newRecord = {
        type, __backendId: sevaId, id: sevaId, name: record.name,
        description: str(record.description), amount: num(record.amount),
        centerId, darshanQR: str(record.darshanQR), sevaQR: str(record.sevaQR),
        prasadamQR: str(record.prasadamQR), notifyWhatsapp: bool(record.notifyWhatsapp),
        createdAt: ts,
      };
      break;
    }

    case "center": {
      const centerId = str(record.id) || generateCenterId(str(record.name));
      await sql`
        INSERT INTO centers (id, name, city, state, is_active, temple_id, created_at, updated_at)
        VALUES (${centerId}, ${str(record.name)}, ${str(record.city)}, ${str(record.state)},
                TRUE, ${str(record.templeId) || null}, ${ts}, ${ts})
      `;
      newRecord = { type, __backendId: centerId, id: centerId, name: record.name,
        city: str(record.city), state: str(record.state), templeId: str(record.templeId), createdAt: ts };
      break;
    }

    case "temple": {
      const templeId = str(record.id) || generateTempleId(str(record.name));
      await sql`
        INSERT INTO temples (id, name, city, state, is_active, created_at, updated_at)
        VALUES (${templeId}, ${str(record.name)}, ${str(record.city)}, ${str(record.state)}, TRUE, ${ts}, ${ts})
      `;
      newRecord = { type, __backendId: templeId, id: templeId, name: str(record.name),
        city: str(record.city), state: str(record.state), createdAt: ts };
      break;
    }

    case "department": {
      const deptId = str(record.id) || `dept_${Date.now()}`;
      await sql`
        INSERT INTO departments (id, name, type, center_id, temple_id, description, is_active, created_at, updated_at)
        VALUES (${deptId}, ${str(record.name)}, ${str(record.type)},
                ${str(record.centerId) || null}, ${str(record.templeId) || null},
                ${str(record.description)}, TRUE, ${ts}, ${ts})
      `;
      newRecord = { type, __backendId: deptId, id: deptId, name: str(record.name),
        deptType: str(record.type), centerId: str(record.centerId), templeId: str(record.templeId),
        description: str(record.description), isActive: true, createdAt: ts };
      break;
    }

    case "department_head":
    case "departmentHead": {
      const hid = str(record.id) || generateId("head");
      await sql`
        INSERT INTO department_heads (id, name, role, phone, temple_id, center_id, is_active, created_at, updated_at)
        VALUES (${hid}, ${str(record.name)}, ${str(record.role)}, ${str(record.phone)},
                ${str(record.templeId, principal.templeId ?? "") || null},
                ${str(record.centerId, principal.centerId) || null}, TRUE, ${ts}, ${ts})
      `;
      newRecord = { type: "departmentHead", __backendId: hid, id: hid, name: str(record.name),
        role: str(record.role), phone: str(record.phone), templeId: str(record.templeId, principal.templeId ?? ""),
        centerId: str(record.centerId, principal.centerId), isActive: true, createdAt: ts };
      break;
    }

    case "bank_account":
    case "bankAccount": {
      const bankId = str(record.id) || `bank_${Date.now()}`;
      const centerId = fkCenter(
        isSuperuserRole(principal.role)
          ? (str(record.centerId) || "all_centers")
          : (str(record.centerId) || principal.centerId)
      );
      await sql`
        INSERT INTO bank_accounts (id, name, account_number, bank_name, center_id,
                                   payment_gateway_id, is_active, created_at, updated_at)
        VALUES (${bankId}, ${str(record.name)}, ${str(record.accountNumber)}, ${str(record.bankName)},
                ${centerId || null}, ${str(record.paymentGatewayId) || null},
                ${record.isActive !== false ? true : false}, ${ts}, ${ts})
      `;
      newRecord = { type: "bankAccount", __backendId: bankId, id: bankId, name: str(record.name),
        accountNumber: str(record.accountNumber), bankName: str(record.bankName), centerId,
        paymentGatewayId: str(record.paymentGatewayId), isActive: record.isActive !== false, createdAt: ts };
      break;
    }

    case "payment_gateway":
    case "paymentGateway": {
      if (!record.name || !record.razorpayKeyId || !record.razorpayKeySecret)
        return { isOk: false, error: "Name, Razorpay Key ID and Key Secret are required" };
      const pgId = str(record.id) || `pg_${Date.now()}`;
      const secretEnc = encrypt(str(record.razorpayKeySecret));
      await sql`
        INSERT INTO payment_gateways (id, name, razorpay_key_id, razorpay_key_secret_enc, is_active, created_at, updated_at)
        VALUES (${pgId}, ${str(record.name)}, ${str(record.razorpayKeyId)}, ${secretEnc},
                ${record.isActive !== false ? true : false}, ${ts}, ${ts})
      `;
      newRecord = { type: "paymentGateway", __backendId: pgId, id: pgId, name: str(record.name),
        razorpayKeyId: str(record.razorpayKeyId), isActive: record.isActive !== false, createdAt: ts };
      break;
    }

    default:
      return { isOk: false, error: `Unknown record type: ${type}` };
  }

  await addAuditLog({ userId: principal.backendId, username: principal.username,
    action: "CREATE", resourceType: type, resourceId: String(id),
    details: maskRecord(record), ipAddress: ip });
  return { isOk: true, data: newRecord };
}

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

export async function handleUpdate(params: {
  sessionId?: string;
  record?: RecordPayload;
  ipAddress?: string;
}, req: Request): Promise<ApiResult> {
  const principal = await resolvePrincipal(params.sessionId);
  const ip = params.ipAddress ?? ipFrom(req);
  const record = params.record;
  if (!record || !record.type) return { isOk: false, error: "Record type is required" };
  const type = record.type;
  const id = record.__backendId;
  if (!id) return { isOk: false, error: "Record ID is required for update" };

  const isDonorSelfUpdate =
    principal.role === "donor" && type === "donor" && id === principal.donorId;

  // For non-self updates, check permissions and center scoping.
  if (!isDonorSelfUpdate) {
    await requirePermission(principal, type as ResourceType, "update", str(record.centerId) || undefined);
  }

  // Sevas: non-superuser must own the seva's center.
  if (type === "seva" && !isSuperuserRole(principal.role)) {
    const existing = await sqlOne<{ center_id: string | null }>`SELECT center_id FROM sevas WHERE id = ${id}`;
    if (!existing) return { isOk: false, error: "Seva not found" };
    const allowed = await getAllowedCenterIdsForUser(principal);
    if (existing.center_id && !allowed.includes(existing.center_id)) {
      throw new ForbiddenError("You can only edit sevas in your center(s)");
    }
  }

  const ts = now();
  let updated: Record<string, unknown> = { type, __backendId: id, updatedAt: ts };

  switch (type) {
    case "user": {
      const role = str(record.role);
      const isAdmin = role.toLowerCase() === "admin";
      const perms = record.permissions ?? {};
      const cashbooks = record.cashbooks ?? "";
      // Optional password reset during update.
      const passwordHash = record.password ? await hashPassword(String(record.password)) : null;
      await sql`
        UPDATE users SET
          username = COALESCE(${str(record.username) || null}, username),
          password_hash = COALESCE(${passwordHash}, password_hash),
          password_scheme = CASE WHEN ${passwordHash !== null} THEN 'bcrypt' ELSE password_scheme END,
          role = COALESCE(${role || null}, role),
          center_id = ${isAdmin ? null : (str(record.centerId) || null)},
          temple_id = ${str(record.templeId) || null},
          department_id = ${str(record.departmentId) || null},
          permissions = ${JSON.stringify(perms)}::jsonb,
          cashbooks = ${Array.isArray(cashbooks) ? JSON.stringify(cashbooks) : String(cashbooks)}::jsonb,
          is_active = ${record.isActive !== false},
          updated_at = ${ts}
        WHERE id = ${id}
      `;
      updated = { type, __backendId: id, ...stripType(record), updatedAt: ts };
      break;
    }

    case "donor": {
      // Donors cannot change their PAN or center via update.
      const panEnc = isDonorSelfUpdate ? null : (record.pan != null ? encrypt(str(record.pan).toUpperCase()) : null);
      const centerId = isDonorSelfUpdate ? null : (str(record.centerId) || null);
      const emailEnc = record.email != null ? encrypt(str(record.email)) : null;
      await sql`
        UPDATE donors SET
          name = COALESCE(${str(record.name) || null}, name),
          spiritual_name = COALESCE(${str(record.spiritualName) || null}, spiritual_name),
          indian_passport = COALESCE(${record.indianPassport == null ? null : bool(record.indianPassport)}, indian_passport),
          pan = COALESCE(${panEnc}, pan),
          mobile = COALESCE(${str(record.mobile) || null}, mobile),
          whatsapp = COALESCE(${str(record.whatsapp) || null}, whatsapp),
          email = COALESCE(${emailEnc}, email),
          flat = COALESCE(${str(record.flat) || null}, flat),
          road = COALESCE(${str(record.road) || null}, road),
          po = COALESCE(${str(record.po) || null}, po),
          area = COALESCE(${str(record.area) || null}, area),
          pincode = COALESCE(${str(record.pincode) || null}, pincode),
          district = COALESCE(${str(record.district) || null}, district),
          state = COALESCE(${str(record.state) || null}, state),
          country = COALESCE(${str(record.country) || null}, country),
          tally_name = COALESCE(${str(record.tallyName) || null}, tally_name),
          center_id = COALESCE(${centerId}, center_id),
          updated_at = ${ts}
        WHERE id = ${id}
      `;
      updated = { type, __backendId: id, ...stripType(record), updatedAt: ts };
      break;
    }

    case "booking": {
      const items = record.items ?? null;
      await sql`
        UPDATE bookings SET
          donor_id = COALESCE(${record.donorId || null}, donor_id),
          items = COALESCE(${items == null ? null : JSON.stringify(items)}::jsonb, items),
          total_amount = COALESCE(${record.totalAmount == null ? null : num(record.totalAmount)}, total_amount),
          payment_status = COALESCE(${str(record.paymentStatus) || null}, payment_status),
          payment_mode = COALESCE(${str(record.paymentMode) || null}, payment_mode),
          booking_date = COALESCE(${str(record.bookingDate) || null}, booking_date),
          center_id = COALESCE(${fkCenter(str(record.centerId)) || null}, center_id),
          collected_by = COALESCE(${str(record.collectedBy) || null}, collected_by),
          collected_by_center = COALESCE(${fkCenter(str(record.collectedByCenter)) || null}, collected_by_center),
          cheque_bank_account_id = COALESCE(${str(record.chequeBankAccountId) || null}, cheque_bank_account_id),
          festival_qr = COALESCE(${record.festivalQR == null ? null : bool(record.festivalQR)}, festival_qr),
          razorpay_order_id = COALESCE(${str(record.razorpayOrderId) || null}, razorpay_order_id),
          razorpay_payment_id = COALESCE(${str(record.razorpayPaymentId) || null}, razorpay_payment_id),
          paid_at = COALESCE(${str(record.paidAt) || null}, paid_at),
          remarks = COALESCE(${str(record.remarks) || null}, remarks),
          updated_at = ${ts}
        WHERE id = ${id}
      `;
      updated = { type, __backendId: id, ...stripType(record), updatedAt: ts };
      break;
    }

    case "seva": {
      await sql`
        UPDATE sevas SET
          name = COALESCE(${str(record.name) || null}, name),
          description = COALESCE(${str(record.description) || null}, description),
          amount = COALESCE(${record.amount == null ? null : num(record.amount)}, amount),
          center_id = COALESCE(${record.centerId != null ? (fkCenter(str(record.centerId)) || null) : null}, center_id),
          is_active = COALESCE(${record.isActive == null ? null : bool(record.isActive)}, is_active),
          darshan_qr = COALESCE(${str(record.darshanQR) || null}, darshan_qr),
          seva_qr = COALESCE(${str(record.sevaQR) || null}, seva_qr),
          prasadam_qr = COALESCE(${str(record.prasadamQR) || null}, prasadam_qr),
          notify_whatsapp = COALESCE(${record.notifyWhatsapp == null ? null : bool(record.notifyWhatsapp)}, notify_whatsapp),
          updated_at = ${ts}
        WHERE id = ${id}
      `;
      updated = { type, __backendId: id, ...stripType(record), updatedAt: ts };
      break;
    }

    case "center": {
      await sql`
        UPDATE centers SET
          name = COALESCE(${str(record.name) || null}, name),
          city = COALESCE(${str(record.city) || null}, city),
          state = COALESCE(${str(record.state) || null}, state),
          temple_id = COALESCE(${str(record.templeId) || null}, temple_id),
          is_active = COALESCE(${record.isActive == null ? null : bool(record.isActive)}, is_active),
          updated_at = ${ts}
        WHERE id = ${id}
      `;
      updated = { type, __backendId: id, ...stripType(record), updatedAt: ts };
      break;
    }

    case "temple": {
      await sql`
        UPDATE temples SET
          name = COALESCE(${str(record.name) || null}, name),
          city = COALESCE(${str(record.city) || null}, city),
          state = COALESCE(${str(record.state) || null}, state),
          is_active = COALESCE(${record.isActive == null ? null : bool(record.isActive)}, is_active),
          updated_at = ${ts}
        WHERE id = ${id}
      `;
      updated = { type, __backendId: id, ...stripType(record), updatedAt: ts };
      break;
    }

    case "department": {
      await sql`
        UPDATE departments SET
          name = COALESCE(${str(record.name) || null}, name),
          type = COALESCE(${str(record.type) || null}, type),
          center_id = COALESCE(${str(record.centerId) || null}, center_id),
          temple_id = COALESCE(${str(record.templeId) || null}, temple_id),
          description = COALESCE(${str(record.description) || null}, description),
          is_active = COALESCE(${record.isActive == null ? null : bool(record.isActive)}, is_active),
          updated_at = ${ts}
        WHERE id = ${id}
      `;
      updated = { type, __backendId: id, ...stripType(record), updatedAt: ts };
      break;
    }

    case "department_head":
    case "departmentHead": {
      await sql`
        UPDATE department_heads SET
          name = COALESCE(${str(record.name) || null}, name),
          role = COALESCE(${str(record.role) || null}, role),
          phone = COALESCE(${str(record.phone) || null}, phone),
          temple_id = COALESCE(${str(record.templeId) || null}, temple_id),
          center_id = COALESCE(${str(record.centerId) || null}, center_id),
          is_active = COALESCE(${record.isActive == null ? null : bool(record.isActive)}, is_active),
          updated_at = ${ts}
        WHERE id = ${id}
      `;
      updated = { type: "departmentHead", __backendId: id, ...stripType(record), updatedAt: ts };
      break;
    }

    case "bank_account":
    case "bankAccount": {
      await sql`
        UPDATE bank_accounts SET
          name = COALESCE(${str(record.name) || null}, name),
          account_number = COALESCE(${str(record.accountNumber) || null}, account_number),
          bank_name = COALESCE(${str(record.bankName) || null}, bank_name),
          center_id = COALESCE(${str(record.centerId) || null}, center_id),
          payment_gateway_id = COALESCE(${str(record.paymentGatewayId) || null}, payment_gateway_id),
          is_active = COALESCE(${record.isActive == null ? null : bool(record.isActive)}, is_active),
          updated_at = ${ts}
        WHERE id = ${id}
      `;
      updated = { type: "bankAccount", __backendId: id, ...stripType(record), updatedAt: ts };
      break;
    }

    case "payment_gateway":
    case "paymentGateway": {
      const secretEnc = record.razorpayKeySecret ? encrypt(str(record.razorpayKeySecret)) : null;
      await sql`
        UPDATE payment_gateways SET
          name = COALESCE(${str(record.name) || null}, name),
          razorpay_key_id = COALESCE(${str(record.razorpayKeyId) || null}, razorpay_key_id),
          razorpay_key_secret_enc = COALESCE(${secretEnc}, razorpay_key_secret_enc),
          is_active = COALESCE(${record.isActive == null ? null : bool(record.isActive)}, is_active),
          updated_at = ${ts}
        WHERE id = ${id}
      `;
      updated = { type: "paymentGateway", __backendId: id, ...stripType(record), updatedAt: ts };
      break;
    }

    default:
      return { isOk: false, error: `Unknown record type: ${type}` };
  }

  await addAuditLog({ userId: principal.backendId, username: principal.username,
    action: "UPDATE", resourceType: type, resourceId: String(id),
    details: maskRecord(record), ipAddress: ip });
  return { isOk: true, data: updated };
}

// ---------------------------------------------------------------------------
// DELETE (soft delete via is_active = FALSE for most types; hard delete only
// for donor-deletable types per legacy rules).
// ---------------------------------------------------------------------------

export async function handleDelete(params: {
  sessionId?: string;
  record?: RecordPayload;
  ipAddress?: string;
}, req: Request): Promise<ApiResult> {
  const principal = await resolvePrincipal(params.sessionId);
  const ip = params.ipAddress ?? ipFrom(req);
  const record = params.record;
  if (!record || !record.type) return { isOk: false, error: "Record type is required" };
  const type = record.type;
  const id = record.__backendId;
  if (!id) return { isOk: false, error: "Record ID is required for delete" };

  // For bookings, we need the existing center to scope the permission check.
  let resourceCenterId = str(record.centerId) || undefined;
  if (type === "booking" && !resourceCenterId) {
    const row = await sqlOne<{ center_id: string | null }>`SELECT center_id FROM bookings WHERE id = ${id}`;
    if (!row) throw new NotFoundError("Booking not found");
    resourceCenterId = row.center_id ?? undefined;
  } else if (type === "donor" && !resourceCenterId) {
    const row = await sqlOne<{ center_id: string | null }>`SELECT center_id FROM donors WHERE id = ${id}`;
    if (!row) throw new NotFoundError("Donor not found");
    resourceCenterId = row.center_id ?? undefined;
  }

  const ok = await checkPermission(principal, type as ResourceType, "delete", resourceCenterId);
  if (!ok) {
    await addAuditLog({ userId: principal.backendId, username: principal.username,
      action: "DELETE_DENIED", resourceType: type, resourceId: String(id),
      details: maskRecord(record), ipAddress: ip, success: false });
    throw new ForbiddenError();
  }

  // Hard-delete donors & bookings (legacy behavior); soft-delete the rest.
  // Explicit branches per type — table names are static literals (no dynamic
  // interpolation), keeping every statement fully parameterized.
  const hardDeleteTypes = new Set(["donor", "booking"]);
  if (hardDeleteTypes.has(type)) {
    switch (type) {
      case "donor": await sql`DELETE FROM donors WHERE id = ${id}`; break;
      case "booking": await sql`DELETE FROM bookings WHERE id = ${id}`; break;
    }
  } else {
    const ts2 = now();
    switch (type) {
      case "user": await sql`UPDATE users SET is_active = FALSE, updated_at = ${ts2} WHERE id = ${id}`; break;
      case "seva": await sql`UPDATE sevas SET is_active = FALSE, updated_at = ${ts2} WHERE id = ${id}`; break;
      case "center": await sql`UPDATE centers SET is_active = FALSE, updated_at = ${ts2} WHERE id = ${id}`; break;
      case "temple": await sql`UPDATE temples SET is_active = FALSE, updated_at = ${ts2} WHERE id = ${id}`; break;
      case "department": await sql`UPDATE departments SET is_active = FALSE, updated_at = ${ts2} WHERE id = ${id}`; break;
      case "department_head":
      case "departmentHead": await sql`UPDATE department_heads SET is_active = FALSE, updated_at = ${ts2} WHERE id = ${id}`; break;
      case "bank_account":
      case "bankAccount": await sql`UPDATE bank_accounts SET is_active = FALSE, updated_at = ${ts2} WHERE id = ${id}`; break;
      case "payment_gateway":
      case "paymentGateway": await sql`UPDATE payment_gateways SET is_active = FALSE, updated_at = ${ts2} WHERE id = ${id}`; break;
      default: return { isOk: false, error: `Unknown record type: ${type}` };
    }
  }

  await addAuditLog({ userId: principal.backendId, username: principal.username,
    action: "DELETE", resourceType: type, resourceId: String(id),
    details: maskRecord(record), ipAddress: ip });
  return { isOk: true };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function stripType(r: RecordPayload): Record<string, unknown> {
  const { type: _t, __backendId: _b, ...rest } = r;
  void _t; void _b;
  return rest;
}

/** Remove sensitive fields before logging a record to the audit log. */
function maskRecord(r: RecordPayload): Record<string, unknown> {
  const masked = { ...r };
  if ("password" in masked) masked.password = "***";
  if ("razorpayKeySecret" in masked) masked.razorpayKeySecret = "***";
  return masked;
}

// Re-export for dispatcher use.
export { decrypt, verifyPassword, detectScheme };
