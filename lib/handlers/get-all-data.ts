// ============================================================================
// getAllData — port of getAllData() in Code.gs.
// Returns a heterogeneous `data` array of typed records (each with `type` and
// `__backendId`), matching the legacy envelope so the React frontend can map
// it directly. Donor PAN/email are decrypted for admin viewers only; donors
// get masked versions of their own data.
// ============================================================================

import { sql, sqlTyped } from "../db";
import { decrypt, maskPAN, maskEmail } from "../crypto";
import { addAuditLog } from "../audit";
import { resolvePrincipal, type Principal } from "../context";
import { getAllowedCenterIdsForUser, isSuperuserRole } from "../permissions";
import { toCamelRow } from "../db";
import type { ApiResult, Permissions } from "../types";

interface RawRow { [k: string]: unknown }

function permVisible(p: Principal, perm: keyof Permissions): boolean {
  return isSuperuserRole(p.role) || p.permissions?.[perm] === true;
}

function bool(v: unknown): boolean {
  return v === true || v === "true";
}

export async function handleGetAllData(params: {
  sessionId?: string;
  ipAddress?: string;
}, req: Request): Promise<ApiResult> {
  const principal = await resolvePrincipal(params.sessionId);
  const ip = params.ipAddress ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const allowed = await getAllowedCenterIdsForUser(principal);
  const allowedSet = new Set(allowed);

  const canSeeDonorPii =
    isSuperuserRole(principal.role) ||
    principal.role === "admin" ||
    permVisible(principal, "donor_logins") ||
    permVisible(principal, "manage_donors");

  const out: Record<string, unknown>[] = [];

  // --- Users ---
  if (principal.role !== "donor") {
    const users = await sqlTyped<RawRow>`
      SELECT id, username, role, center_id, temple_id, department_id,
             permissions, cashbooks, created_by, created_at
      FROM users
    `;
    for (const u of users) {
      const uCenter = String(u.center_id ?? "").trim();
      const uTemple = String(u.temple_id ?? "").trim();
      let include = false;
      if (isSuperuserRole(principal.role)) include = true;
      else if (principal.role === "admin") {
        include = allowedSet.has(uCenter) || (u.role === "admin" && uTemple === (principal.templeId ?? "").trim());
      } else {
        include = uCenter === principal.centerId;
      }
      if (include) {
        out.push({
          type: "user",
          __backendId: u.id,
          username: u.username,
          role: u.role,
          centerId: u.center_id ?? "",
          templeId: uTemple,
          departmentId: String(u.department_id ?? "").trim(),
          permissions: u.permissions ?? {},
          cashbooks: u.cashbooks ?? "",
          createdBy: u.created_by ?? "",
          createdAt: u.created_at,
        });
      }
    }
  }

  // --- Donors ---
  const donorRows = await sqlTyped<RawRow>`
    SELECT id, name, spiritual_name, indian_passport, pan, mobile, whatsapp, email,
           flat, road, po, area, pincode, district, state, country, tally_name,
           center_id, created_by, created_at
    FROM donors
  `;
  for (const d of donorRows) {
    const dCenter = String(d.center_id ?? "").trim();
    const include =
      isSuperuserRole(principal.role) ||
      (principal.role === "donor" && d.id === principal.donorId) ||
      allowedSet.has(dCenter);
    if (!include) continue;

    let pan = "";
    let email = "";
    try { pan = decrypt(String(d.pan ?? "")); } catch { /* */ }
    try { email = decrypt(String(d.email ?? "")); } catch { /* */ }

    // Mask if the viewer isn't allowed to see donor PII (and isn't the donor themselves).
    if (!canSeeDonorPii && !(principal.role === "donor" && d.id === principal.donorId)) {
      pan = pan ? maskPAN(pan) : "";
      email = email ? maskEmail(email) : "";
    }
    // Donors see their own PAN masked, email plaintext (matches legacy `sanitizeDonorData`).
    if (principal.role === "donor" && d.id === principal.donorId) {
      pan = pan ? maskPAN(pan) : "";
    }

    out.push({
      type: "donor",
      __backendId: d.id,
      name: d.name,
      spiritualName: d.spiritual_name ?? "",
      indianPassport: bool(d.indian_passport),
      pan,
      mobile: d.mobile ?? "",
      whatsapp: d.whatsapp ?? "",
      email,
      flat: d.flat ?? "",
      road: d.road ?? "",
      po: d.po ?? "",
      area: d.area ?? "",
      pincode: d.pincode ?? "",
      district: d.district ?? "",
      state: d.state ?? "",
      country: d.country ?? "",
      tallyName: d.tally_name ?? "",
      centerId: d.center_id ?? "",
      createdBy: d.created_by ?? "",
      createdAt: d.created_at,
    });
  }

  // --- Bookings ---
  const bookingRows = await sqlTyped<RawRow>`
    SELECT id, donor_id, items, total_amount, payment_status, payment_mode,
           booking_date, center_id, collected_by, collected_by_center,
           cheque_bank_account_id, festival_qr, razorpay_order_id,
           razorpay_payment_id, paid_at, remarks, created_at
    FROM bookings
  `;
  for (const b of bookingRows) {
    if (principal.role === "donor") {
      if (b.donor_id !== principal.donorId) continue;
    } else if (!isSuperuserRole(principal.role)) {
      const bCenter = String(b.center_id ?? "").trim();
      if (bCenter && !allowedSet.has(bCenter)) continue;
    }
    out.push({
      type: "booking",
      __backendId: b.id,
      donorId: b.donor_id,
      items: b.items ?? [],
      totalAmount: Number(b.total_amount ?? 0),
      paymentStatus: b.payment_status,
      paymentMode: b.payment_mode ?? "online",
      bookingDate: b.booking_date,
      centerId: b.center_id ?? "",
      collectedBy: b.collected_by ?? "",
      collectedByCenter: b.collected_by_center ?? "",
      chequeBankAccountId: b.cheque_bank_account_id ?? "",
      festivalQR: bool(b.festival_qr),
      razorpayOrderId: b.razorpay_order_id ?? "",
      razorpayPaymentId: b.razorpay_payment_id ?? "",
      paidAt: b.paid_at ?? "",
      remarks: b.remarks ?? "",
      createdAt: b.created_at,
    });
  }

  // --- Transactions (Tally history) — visible to admins+ for their centers,
  //     and to donors for their own records. ---
  const txnRows = await sqlTyped<RawRow>`
    SELECT id, donor_id, voucher_no, txn_date, amount, transaction_details,
           bank, transaction_type, tally_ledger, status_80g, branch, booking_id,
           center_id, created_at
    FROM transactions
  `;
  for (const t of txnRows) {
    if (principal.role === "donor") {
      if (t.donor_id !== principal.donorId) continue;
    } else if (!isSuperuserRole(principal.role)) {
      const tCenter = String(t.center_id ?? "").trim();
      if (tCenter && !allowedSet.has(tCenter)) continue;
    }
    const camel = toCamelRow<Record<string, unknown>>(t);
    out.push({ type: "transaction", ...camel });
  }

  // --- Sevas ---
  const sevaRows = await sqlTyped<RawRow>`
    SELECT id, name, description, amount, center_id, is_active, darshan_qr,
           seva_qr, prasadam_qr, notify_whatsapp, notify_numbers, created_at
    FROM sevas WHERE is_active = TRUE
  `;
  for (const s of sevaRows) {
    const sCenter = String(s.center_id ?? "") || "all_centers";
    if (sCenter !== "all_centers" && !allowedSet.has(sCenter)) continue;
    out.push({
      type: "seva",
      __backendId: s.id,
      id: s.id,
      name: s.name ?? "",
      description: s.description ?? "",
      amount: Number(s.amount ?? 0),
      centerId: sCenter,
      darshanQR: String(s.darshan_qr ?? ""),
      sevaQR: String(s.seva_qr ?? ""),
      prasadamQR: String(s.prasadam_qr ?? ""),
      notifyWhatsapp: bool(s.notify_whatsapp),
      notifyNumbers: String(s.notify_numbers ?? ""),
      createdAt: s.created_at,
    });
  }

  // --- Centers & Temples ---
  const centers = await sqlTyped<RawRow>`SELECT id, name, city, state, temple_id, is_active, created_at FROM centers`;
  const temples = await sqlTyped<RawRow>`SELECT id, name, city, state, is_active, created_at FROM temples`;

  const allowedTempleIds = new Set<string | null>([null]); // null = unrestricted
  if (principal.role === "admin" && (principal.templeId ?? "").trim()) {
    allowedTempleIds.clear();
    allowedTempleIds.add((principal.templeId ?? "").trim());
  } else if (!isSuperuserRole(principal.role) && principal.centerId) {
    const myCenter = centers.find((c) => c.id === principal.centerId);
    const tid = String(myCenter?.temple_id ?? "").trim();
    allowedTempleIds.clear();
    if (tid) allowedTempleIds.add(tid);
  }

  for (const t of temples) {
    if (!bool(t.is_active)) continue;
    if (!allowedTempleIds.has(null) && !allowedTempleIds.has(String(t.id))) continue;
    out.push({
      type: "temple",
      __backendId: t.id,
      id: t.id,
      name: t.name,
      city: t.city ?? "",
      state: t.state ?? "",
      createdAt: t.created_at,
    });
  }

  for (const c of centers) {
    if (!bool(c.is_active)) continue;
    if (!allowedSet.has(String(c.id))) continue;
    out.push({
      type: "center",
      __backendId: c.id,
      id: c.id,
      name: c.name,
      city: c.city ?? "",
      state: c.state ?? "",
      templeId: String(c.temple_id ?? "").trim(),
      createdAt: c.created_at,
    });
  }

  // --- Departments ---
  const depts = await sqlTyped<RawRow>`
    SELECT id, name, type, center_id, temple_id, description, is_active, created_at
    FROM departments WHERE is_active = TRUE
  `;
  for (const d of depts) {
    const dTemple = String(d.temple_id ?? "").trim();
    const dCenter = String(d.center_id ?? "").trim();
    let allow = false;
    if (isSuperuserRole(principal.role)) allow = true;
    else if (principal.role === "admin") allow = !!dTemple && dTemple === (principal.templeId ?? "").trim();
    else {
      if (dCenter && allowedSet.has(dCenter)) allow = true;
      else if (!dCenter && dTemple && dTemple === (principal.templeId ?? "").trim()) allow = true;
    }
    if (!allow) continue;
    out.push({
      type: "department",
      __backendId: d.id,
      id: d.id,
      name: d.name ?? "",
      deptType: String(d.type ?? ""),
      centerId: dCenter,
      templeId: dTemple,
      description: d.description ?? "",
      isActive: true,
      createdAt: d.created_at,
    });
  }

  // --- Bank accounts ---
  if (principal.role !== "donor") {
    const banks = await sqlTyped<RawRow>`
      SELECT id, name, account_number, bank_name, center_id, payment_gateway_id, is_active, created_at
      FROM bank_accounts WHERE is_active = TRUE
    `;
    for (const b of banks) {
      const bCenter = String(b.center_id ?? "").trim() || "all_centers";
      if (bCenter !== "all_centers" && !allowedSet.has(bCenter)) continue;
      out.push({
        type: "bankAccount",
        __backendId: b.id,
        id: b.id,
        name: b.name ?? "",
        accountNumber: b.account_number ?? "",
        bankName: b.bank_name ?? "",
        centerId: bCenter,
        paymentGatewayId: String(b.payment_gateway_id ?? "").trim(),
        isActive: b.is_active,
        createdAt: b.created_at,
      });
    }

    // --- Payment gateways (no secret in response) ---
    const pgs = await sqlTyped<RawRow>`
      SELECT id, name, razorpay_key_id, is_active, created_at
      FROM payment_gateways WHERE is_active = TRUE
    `;
    for (const pg of pgs) {
      out.push({
        type: "paymentGateway",
        __backendId: pg.id,
        id: pg.id,
        name: pg.name ?? "",
        razorpayKeyId: pg.razorpay_key_id ?? "",
        isActive: pg.is_active,
        createdAt: pg.created_at,
      });
    }
  }

  // --- Department heads ---
  if (principal.role !== "donor") {
    const heads = await sqlTyped<RawRow>`
      SELECT id, name, role, phone, temple_id, center_id, is_active, created_at
      FROM department_heads WHERE is_active = TRUE
    `;
    for (const h of heads) {
      const hCenter = String(h.center_id ?? "").trim();
      const hTemple = String(h.temple_id ?? "").trim();
      let allow = false;
      if (isSuperuserRole(principal.role)) allow = true;
      else if (hCenter && allowedSet.has(hCenter)) allow = true;
      else if (!hCenter && hTemple && hTemple === (principal.templeId ?? "").trim()) allow = true;
      if (!allow) continue;
      out.push({
        type: "departmentHead",
        __backendId: h.id,
        id: h.id,
        name: h.name,
        role: h.role ?? "",
        phone: String(h.phone ?? "").trim(),
        templeId: hTemple,
        centerId: hCenter,
        isActive: true,
        createdAt: h.created_at,
      });
    }
  }

  // --- Events ---
  {
    const events = await sqlTyped<RawRow>`
      SELECT id, title, description, event_date, event_time, venue, price,
             capacity, department_id, center_id, is_active, created_by, created_at
      FROM events WHERE is_active = TRUE
    `;
    for (const e of events) {
      // Donors see all events; staff see events for their centers.
      if (principal.role !== "donor" && principal.role !== "developer" && principal.role !== "superadmin") {
        const eCenter = String(e.center_id ?? "").trim();
        if (eCenter && !allowedSet.has(eCenter)) continue;
      }
      out.push({
        type: "event",
        __backendId: e.id,
        id: e.id,
        title: e.title ?? "",
        description: e.description ?? "",
        eventDate: e.event_date ?? "",
        eventTime: e.event_time ?? "",
        venue: e.venue ?? "",
        price: Number(e.price ?? 0),
        capacity: Number(e.capacity ?? 0),
        departmentId: String(e.department_id ?? "").trim(),
        centerId: String(e.center_id ?? "").trim(),
        isActive: true,
        createdBy: e.created_by ?? "",
        createdAt: e.created_at ?? "",
      });
    }
  }

  // --- Event bookings ---
  {
    const evtBks = await sqlTyped<RawRow>`
      SELECT id, event_id, donor_id, quantity, total_amount, payment_status,
             payment_mode, razorpay_order_id, razorpay_payment_id, paid_at,
             remarks, booked_by, center_id, created_at
      FROM event_bookings
    `;
    for (const b of evtBks) {
      if (principal.role === "donor") {
        if (b.donor_id !== principal.donorId) continue;
      }
      out.push({
        type: "eventBooking",
        __backendId: b.id,
        id: b.id,
        eventId: b.event_id ?? "",
        donorId: b.donor_id ?? "",
        quantity: Number(b.quantity ?? 1),
        totalAmount: Number(b.total_amount ?? 0),
        paymentStatus: b.payment_status ?? "pending",
        paymentMode: b.payment_mode ?? "online",
        razorpayOrderId: b.razorpay_order_id ?? "",
        razorpayPaymentId: b.razorpay_payment_id ?? "",
        paidAt: b.paid_at ?? "",
        remarks: b.remarks ?? "",
        bookedBy: b.booked_by ?? "",
        centerId: b.center_id ?? "",
        createdAt: b.created_at ?? "",
      });
    }
  }

  await addAuditLog({
    userId: principal.backendId,
    username: principal.username,
    action: "GET_ALL_DATA",
    details: `Retrieved ${out.length} records`,
    ipAddress: ip,
  });

  return { isOk: true, data: out };
}
