// ============================================================================
// Database client — Neon serverless driver (HTTP fetch, serverless-friendly).
// Used by all API routes. Migrations/scripts use the direct connection in
// lib/db-direct.ts so they can run DDL.
// ============================================================================

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * The Neon tagged-template SQL client. Pooled over HTTP, ideal for Vercel
 * functions. Lazily initialized on first use so the module can be imported
 * at build time without a DATABASE_URL set.
 *
 * Usage:
 *   const rows = await sql`SELECT * FROM donors WHERE id = ${id}`;
 *
 * All interpolated values are parameterized — NEVER concatenate user input.
 */
let _sql: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL ?? "";
  if (!url) {
    throw new Error(
      "No database connection string was provided. Set DATABASE_URL in your environment."
    );
  }
  _sql = neon(url);
  return _sql;
}

/**
 * Tagged-template function that lazily creates the Neon client on first call.
 * This allows `import { sql } from './db'` at build time without a DATABASE_URL,
 * while still throwing clearly at request time if it's missing.
 */
export function sql(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<Record<string, unknown>[]> {
  return getSql()(strings, ...values) as Promise<Record<string, unknown>[]>;
}

/**
 * Execute a query and return the first row, or undefined.
 */
export async function sqlOne<T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T | undefined> {
  const rows = await sql(strings, ...values);
  return rows[0] as T | undefined;
}

/**
 * Typed query helper — Neon's `sql` tagged template doesn't accept a type
 * parameter, so this wraps it to give callers `T[]` rows. Use for SELECTs
 * where you want typed results:
 *   const rows = await sqlTyped<User>`SELECT * FROM users`;
 */
export async function sqlTyped<T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  const rows = await sql(strings, ...values);
  return rows as T[];
}

/**
 * Run a raw SQL string (no interpolation). Used by the db-push migration
 * script to execute statements parsed from schema.sql. NEVER pass user input.
 */
export async function sqlRaw(query: string): Promise<unknown[]> {
  // Neon's tagged template only accepts real tagged-template calls; for raw
  // strings we use the .query() method with no parameters.
  const sqlFn = getSql();
  return (sqlFn as unknown as { query: (text: string, params?: unknown[]) => Promise<unknown[]> })
    .query(query, []);
}

/**
 * Convert a Postgres row (snake_case columns) to camelCase for the API layer.
 * Only top-level keys are converted.
 */
export function toCamelRow<T = Record<string, unknown>>(
  row: Record<string, unknown>
): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[camel] = v;
  }
  return out as T;
}

export function toCamelRows<T = Record<string, unknown>>(
  rows: Record<string, unknown>[]
): T[] {
  return rows.map(toCamelRow) as T[];
}
