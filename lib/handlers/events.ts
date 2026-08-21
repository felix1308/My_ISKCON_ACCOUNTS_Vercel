// ============================================================================
// Events & event bookings — port of handleGetEvents / handleCreateEvent /
// handleUpdateEvent / handleDeleteEvent / handleCreateEventBooking /
// verifyRazorpayPaymentForEvent / handleCancelEventBooking /
// handleGetEventBookings from Code.gs.
//
// Authorization:
//   - admins / superadmin / developer / dept_staff can manage events
//   - dept_staff is constrained to their own department
//   - donors can browse events and book/cancel their own (online only)
// ============================================================================

import { createHmac } from "node:crypto";
import { sql, sqlOne, sqlTyped } from "../db";
import { getEnv } from "../env";
import { resolvePrincipal, type Principal } from "../context";
import { addAuditLog } from "../audit";
import { ForbiddenError, NotFoundError } from "../errors";
import { getPaymentGatewayCredentials } from "./razorpay";
import { generateId } from "../ids";
import type { ApiResult } from "../types";

function ipFrom(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
}
function canManageEvents(p: Principal): boolean {
  // Port of Code.gs canManageEvents: dept_staff can manage events for their
  // own department; admin/superadmin/developer can manage all events.
  return p.role === "developer" || p.role === "superadmin" || p.role === "admin" || p.role === "dept_staff";
}
const isDeptStaff = (p: Principal) => p.role === "dept_staff";
const deptOf = (p: Principal) => (p.departmentId ?? "").trim();
const num = (v: unknown, d = 0) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : d;
};
const str = (v: unknown, d = "") => (v == null ? d : String(v).trim());

// ---------------------------------------------------------------------------
// GET EVENTS (optionally session-scoped)
// ---------------------------------------------------------------------------

export async function handleGetEvents(params: { sessionId?: string }, req: Request): Promise<ApiResult> {
  let principal: Principal | null = null;
  if (params.sessionId) {
    try { principal = await resolvePrincipal(params.sessionId); } catch { /* unauth browsing ok */ }
  }
  const events = await sqlTyped<{ id: string; title: string; description: string; event_date: string; event_time: string; venue: string; price: number; capacity: number; department_id: string | null; center_id: string | null; is_active: boolean; created_by: string; created_at: string }>`
    SELECT id, title, description, event_date, event_time, venue, price, capacity,
           department_id, center_id, is_active, created_by, created_at
    FROM events WHERE is_active = TRUE
  `;
  const data = events.map((e) => ({
    type: "event", __backendId: e.id, id: e.id, title: e.title, description: e.description,
    eventDate: e.event_date, eventTime: e.event_time, venue: e.venue, price: num(e.price),
    capacity: num(e.capacity), departmentId: e.department_id ?? "", centerId: e.center_id ?? "",
    isActive: true, createdBy: e.created_by, createdAt: e.created_at,
  }));
  return { isOk: true, data };
}

// ---------------------------------------------------------------------------
// CREATE EVENT
// ---------------------------------------------------------------------------

export async function handleCreateEvent(params: {
  sessionId?: string;
  record?: Record<string, unknown>;
  ipAddress?: string;
}, req: Request): Promise<ApiResult> {
  const principal = await resolvePrincipal(params.sessionId);
  if (!canManageEvents(principal)) {
    throw new ForbiddenError("Permission denied. Only dept staff or admins can create events.");
  }
  const r = params.record ?? {};
  if (!str(r.title)) return { isOk: false, error: "Event title is required" };
  if (!str(r.eventDate)) return { isOk: false, error: "Event date is required" };

  const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const ts = new Date().toISOString();
  // Dept staff: force departmentId to their own department.
  let departmentId = str(r.departmentId) || (principal.departmentId ?? "") || "";
  if (isDeptStaff(principal)) departmentId = deptOf(principal);
  const centerId = str(r.centerId) || principal.centerId || "";

  await sql`
    INSERT INTO events (id, title, description, event_date, event_time, venue, price,
                        capacity, department_id, center_id, is_active, created_by, created_at, updated_at)
    VALUES (${id}, ${str(r.title)}, ${str(r.description)}, ${str(r.eventDate)}, ${str(r.eventTime)},
            ${str(r.venue)}, ${num(r.price)}, ${num(r.capacity)}, ${departmentId || null},
            ${centerId || null}, TRUE, ${principal.username}, ${ts}, ${ts})
  `;
  await addAuditLog({ userId: principal.backendId, username: principal.username,
    action: "CREATE_EVENT", resourceType: "event", resourceId: id, details: { title: r.title },
    ipAddress: params.ipAddress ?? ipFrom(req) });
  return { isOk: true, data: { type: "event", __backendId: id, id, title: str(r.title),
    description: str(r.description), eventDate: str(r.eventDate), eventTime: str(r.eventTime),
    venue: str(r.venue), price: num(r.price), capacity: num(r.capacity), departmentId, centerId,
    isActive: true, createdBy: principal.username, createdAt: ts } };
}

// ---------------------------------------------------------------------------
// UPDATE EVENT
// ---------------------------------------------------------------------------

export async function handleUpdateEvent(params: {
  sessionId?: string;
  record?: Record<string, unknown>;
  ipAddress?: string;
}, req: Request): Promise<ApiResult> {
  const principal = await resolvePrincipal(params.sessionId);
  if (!canManageEvents(principal)) throw new ForbiddenError();
  const r = params.record ?? {};
  const id = str(r.id ?? r.__backendId);
  if (!id) return { isOk: false, error: "Event ID is required" };
  const existing = await sqlOne<{ department_id: string | null }>`SELECT department_id FROM events WHERE id = ${id}`;
  if (!existing) throw new NotFoundError("Event not found");

  // Dept staff can only edit their own department's events.
  if (isDeptStaff(principal) && (existing.department_id ?? "") !== deptOf(principal)) {
    return { isOk: false, error: "You can only edit events belonging to your department" };
  }

  // departmentId / centerId are immutable on update (matches legacy behavior —
  // the UPDATE below intentionally never touches department_id / center_id).
  const ts = new Date().toISOString();
  await sql`
    UPDATE events SET
      title = COALESCE(${str(r.title) || null}, title),
      description = COALESCE(${str(r.description) || null}, description),
      event_date = COALESCE(${str(r.eventDate) || null}, event_date),
      event_time = COALESCE(${str(r.eventTime) || null}, event_time),
      venue = COALESCE(${str(r.venue) || null}, venue),
      price = COALESCE(${r.price == null ? null : num(r.price)}, price),
      capacity = COALESCE(${r.capacity == null ? null : num(r.capacity)}, capacity),
      is_active = COALESCE(${r.isActive == null ? null : r.isActive === true || r.isActive === "true"}, is_active),
      updated_at = ${ts}
    WHERE id = ${id}
  `;
  await addAuditLog({ userId: principal.backendId, username: principal.username,
    action: "UPDATE_EVENT", resourceType: "event", resourceId: id, ipAddress: params.ipAddress ?? ipFrom(req) });
  return { isOk: true, data: { type: "event", __backendId: id, ...r, updatedAt: ts } };
}

// ---------------------------------------------------------------------------
// DELETE EVENT (soft)
// ---------------------------------------------------------------------------

export async function handleDeleteEvent(params: {
  sessionId?: string;
  record?: Record<string, unknown>;
  ipAddress?: string;
}, req: Request): Promise<ApiResult> {
  const principal = await resolvePrincipal(params.sessionId);
  if (!canManageEvents(principal)) throw new ForbiddenError();
  const r = params.record ?? {};
  const id = str(r.id ?? r.__backendId);
  if (!id) return { isOk: false, error: "Event ID is required" };
  // Dept staff: check ownership.
  if (isDeptStaff(principal)) {
    const existing = await sqlOne<{ department_id: string | null }>`SELECT department_id FROM events WHERE id = ${id}`;
    if (!existing) throw new NotFoundError("Event not found");
    if ((existing.department_id ?? "") !== deptOf(principal)) {
      return { isOk: false, error: "You can only delete events belonging to your department" };
    }
  }
  await sql`UPDATE events SET is_active = FALSE, updated_at = now() WHERE id = ${id}`;
  await addAuditLog({ userId: principal.backendId, username: principal.username,
    action: "DELETE_EVENT", resourceType: "event", resourceId: id, ipAddress: params.ipAddress ?? ipFrom(req) });
  return { isOk: true };
}

// ---------------------------------------------------------------------------
// CREATE EVENT BOOKING
// ---------------------------------------------------------------------------

export async function handleCreateEventBooking(params: {
  sessionId?: string;
  record?: Record<string, unknown>;
  ipAddress?: string;
}, req: Request): Promise<ApiResult> {
  const principal = await resolvePrincipal(params.sessionId);
  const r = params.record ?? {};
  const eventId = str(r.eventId);
  const quantity = Math.max(1, num(r.quantity, 1));
  if (!eventId) return { isOk: false, error: "Event ID is required" };

  const evt = await sqlOne<{ id: string; price: number; capacity: number; center_id: string | null; is_active: boolean }>`
    SELECT id, price, capacity, center_id, is_active FROM events WHERE id = ${eventId} LIMIT 1
  `;
  if (!evt || !evt.is_active) return { isOk: false, error: "Event not found or no longer active" };

  if (evt.capacity > 0) {
    const booked = await sqlOne<{ cnt: string }>`SELECT COUNT(*)::text AS cnt FROM event_bookings WHERE event_id = ${eventId} AND payment_status <> 'cancelled'`;
    if (Number(booked?.cnt ?? 0) + quantity > evt.capacity) {
      return { isOk: false, error: "Sorry, this event is sold out" };
    }
  }

  const paymentMode = str(r.paymentMode, "online").toLowerCase();
  if (principal.role === "donor" && paymentMode !== "online") {
    return { isOk: false, error: "Donors can only book online. Please use online payment." };
  }
  const donorId = principal.role === "donor" ? (principal.donorId ?? "") : str(r.donorId);
  if (!donorId) return { isOk: false, error: "Donor ID is required" };

  const totalAmount = num(evt.price) * quantity;
  const paymentStatus = (paymentMode === "online" && r.paymentStatus !== "paid") ? "pending" : str(r.paymentStatus, "pending");
  const id = `evtbk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const ts = new Date().toISOString();
  const centerId = str(evt.center_id) || principal.centerId || "";

  await sql`
    INSERT INTO event_bookings (id, event_id, donor_id, quantity, total_amount, payment_status,
                                payment_mode, razorpay_order_id, razorpay_payment_id, paid_at,
                                remarks, booked_by, center_id, created_at, updated_at)
    VALUES (${id}, ${eventId}, ${donorId}, ${quantity}, ${totalAmount}, ${paymentStatus},
            ${paymentMode}, ${str(r.razorpayOrderId)}, ${str(r.razorpayPaymentId)},
            ${paymentStatus === "paid" ? ts : ""}, ${str(r.remarks)}, ${principal.username},
            ${centerId || null}, ${ts}, ${ts})
  `;
  await addAuditLog({ userId: principal.backendId, username: principal.username,
    action: "CREATE_EVENT_BOOKING", resourceType: "eventBooking", resourceId: id,
    details: { eventId, quantity }, ipAddress: params.ipAddress ?? ipFrom(req) });
  return { isOk: true, data: { type: "eventBooking", __backendId: id, id, eventId, donorId,
    quantity, totalAmount, paymentStatus, paymentMode, bookedBy: principal.username,
    centerId, createdAt: ts } };
}

// ---------------------------------------------------------------------------
// VERIFY RAZORPAY PAYMENT (EVENT)
// ---------------------------------------------------------------------------

export async function verifyRazorpayPaymentForEvent(params: {
  sessionId?: string;
  orderId?: string;
  paymentId?: string;
  signature?: string;
  eventBookingId?: string;
  paymentGatewayId?: string;
}, req: Request): Promise<ApiResult> {
  const principal = await resolvePrincipal(params.sessionId);
  const env = getEnv();
  const { orderId, paymentId, signature, eventBookingId, paymentGatewayId } = params;
  if (!orderId || !paymentId || !signature) return { isOk: false, error: "Missing orderId, paymentId or signature" };

  let keySecret = env.RAZORPAY_KEY_SECRET;
  if (paymentGatewayId?.trim()) {
    const creds = await getPaymentGatewayCredentials(paymentGatewayId);
    if (creds) keySecret = creds.keySecret;
  }
  const expected = createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`, "utf8").digest("hex");
  if (expected !== signature) {
    await addAuditLog({ userId: principal.backendId, username: principal.username,
      action: "EVENT_PAYMENT_VERIFY_FAILED", resourceType: "eventBooking",
      resourceId: eventBookingId ?? "", details: { orderId, paymentId }, success: false,
      ipAddress: ipFrom(req) });
    return { isOk: false, error: "Invalid payment signature" };
  }
  if (eventBookingId) {
    const ts = new Date().toISOString();
    await sql`
      UPDATE event_bookings SET payment_status = 'paid', payment_mode = 'online',
        razorpay_order_id = ${orderId}, razorpay_payment_id = ${paymentId},
        paid_at = ${ts}, updated_at = ${ts}
      WHERE id = ${eventBookingId}
    `;
  }
  await addAuditLog({ userId: principal.backendId, username: principal.username,
    action: "EVENT_PAYMENT_VERIFIED", resourceType: "eventBooking", resourceId: eventBookingId ?? "",
    details: { orderId }, ipAddress: ipFrom(req) });
  return { isOk: true, message: "Payment verified" };
}

// ---------------------------------------------------------------------------
// CANCEL EVENT BOOKING
// ---------------------------------------------------------------------------

export async function handleCancelEventBooking(params: {
  sessionId?: string;
  bookingId?: string;
  ipAddress?: string;
}, req: Request): Promise<ApiResult> {
  const principal = await resolvePrincipal(params.sessionId);
  const id = str(params.bookingId);
  if (!id) return { isOk: false, error: "Booking ID is required" };
  const row = await sqlOne<{ donor_id: string; payment_status: string }>`
    SELECT donor_id, payment_status FROM event_bookings WHERE id = ${id} LIMIT 1
  `;
  if (!row) throw new NotFoundError("Event booking not found");
  if (principal.role === "donor") {
    if (row.donor_id !== principal.donorId) throw new ForbiddenError("You can only cancel your own bookings");
    if (row.payment_status === "paid") return { isOk: false, error: "Paid bookings cannot be self-cancelled. Contact the temple office." };
  }
  await sql`UPDATE event_bookings SET payment_status = 'cancelled', updated_at = now() WHERE id = ${id}`;
  await addAuditLog({ userId: principal.backendId, username: principal.username,
    action: "CANCEL_EVENT_BOOKING", resourceType: "eventBooking", resourceId: id,
    ipAddress: params.ipAddress ?? ipFrom(req) });
  return { isOk: true };
}

// ---------------------------------------------------------------------------
// GET EVENT BOOKINGS (scoped by role)
// ---------------------------------------------------------------------------

export async function handleGetEventBookings(params: { sessionId?: string }, req: Request): Promise<ApiResult> {
  const principal = await resolvePrincipal(params.sessionId);
  let rows: Array<Record<string, unknown>>;
  if (principal.role === "donor") {
    rows = await sql`
      SELECT id, event_id, donor_id, quantity, total_amount, payment_status, payment_mode,
             razorpay_order_id, razorpay_payment_id, paid_at, remarks, booked_by, center_id, created_at
      FROM event_bookings WHERE donor_id = ${principal.donorId}
    `;
  } else if (isDeptStaff(principal)) {
    // Dept staff see bookings only for events belonging to their department.
    rows = await sql`
      SELECT eb.id, eb.event_id, eb.donor_id, eb.quantity, eb.total_amount, eb.payment_status,
             eb.payment_mode, eb.razorpay_order_id, eb.razorpay_payment_id, eb.paid_at,
             eb.remarks, eb.booked_by, eb.center_id, eb.created_at
      FROM event_bookings eb
      JOIN events e ON e.id = eb.event_id
      WHERE e.department_id = ${deptOf(principal)}
    `;
  } else {
    rows = await sql`
      SELECT id, event_id, donor_id, quantity, total_amount, payment_status, payment_mode,
             razorpay_order_id, razorpay_payment_id, paid_at, remarks, booked_by, center_id, created_at
      FROM event_bookings
    `;
  }
  const data = rows.map((b) => ({
    type: "eventBooking", __backendId: b.id, id: b.id, eventId: b.event_id, donorId: b.donor_id,
    quantity: Number(b.quantity), totalAmount: Number(b.total_amount), paymentStatus: b.payment_status,
    paymentMode: b.payment_mode, razorpayOrderId: b.razorpay_order_id, razorpayPaymentId: b.razorpay_payment_id,
    paidAt: b.paid_at, remarks: b.remarks, bookedBy: b.booked_by, centerId: b.center_id, createdAt: b.created_at,
  }));
  return { isOk: true, data };
}

// re-export for dispatcher
export { generateId };
