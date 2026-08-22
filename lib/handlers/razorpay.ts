// ============================================================================
// Razorpay handlers — port of createRazorpayOrder / verifyRazorpayPayment
// from Code.gs. Uses the official `razorpay` npm package for type-safety.
//
// Credential resolution order (matches legacy):
//   1. Explicit paymentGatewayId param -> payment_gateways row (decrypted secret)
//   2. centerId -> bank account -> payment_gateways row
//   3. Fallback to env vars RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET
// ============================================================================

import Razorpay from "razorpay";
import { createHmac } from "node:crypto";
import { sql, sqlOne } from "../db";
import { getEnv } from "../env";
import { decrypt } from "../crypto";
import { resolvePrincipal } from "../context";
import { addAuditLog } from "../audit";
import { sendSevaReminderWhatsApp, sendDonorLoginTemplateForBooking } from "./whatsapp";
import type { ApiResult } from "../types";

interface GatewayCreds { keyId: string; keySecret: string; }

export async function getPaymentGatewayCredentials(gatewayId: string): Promise<GatewayCreds | null> {
  if (!gatewayId?.trim()) return null;
  const row = await sqlOne<{ razorpay_key_id: string; razorpay_key_secret_enc: string; is_active: boolean }>`
    SELECT razorpay_key_id, razorpay_key_secret_enc, is_active
    FROM payment_gateways WHERE id = ${gatewayId} LIMIT 1
  `;
  if (!row || !row.is_active) return null;
  const keyId = (row.razorpay_key_id ?? "").trim();
  const enc = (row.razorpay_key_secret_enc ?? "").trim();
  if (!keyId || !enc) return null;
  let keySecret = "";
  try { keySecret = decrypt(enc); } catch { return null; }
  if (!keySecret) return null;
  return { keyId, keySecret };
}

async function getGatewayIdForCenter(centerId: string): Promise<string | null> {
  if (!centerId?.trim()) return null;
  const row = await sqlOne<{ payment_gateway_id: string | null }>`
    SELECT payment_gateway_id FROM bank_accounts
    WHERE is_active = TRUE AND payment_gateway_id IS NOT NULL AND payment_gateway_id <> ''
      AND (center_id = ${centerId} OR center_id IS NULL OR center_id = 'all_centers')
    ORDER BY (center_id = ${centerId}) DESC, id
    LIMIT 1
  `;
  return row?.payment_gateway_id ?? null;
}

// ---------------------------------------------------------------------------
// RESOLVE GATEWAY (read-only — which account would charge for this center)
// ---------------------------------------------------------------------------

interface ResolvedGateway {
  keyId: string;
  keySecret: string;
  gatewayId: string | null;
  gatewayName: string;
  source: "explicit" | "center" | "fallback";
}

async function resolveGateway(
  paymentGatewayId?: string,
  centerId?: string
): Promise<ResolvedGateway | null> {
  const env = getEnv();
  if (paymentGatewayId?.trim()) {
    const creds = await getPaymentGatewayCredentials(paymentGatewayId);
    if (creds) {
      const row = await sqlOne<{ name: string }>`SELECT name FROM payment_gateways WHERE id = ${paymentGatewayId} LIMIT 1`;
      return { ...creds, gatewayId: paymentGatewayId, gatewayName: row?.name ?? "Selected gateway", source: "explicit" };
    }
  }
  if (centerId?.trim()) {
    const gid = await getGatewayIdForCenter(centerId);
    if (gid) {
      const creds = await getPaymentGatewayCredentials(gid);
      if (creds) {
        const row = await sqlOne<{ name: string }>`SELECT name FROM payment_gateways WHERE id = ${gid} LIMIT 1`;
        return { ...creds, gatewayId: gid, gatewayName: row?.name ?? "Center gateway", source: "center" };
      }
    }
  }
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return null;
  return { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET, gatewayId: null, gatewayName: "Default account (env)", source: "fallback" };
}

/**
 * Read-only: returns which Razorpay account WOULD charge for the given center.
 * Safe to expose — keyId is public (it appears in the checkout popup anyway);
 * the secret is never returned.
 */
export async function resolvePaymentGateway(params: {
  sessionId?: string;
  centerId?: string;
  paymentGatewayId?: string;
}, req: Request): Promise<ApiResult> {
  void req;
  await resolvePrincipal(params.sessionId); // auth-only
  const gw = await resolveGateway(params.paymentGatewayId, params.centerId);
  if (!gw) return { isOk: false, error: "Razorpay is not configured" };
  return { isOk: true, gatewayId: gw.gatewayId, gatewayName: gw.gatewayName, keyId: gw.keyId, source: gw.source };
}

// ---------------------------------------------------------------------------
// CREATE ORDER
// ---------------------------------------------------------------------------

export async function createRazorpayOrder(params: {
  sessionId?: string;
  amount?: number | string;
  receipt?: string;
  currency?: string;
  centerId?: string;
  paymentGatewayId?: string;
}, req: Request): Promise<ApiResult> {
  await resolvePrincipal(params.sessionId); // auth-only

  const amountPaise = Math.round(Number(params.amount ?? 0));
  if (amountPaise < 100) return { isOk: false, error: "Amount must be at least ₹1" };

  const gw = await resolveGateway(params.paymentGatewayId, params.centerId);
  if (!gw) return { isOk: false, error: "Razorpay is not configured" };
  const creds: GatewayCreds = { keyId: gw.keyId, keySecret: gw.keySecret };
  const usedGatewayId = gw.gatewayId;

  const rzp = new Razorpay({ key_id: creds.keyId, key_secret: creds.keySecret });
  const receipt = (params.receipt ?? `rcp_${Date.now()}`).toString().slice(0, 40);

  try {
    const order = await rzp.orders.create({
      amount: amountPaise,
      currency: params.currency ?? "INR",
      receipt,
    });
    const result: ApiResult & Record<string, unknown> = {
      isOk: true,
      orderId: order.id,
      keyId: creds.keyId,
      amount: order.amount,
      currency: order.currency ?? "INR",
      gatewayName: gw.gatewayName,
      gatewaySource: gw.source,
    };
    if (usedGatewayId) result.paymentGatewayId = usedGatewayId;
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Razorpay request failed";
    return { isOk: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// VERIFY PAYMENT
// ---------------------------------------------------------------------------

export async function verifyRazorpayPayment(params: {
  sessionId?: string;
  orderId?: string;
  paymentId?: string;
  signature?: string;
  bookingId?: string;
  paymentGatewayId?: string;
}, req: Request): Promise<ApiResult> {
  const principal = await resolvePrincipal(params.sessionId);
  const env = getEnv();

  const { orderId, paymentId, signature, bookingId, paymentGatewayId } = params;
  if (!orderId || !paymentId || !signature) {
    return { isOk: false, error: "Missing orderId, paymentId or signature" };
  }

  let keySecret = env.RAZORPAY_KEY_SECRET;
  if (paymentGatewayId?.trim()) {
    const creds = await getPaymentGatewayCredentials(paymentGatewayId);
    if (creds) keySecret = creds.keySecret;
  }

  const expected = createHmac("sha256", keySecret)
    .update(`${orderId}|${paymentId}`, "utf8")
    .digest("hex");

  if (expected !== signature) {
    await addAuditLog({
      userId: principal.backendId, username: principal.username,
      action: "PAYMENT_VERIFY_FAILED", resourceType: "booking",
      resourceId: bookingId ?? "", details: { orderId, paymentId },
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "",
      success: false,
    });
    return { isOk: false, error: "Invalid payment signature" };
  }

  if (bookingId) {
    const ts = new Date().toISOString();
    await sql`
      UPDATE bookings SET
        payment_status = 'paid', payment_mode = 'online',
        razorpay_order_id = ${orderId}, razorpay_payment_id = ${paymentId},
        paid_at = ${ts}, updated_at = ${ts}
      WHERE id = ${bookingId}
    `;
    // Legacy behavior: the booking just became paid — WhatsApp the seva
    // reminders to the notify numbers and the donor-login template to the
    // donor. Fire-and-forget: never fail the payment verification.
    try {
      const bk = await sqlOne<{ donor_id: string; items: unknown; booking_date: string }>`
        SELECT donor_id, items, booking_date FROM bookings WHERE id = ${bookingId} LIMIT 1
      `;
      if (bk) {
        await sendSevaReminderWhatsApp({ items: bk.items, bookingDate: String(bk.booking_date ?? "") });
        await sendDonorLoginTemplateForBooking(String(bk.donor_id ?? ""));
      }
    } catch (e) {
      console.error("verifyRazorpayPayment WhatsApp notify:", e instanceof Error ? e.message : e);
    }
  }

  await addAuditLog({
    userId: principal.backendId, username: principal.username,
    action: "PAYMENT_VERIFIED", resourceType: "booking",
    resourceId: bookingId ?? "", details: { orderId, paymentId },
    ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "",
  });

  return { isOk: true, message: "Payment verified" };
}
