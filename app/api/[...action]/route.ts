// ============================================================================
// API dispatcher — single Next.js Route Handler that mirrors the legacy
// Apps Script ?action= convention. Accepts:
//   - POST with JSON body { action, sessionId, ...params }
//   - GET  with ?data=<urlencoded JSON>  (legacy frontend compatibility)
//
// The action name is read from the JSON payload (NOT from the URL path) so the
// frontend can keep its existing API client shape. The catch-all path simply
// gives us a stable endpoint to mount under /api/.
// ============================================================================

import { NextResponse } from "next/server";
import { toApiResult, AuthError } from "@/lib/errors";
import { addAuditLog } from "@/lib/audit";
import { tryGetEnv } from "@/lib/env";
import type { ApiResult } from "@/lib/types";

// Allow large bodies for bulk import.
export const runtime = "nodejs";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Action registry — each entry is a function (params, req) => Promise<ApiResult>.
// Auth-aware handlers resolve the principal themselves; unauthenticated actions
// (ping, login, selfRegister, resetDonorPassword, initializeDatabase) are marked.
// ---------------------------------------------------------------------------

import {
  handleLogin, handleLogout, handleValidateSession, handleChangePassword,
  handleResetDonorPassword, handleSelfRegister, handleApproveSelfSignup,
} from "@/lib/handlers/auth";
import { handleGetAllData } from "@/lib/handlers/get-all-data";
import { handleCreate, handleUpdate, handleDelete } from "@/lib/handlers/crud";
import {
  createRazorpayOrder, verifyRazorpayPayment,
} from "@/lib/handlers/razorpay";
import {
  sendWhatsAppMessage, sendBulkDonorLoginWhatsApp, sendDonorLoginWhatsApp,
} from "@/lib/handlers/whatsapp";
import {
  bulkImportDonors, bulkImportTransactions, bulkPatchBookingRemarks,
} from "@/lib/handlers/bulk";
import {
  validateQR, flushSevas, toggleSuperadminAccess, initializeDatabase,
} from "@/lib/handlers/misc";
import {
  handleGetEvents, handleCreateEvent, handleUpdateEvent, handleDeleteEvent,
  handleCreateEventBooking, verifyRazorpayPaymentForEvent,
  handleCancelEventBooking, handleGetEventBookings,
} from "@/lib/handlers/events";
import { lookup10BeUrl } from "@/lib/handlers/tenbe";

type Handler = (params: Record<string, unknown>, req: Request) => Promise<ApiResult>;

const handlers: Record<string, Handler> = {
  // --- Unauthenticated / setup ---
  ping: async () => ({
    isOk: true,
    message: "MyISKCON Backend is running",
    version: "2.0",
    hasRazorpay: !!tryGetEnv()?.RAZORPAY_KEY_ID,
  }),
  login: (p, req) => handleLogin(p, req),
  selfRegister: (p, req) => handleSelfRegister(p, req),
  resetDonorPassword: (p, req) => handleResetDonorPassword(p, req),
  initializeDatabase: (p) => initializeDatabase(p),

  // --- Auth ---
  logout: (p) => handleLogout(p),
  validateSession: (p) => handleValidateSession(p),
  changePassword: (p, req) => handleChangePassword(p, req),
  approveSelfSignup: (p, req) => handleApproveSelfSignup(p, req),

  // --- Data ---
  getAllData: (p, req) => handleGetAllData(p, req),
  create: (p, req) => handleCreate(p, req),
  update: (p, req) => handleUpdate(p, req),
  delete: (p, req) => handleDelete(p, req),

  // --- Razorpay ---
  createRazorpayOrder: (p, req) => createRazorpayOrder(p, req),
  verifyRazorpayPayment: (p, req) => verifyRazorpayPayment(p, req),

  // --- WhatsApp ---
  sendWhatsAppMessage: (p) => sendWhatsAppMessage(p),
  sendBulkDonorLoginWhatsApp: (p) => sendBulkDonorLoginWhatsApp(p),
  sendDonorLoginWhatsApp: (p) => sendDonorLoginWhatsApp(p),

  // --- Bulk import ---
  bulkImportDonors: (p, req) => bulkImportDonors(p, req),
  bulkImportTransactions: (p, req) => bulkImportTransactions(p, req),
  bulkPatchBookingRemarks: (p, req) => bulkPatchBookingRemarks(p, req),

  // --- QR / setup / 10BE ---
  validateQR: (p, req) => validateQR(p, req),
  lookup10BeUrl: (p, req) => lookup10BeUrl(p, req),
  flushSevas: (p, req) => flushSevas(p, req),
  toggleSuperadminAccess: (p, req) => toggleSuperadminAccess(p, req),

  // --- Events ---
  getEvents: (p, req) => handleGetEvents(p, req),
  createEvent: (p, req) => handleCreateEvent(p, req),
  updateEvent: (p, req) => handleUpdateEvent(p, req),
  deleteEvent: (p, req) => handleDeleteEvent(p, req),
  createEventBooking: (p, req) => handleCreateEventBooking(p, req),
  verifyRazorpayPaymentForEvent: (p, req) => verifyRazorpayPaymentForEvent(p, req),
  cancelEventBooking: (p, req) => handleCancelEventBooking(p, req),
  getEventBookings: (p, req) => handleGetEventBookings(p, req),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function envelope(result: ApiResult, status = 200) {
  return NextResponse.json(result, {
    status,
    headers: {
      // Same CORS shape as the legacy backend so the old frontend (or any
      // static host) can call this endpoint without preflight issues.
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
    },
  });
}

async function parseParams(req: Request): Promise<Record<string, unknown> | null> {
  try {
    if (req.method === "POST") {
      const text = await req.text();
      if (!text.trim()) return {};
      return JSON.parse(text) as Record<string, unknown>;
    }
    // GET: ?data=<json>
    const url = new URL(req.url);
    const data = url.searchParams.get("data");
    if (data) return JSON.parse(data) as Record<string, unknown>;
    // Also accept flat query params for ping/health.
    const flat: Record<string, unknown> = {};
    url.searchParams.forEach((v, k) => { flat[k] = v; });
    return flat;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export async function OPTIONS() {
  return envelope({ isOk: true }, 204);
}

async function run(req: Request): Promise<Response> {
  const params = await parseParams(req);
  if (params === null) {
    return envelope({ isOk: false, error: "Invalid JSON payload" }, 400);
  }
  const action = String(params.action ?? "ping");
  const handler = handlers[action];
  if (!handler) {
    return envelope({ isOk: false, error: `Unknown action: ${action}` }, 404);
  }
  try {
    const result = await handler(params, req);
    return envelope(result);
  } catch (err) {
    if (err instanceof AuthError) {
      // Log auth failures (matches legacy) then surface to the client.
      await addAuditLog({
        username: String(params.username ?? ""),
        action: "AUTH_ERROR",
        details: { action, error: err.message },
        success: false,
      }).catch(() => void 0);
      return envelope({ isOk: false, error: err.message }, err.status);
    }
    const result = toApiResult(err);
    const status = err && typeof err === "object" && "status" in err
      ? Number((err as { status?: number }).status ?? 500)
      : 500;
    return envelope(result, status);
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
