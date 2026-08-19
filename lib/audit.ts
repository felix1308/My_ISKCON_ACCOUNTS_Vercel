// ============================================================================
// Audit log — mirrors addAuditLog() in Code.gs. Writes are skipped when
// AUDIT_LOG_ENABLED=false or when the action is in the skip list, to keep
// request latency low on the hot path (matches legacy behavior).
// ============================================================================

import { sql } from "./db";
import { tryGetEnv } from "./env";

const DEFAULT_SKIP = new Set(["UPDATE", "LOGIN", "LOGOUT", "GET_ALL_DATA"]);

export interface AuditInput {
  userId?: string | null;
  username?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown> | string;
  ipAddress?: string;
  success?: boolean;
}

export async function addAuditLog(input: AuditInput): Promise<void> {
  const env = tryGetEnv();
  if (env && !env.AUDIT_LOG_ENABLED) return;
  if (DEFAULT_SKIP.has(input.action)) return;

  const details =
    typeof input.details === "string"
      ? { message: input.details }
      : input.details ?? {};

  try {
    await sql`
      INSERT INTO audit_log
        (user_id, username, action, resource_type, resource_id,
         details, ip_address, success)
      VALUES
        (${input.userId ?? ""}, ${input.username ?? ""}, ${input.action},
         ${input.resourceType ?? ""}, ${input.resourceId ?? ""},
         ${JSON.stringify(details)}::jsonb, ${input.ipAddress ?? ""},
         ${input.success ?? true})
    `;
  } catch {
    // Audit log must never break the request — matches legacy behavior.
  }
}
