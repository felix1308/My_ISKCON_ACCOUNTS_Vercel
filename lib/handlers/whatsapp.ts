// ============================================================================
// WhatsApp (bhashsms.com) — port of sendWhatsAppMessageInternal /
// sendWhatsAppMessage / sendBulkDonorLoginWhatsApp / sendDonorLoginWhatsApp /
// sendSevaReminderWhatsApp / sendDonorLoginTemplateForBooking from Code.gs.
//
// Credentials come from env vars (BHASHSMS_*) instead of PropertiesService.
// Phone normalization: keep last 10 digits, prefix 91 (India).
// ============================================================================

import { sql, sqlTyped } from "../db";
import { getEnv } from "../env";
import { resolvePrincipal, type Principal } from "../context";
import type { ApiResult } from "../types";

const DONOR_LOGIN_TEMPLATE = "donor_login_202526b";

function normalizePhones(input: unknown): string[] {
  if (input == null) return [];
  const raw = Array.isArray(input) ? input.join(",") : String(input);
  const parts = raw.split(/[,;\n\r]+/g).map((s) => s.trim()).filter(Boolean);
  const cleaned = parts.map((p) => p.replace(/\D/g, "")).filter((p) => p.length >= 10);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of cleaned) {
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function to91(phone: string): string {
  const last10 = phone.replace(/\D/g, "").slice(-10);
  return last10.length === 10 ? `91${last10}` : phone;
}

/** Low-level send. No session check — callers enforce auth. */
export async function sendWhatsAppMessageInternal(
  phone: string,
  text: string,
  var1?: string,
  var2?: string
): Promise<ApiResult & { response?: string }> {
  if (!phone?.trim() || !text?.trim()) return { isOk: false, error: "Phone and text required" };
  const env = getEnv();
  if (!env.BHASHSMS_USER || !env.BHASHSMS_PASSWORD || !env.BHASHSMS_SENDER_ID) {
    return { isOk: false, error: "WhatsApp API not configured" };
  }
  const phoneClean = phone.replace(/\D/g, "");
  if (phoneClean.length < 10) return { isOk: false, error: "Invalid phone" };

  const url = new URL("https://bhashsms.com/api/sendmsg.php");
  url.searchParams.set("user", env.BHASHSMS_USER);
  url.searchParams.set("pass", env.BHASHSMS_PASSWORD);
  url.searchParams.set("sender", env.BHASHSMS_SENDER_ID);
  url.searchParams.set("phone", phoneClean);
  url.searchParams.set("text", text.trim());
  url.searchParams.set("priority", "wa");
  url.searchParams.set("stype", "normal");
  if (var1 != null) url.searchParams.set("var1", String(var1));
  if (var2 != null) url.searchParams.set("var2", String(var2));

  try {
    const res = await fetch(url.toString(), { method: "GET" });
    const body = await res.text();
    if (res.ok) return { isOk: true, message: "Message sent", response: body };
    return { isOk: false, error: `API error: ${body || res.status}` };
  } catch (e) {
    return { isOk: false, error: `Failed to send: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function isAdmin(p: Principal): boolean {
  return p.role === "developer" || p.role === "superadmin" || p.role === "admin";
}

export async function sendWhatsAppMessage(params: {
  sessionId?: string;
  phone?: string | string[];
  phones?: string | string[];
  text?: string;
}): Promise<ApiResult> {
  const principal = await resolvePrincipal(params.sessionId);
  if (!isAdmin(principal)) return { isOk: false, error: "Permission denied" };
  if (!params.text?.trim()) return { isOk: false, error: "Message text is required" };
  const env = getEnv();
  if (!env.BHASHSMS_USER || !env.BHASHSMS_PASSWORD || !env.BHASHSMS_SENDER_ID) {
    return { isOk: false, error: "WhatsApp API not configured. Set BHASHSMS_* env vars." };
  }
  const phoneList = normalizePhones(params.phones ?? params.phone);
  if (phoneList.length === 0) {
    return { isOk: false, error: "Phone number is required (you can enter multiple numbers separated by commas)" };
  }

  const results: Array<{ phone: string; isOk: boolean; error: string; response: string }> = [];
  let sent = 0, failed = 0;
  for (let i = 0; i < phoneList.length; i++) {
    const ph = phoneList[i];
    const r = await sendWhatsAppMessageInternal(ph, params.text);
    const resp = String((r as Record<string, unknown>).response ?? "");
    const err = String(r.error ?? "");
    results.push({ phone: ph, isOk: r.isOk === true, error: err, response: resp });
    if (r.isOk) sent++; else failed++;
    if (i < phoneList.length - 1) await new Promise((r) => setTimeout(r, 150));
  }
  return { isOk: failed === 0, sent, failed, results };
}

export async function sendBulkDonorLoginWhatsApp(params: {
  sessionId?: string;
}): Promise<ApiResult> {
  const principal = await resolvePrincipal(params.sessionId);
  if (!isAdmin(principal)) return { isOk: false, error: "Permission denied" };
  const env = getEnv();
  if (!env.BHASHSMS_USER || !env.BHASHSMS_PASSWORD || !env.BHASHSMS_SENDER_ID) {
    return { isOk: false, error: "WhatsApp API not configured" };
  }
  const donors = await sqlTyped<{ name: string; mobile: string }>`SELECT name, mobile FROM donors`;
  let sent = 0, failed = 0, skipped = 0;
  for (let i = 0; i < donors.length; i++) {
    const d = donors[i];
    const mobile = String(d.mobile ?? "").replace(/\D/g, "").slice(-10);
    if (mobile.length < 10) { skipped++; continue; }
    const phone = `91${mobile}`;
    const name = String(d.name ?? "").trim();
    const r = await sendWhatsAppMessageInternal(phone, DONOR_LOGIN_TEMPLATE, name, name);
    if (r.isOk) sent++; else failed++;
    if (i < donors.length - 1) await new Promise((r) => setTimeout(r, 200));
  }
  return { isOk: true, sent, failed, skipped, total: donors.length };
}

export async function sendDonorLoginWhatsApp(params: {
  sessionId?: string;
  phone?: string;
  name?: string;
}): Promise<ApiResult> {
  const principal = await resolvePrincipal(params.sessionId);
  if (!isAdmin(principal)) return { isOk: false, error: "Permission denied" };
  const env = getEnv();
  if (!env.BHASHSMS_USER || !env.BHASHSMS_PASSWORD || !env.BHASHSMS_SENDER_ID) {
    return { isOk: false, error: "WhatsApp API not configured" };
  }
  const mobile = String(params.phone ?? "").replace(/\D/g, "").slice(-10);
  if (mobile.length < 10) return { isOk: false, error: "Invalid phone number" };
  const fullPhone = `91${mobile}`;
  const donorName = String(params.name ?? "").trim();
  return sendWhatsAppMessageInternal(fullPhone, DONOR_LOGIN_TEMPLATE, donorName, donorName);
}

/** Format a date like the legacy Apps Script: "5 Jan 2026" (en-IN). */
function fmtSevaDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}

/**
 * Send pujari/cook reminders for a freshly-paid booking. Reads the seva's
 * notify_numbers CSV for each line item and combines all lines per phone —
 * one message per number: "ISKCON Seva reminder: <seva> - Qty: N for <date>. ..."
 * Best-effort — never throws (called from the booking create / verify flows).
 */
export async function sendSevaReminderWhatsApp(booking: { items: unknown; bookingDate?: string }): Promise<void> {
  try {
    let items = booking.items;
    if (typeof items === "string") {
      try { items = JSON.parse(items); } catch { return; }
    }
    if (!Array.isArray(items) || items.length === 0) return;

    const sevas = await sqlTyped<{ id: string; notify_numbers: string }>`
      SELECT id, notify_numbers FROM sevas WHERE notify_numbers <> ''
    `;
    const sevaMap = new Map(sevas.map((s) => [s.id, s.notify_numbers]));

    const bookingDate = String(booking.bookingDate ?? "") || new Date().toISOString().split("T")[0];
    const byPhone = new Map<string, string[]>();
    for (const raw of items) {
      const item = (raw ?? {}) as Record<string, unknown>;
      const sevaId = String(item.sevaId ?? item.id ?? "");
      const name = String(item.name ?? "Seva");
      const qty = Number(item.quantity ?? 1) || 1;
      const itemDate = fmtSevaDate(String(item.bookingDate ?? "") || bookingDate);
      const line = `${name} - Qty: ${qty} for ${itemDate}`;
      const notifyRaw = String(sevaMap.get(sevaId) ?? "").trim();
      if (!notifyRaw) continue;
      const numbers = notifyRaw
        .split(",")
        .map((n) => n.trim().replace(/\D/g, ""))
        .filter((n) => n.length >= 10);
      for (const n of numbers) {
        const arr = byPhone.get(n) ?? [];
        arr.push(line);
        byPhone.set(n, arr);
      }
    }

    const prefix = "ISKCON Seva reminder: ";
    let first = true;
    for (const [phone, lines] of byPhone) {
      if (!first) await new Promise((r) => setTimeout(r, 150)); // throttle
      first = false;
      const res = await sendWhatsAppMessageInternal(to91(phone), prefix + lines.join(". "));
      if (!res.isOk) console.error("sendSevaReminderWhatsApp send failed:", phone, res.error);
    }
  } catch (e) {
    console.error("sendSevaReminderWhatsApp:", e instanceof Error ? e.message : e);
  }
}

/** Send the donor login template to the donor of a freshly-paid booking. */
export async function sendDonorLoginTemplateForBooking(donorId: string): Promise<void> {
  try {
    if (!donorId) return;
    const d = await sqlTyped<{ name: string; mobile: string; whatsapp: string }>`
      SELECT name, mobile, whatsapp FROM donors WHERE id = ${donorId} LIMIT 1
    `;
    if (!d.length) return;
    const donor = d[0];
    const phone = (donor.whatsapp?.trim()) || (donor.mobile?.trim()) || "";
    if (phone.replace(/\D/g, "").length < 10) return;
    const donorName = String(donor.name ?? "").trim();
    await sendWhatsAppMessageInternal(to91(phone), DONOR_LOGIN_TEMPLATE, donorName, donorName);
  } catch (e) {
    console.error("sendDonorLoginTemplateForBooking:", e instanceof Error ? e.message : e);
  }
}
