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
  document
    .querySelectorAll(".razorpay-container, .razorpay-backdrop, iframe[name^='razorpay'], iframe[src*='razorpay']")
    .forEach((el) => el.remove());
}
