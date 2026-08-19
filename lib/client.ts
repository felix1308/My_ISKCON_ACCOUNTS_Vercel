// ============================================================================
// Client-side API client — mirrors the legacy apiClient in myiskcon.html.
// Uses POST with JSON body (no CORS issues since we're same-origin on Vercel).
// ============================================================================

import type { ApiResult, ClientSession } from "@/lib/types";

const API_URL = "/api/rpc";

/** The session object stored in localStorage. */
const SESSION_KEY = "myiskcon_session";

export function getStoredSession(): ClientSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ClientSession;
  } catch {
    return null;
  }
}

export function setStoredSession(s: ClientSession): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function clearStoredSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SESSION_KEY);
}

/**
 * Call a backend action. Throws on network failure; returns the ApiResult
 * envelope on success (caller checks `isOk`).
 */
export async function callApi(
  action: string,
  params: Record<string, unknown> = {}
): Promise<ApiResult> {
  const session = getStoredSession();
  const payload = { action, sessionId: session?.sessionId ?? "", ...params };

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await res.json()) as ApiResult;

    // Auto-clear session on auth errors.
    if (!result.isOk && typeof result.error === "string" && /session/i.test(result.error)) {
      clearStoredSession();
    }

    return result;
  } catch (e) {
    return {
      isOk: false,
      error: e instanceof Error ? e.message : "Network error",
    };
  }
}

/** Convenience wrapper that throws on !isOk, returning the result data. */
export async function api<T = unknown>(
  action: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const result = await callApi(action, params);
  if (!result.isOk) {
    throw new Error((result as { error?: string }).error || "Request failed");
  }
  return result as unknown as T;
}
