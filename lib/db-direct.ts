// ============================================================================
// Direct (non-pooled) database client for migrations and scripts.
// Uses DATABASE_URL_DIRECT when available, else falls back to DATABASE_URL.
// Lazily initialized so the module can be imported at build time.
// ============================================================================

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let _directSql: NeonQueryFunction<false, false> | null = null;

/**
 * Returns a SQL tagged-template function suitable for running schema.sql and
 * one-off admin scripts. In production this should run on a long-lived
 * process (your local machine via `npm run db:push`), not in a serverless fn.
 */
export function directSql(): NeonQueryFunction<false, false> {
  if (_directSql) return _directSql;
  const conn = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL || "";
  if (!conn) {
    throw new Error(
      "No database connection string. Set DATABASE_URL_DIRECT or DATABASE_URL."
    );
  }
  _directSql = neon(conn);
  return _directSql;
}
