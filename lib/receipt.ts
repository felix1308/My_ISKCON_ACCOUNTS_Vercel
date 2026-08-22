"use client";

// ============================================================================
// Acknowledgement receipt generator — port of generateReceipts/printReceipts
// from myiskcon.html. Opens a self-contained print window (window.open +
// document.write) with one A5-landscape receipt PER BOOKING ITEM.
//
// QR codes are generated INSIDE the print window: the qrcodejs CDN script is
// included in the written HTML and renders into placeholder divs there.
// Payload format: <bookingId>|<itemIndex>|<type>  (darshan | seva | prasadam)
// ============================================================================

export interface ReceiptBookingItem {
  id?: string;
  sevaId?: string;
  name?: string;
  amount?: number;
  quantity?: number;
}

export interface ReceiptBooking {
  __backendId: string;
  bookingDate: string;
  paymentStatus: string;
  paymentMode?: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  paidAt?: string;
  items: ReceiptBookingItem[];
}

export interface ReceiptDonor {
  name?: string;
  flat?: string;
  road?: string;
  po?: string;
  area?: string;
  pincode?: string;
  district?: string;
  state?: string;
  country?: string;
}

export interface ReceiptSeva {
  id: string;
  darshanQR?: string | boolean;
  sevaQR?: string | boolean;
  prasadamQR?: string | boolean;
}

// Theme colours for QR types (match legacy QR_COLOR_* constants).
const QR_COLOR_ENTRY = "#FF66C4";
const QR_COLOR_SEVA = "#FF914D";
const QR_COLOR_PRASADAM = "#8B5A6B";

const QRCODE_CDN = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function flagOn(v: string | boolean | undefined): boolean {
  return v === true || v === "true";
}

function buildReceiptHtml(
  booking: ReceiptBooking,
  donor: ReceiptDonor,
  item: ReceiptBookingItem,
  index: number,
  sevas: ReceiptSeva[]
): string {
  // QR codes are entry passes — only generate them when payment is proven.
  // Online bookings require a Razorpay payment id (HMAC-verified server-side);
  // cash/cheque/UPI are physically collected at the counter, so paid = proven.
  const statusPaid = (booking.paymentStatus || "pending").toLowerCase() === "paid";
  const mode = (booking.paymentMode || "online").toLowerCase();
  const paymentProven = statusPaid && (mode !== "online" || !!booking.razorpayPaymentId);
  const isPaid = paymentProven;
  const receiptNumber = `RCP-${booking.__backendId.substring(0, 8)}-${index + 1}`;
  const d = new Date(booking.bookingDate);
  const transactionDate = isNaN(d.getTime())
    ? esc(booking.bookingDate || "-")
    : d.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });
  const qty = item.quantity ?? 1;
  const amount = item.amount ?? 0;
  const totalForSeva = amount * qty;

  const address = [donor.flat, donor.road, donor.po, donor.area, donor.pincode, donor.district, donor.state, donor.country]
    .filter(Boolean).map(esc).join(", ");

  const isGeneralDonation =
    (item.id && item.id === "general_donation") ||
    (item.sevaId && String(item.sevaId).indexOf("general_donation") === 0);
  const seva = isGeneralDonation ? null : sevas.find((s) => s.id === item.sevaId) ?? null;

  const qrTypes: Array<{ type: string; label: string; color: string; bg: string; on: boolean }> = [
    { type: "darshan", label: "Entry", color: QR_COLOR_ENTRY, bg: "rgba(255,102,196,0.08)", on: !!seva && flagOn(seva.darshanQR) },
    { type: "seva", label: "Seva", color: QR_COLOR_SEVA, bg: "rgba(255,145,77,0.1)", on: !!seva && flagOn(seva.sevaQR) },
    { type: "prasadam", label: "Prasadam", color: QR_COLOR_PRASADAM, bg: "rgba(139,90,107,0.1)", on: !!seva && flagOn(seva.prasadamQR) },
  ];

  let qrSectionHTML = "";
  const enabledQr = isPaid ? qrTypes.filter((q) => q.on) : [];
  if (enabledQr.length > 0) {
    const parts = enabledQr.map((q) => {
      const payload = `${booking.__backendId}|${index}|${q.type}`;
      return `<div style="text-align:center;padding:8px;margin:0 6px;border:2px solid ${q.color};border-radius:8px;background:${q.bg};">` +
        `<p style="margin:0 0 4px 0;font-size:10px;font-weight:bold;color:${q.color};">${q.label}</p>` +
        `<div class="qr-box" data-payload="${esc(payload)}" data-color="${q.color}" ` +
        `style="width:90px;height:90px;margin:0 auto;display:flex;align-items:center;justify-content:center;"></div></div>`;
    });
    qrSectionHTML = `<div style="display:flex;justify-content:space-evenly;align-items:flex-start;gap:28px;margin:12px 0;flex-shrink:0;flex-wrap:wrap;">${parts.join("")}</div>`;
  }

  const paidRows = isPaid
    ? `<tr><td><strong>Razorpay Payment:</strong></td><td colspan="3" style="font-family:monospace;font-size:10px;word-break:break-all;">${esc(booking.razorpayPaymentId || "-")}</td></tr>` +
      `<tr><td><strong>Razorpay Order:</strong></td><td colspan="3" style="font-family:monospace;font-size:10px;word-break:break-all;">${esc(booking.razorpayOrderId || "-")}</td></tr>` +
      `<tr><td><strong>Paid At:</strong></td><td colspan="3">${booking.paidAt ? esc(new Date(booking.paidAt).toLocaleString("en-GB")) : "-"}</td></tr>`
    : "";

  const pendingNotice = isPaid
    ? ""
    : `<div style="margin:8px 0;padding:6px 10px;border:1px dashed #f59e0b;background:#fffbeb;color:#92400e;border-radius:6px;font-size:10px;text-align:center;flex-shrink:0;"><strong>${statusPaid ? "Online payment not verified" : "Payment pending"}:</strong> QR codes will appear only after payment is verified.</div>`;

  return `
    <div class="receipt" style="width:210mm;min-height:148mm;margin:8px auto;padding:16px;font-family:Arial, Helvetica, sans-serif;border:2px solid #c9a24d;border-radius:8px;background:#fffdf7;color:#333;box-sizing:border-box;display:flex;flex-direction:column;page-break-after:always;overflow:visible;">
      <div style="text-align:center;border-bottom:2px solid #c9a24d;padding-bottom:8px;flex-shrink:0;">
        <h2 style="margin:0;color:#7a4b00;font-size:16px;">ISKCON Cultural Centre</h2>
        <p style="margin:2px 0;font-size:11px;">International Society for Krishna Consciousness<br>Registered Trust | 80G &amp; 12A Approved</p>
      </div>
      <h3 style="text-align:center;margin:12px 0 8px 0;color:#5a3600;font-size:14px;flex-shrink:0;">Acknowledgment</h3>
      <table style="width:100%;font-size:11px;border-collapse:collapse;flex-shrink:0;margin-bottom:8px;">
        <tr><td><strong>Receipt No:</strong></td><td>${receiptNumber}</td><td><strong>Date:</strong></td><td>${transactionDate}</td></tr>
        <tr><td><strong>Seva:</strong></td><td>${esc(item.name || "-")}</td><td><strong>Qty:</strong></td><td>${qty}</td></tr>
        <tr><td><strong>Rate:</strong></td><td colspan="3">&#8377;${amount.toLocaleString("en-IN")}</td></tr>
        <tr><td><strong>Donor:</strong></td><td colspan="3">${esc(donor.name || "-")}</td></tr>
        ${address ? `<tr><td><strong>Address:</strong></td><td colspan="3">${address}</td></tr>` : ""}
        <tr><td><strong>Status:</strong></td><td colspan="3">${esc(booking.paymentStatus || "pending")}</td></tr>
        ${paidRows}
      </table>
      ${pendingNotice}
      ${qrSectionHTML}
      <div style="margin-top:auto;text-align:center;font-size:9px;">
        <p style="margin:3px 0;"><strong>Amount: &#8377;${totalForSeva.toLocaleString("en-IN")}</strong></p>
        <p style="margin:3px 0;font-style:italic;"><strong>Thank you for your support</strong></p>
      </div>
    </div>`;
}

/**
 * Open the receipt print window for a booking. Returns true on success,
 * false (with no side effects) when the popup was blocked or there's
 * nothing to print.
 */
export function openReceiptsWindow(
  booking: ReceiptBooking,
  donor: ReceiptDonor,
  sevas: ReceiptSeva[]
): boolean {
  const items = booking.items ?? [];
  if (items.length === 0) return false;

  const receiptsHTML = items
    .map((item, index) => buildReceiptHtml(booking, donor, item, index, sevas))
    .join("");

  // NOTE: this inline script runs inside the print window. It waits for the
  // qrcodejs CDN script to load, then renders a QR into every .qr-box div.
  const qrScript =
    "function renderQRCodes(){" +
    "  if (typeof QRCode === 'undefined') { setTimeout(renderQRCodes, 150); return; }" +
    "  var boxes = document.querySelectorAll('.qr-box');" +
    "  for (var i = 0; i < boxes.length; i++) {" +
    "    var el = boxes[i];" +
    "    if (el.getAttribute('data-done')) continue;" +
    "    el.setAttribute('data-done', '1');" +
    "    new QRCode(el, { text: el.getAttribute('data-payload'), width: 90, height: 90," +
    "      colorDark: el.getAttribute('data-color') || '#000000', colorLight: '#FFFFFF'," +
    "      correctLevel: QRCode.CorrectLevel.M });" +
    "  }" +
    "}" +
    "window.addEventListener('load', renderQRCodes);";

  const html =
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Acknowledgement Receipts</title>" +
    "<style>" +
    "@page { size: A5 landscape; margin: 0; }" +
    "body { margin: 0; padding: 8px; background: #f3f4f6; }" +
    ".toolbar { display: flex; gap: 8px; justify-content: flex-end; padding: 8px; position: sticky; top: 0;" +
    "  background: #fff; border-bottom: 1px solid #e5e7eb; margin-bottom: 8px; }" +
    ".toolbar button { padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; }" +
    ".btn-print { background: #16a34a; color: #fff; }" +
    ".btn-close { background: #d97706; color: #fff; }" +
    "@media print { .toolbar { display: none; } body { background: #fff; padding: 0; } }" +
    "</style>" +
    '<script src="' + QRCODE_CDN + '"></script>' +
    "</head><body>" +
    '<div class="toolbar">' +
    '<button class="btn-close" onclick="window.close()">Close</button>' +
    '<button class="btn-print" onclick="window.print()">Print All</button>' +
    "</div>" +
    '<div id="receipts-container" style="display:flex;flex-direction:column;align-items:center;gap:0;margin:0;padding:0;">' +
    receiptsHTML +
    "</div>" +
    "<script>" + qrScript + "</script>" +
    "</body></html>";

  const w = window.open("", "_blank", "height=600,width=900");
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}
