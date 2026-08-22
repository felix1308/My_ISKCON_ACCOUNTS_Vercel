"use client";

// ============================================================================
// Razorpay checkout helpers.
//
// checkout.js keeps its modal iframe alive in the DOM after close. When a
// second payment is opened on the same page (e.g. switching between centers
// that use different Razorpay accounts), the reused modal can keep showing
// the PREVIOUS order's UPI QR / merchant details. Removing the leftover DOM
// before opening forces a fresh render for the new order.
// ============================================================================

/** Remove any leftover Razorpay checkout modal DOM before a new open(). */
export function cleanupRazorpayModals(): void {
  if (typeof document === "undefined") return;
  // Only the visible modal overlay. Do NOT remove razorpay iframes — one of
  // them is checkout.js's internal communication frame; deleting it breaks
  // initialization entirely ("This browser is not supported" alert).
  document.querySelectorAll(".razorpay-container").forEach((el) => el.remove());
}
