// ============================================================================
// Shared display-formatting helpers (client + server safe).
// ============================================================================

/**
 * Formats a stored date value for display.
 * Accepts `YYYY-MM-DD` or full ISO strings (`...T...Z`). Anything else —
 * empty strings, legacy garbage like "Receipt", "SJ - DONATION RECEIPT" —
 * renders as the fallback (default "N/A").
 */
export function formatDate(value: unknown, fallback = "N/A"): string {
  const d = String(value ?? "").split("T")[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : fallback;
}

/** True if the value is a displayable YYYY-MM-DD date (used for sorting). */
export function isDisplayableDate(value: unknown): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "").split("T")[0]);
}
