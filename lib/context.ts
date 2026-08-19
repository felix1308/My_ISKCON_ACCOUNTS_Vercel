// ============================================================================
// Request context — resolves the caller (user/donor/superadmin/developer)
// from the request's sessionId, applying the same precedence and masking
// rules as the legacy validateSession().
// ============================================================================

import { sql, sqlOne } from "./db";
import { getSession } from "./sessions";
import { getEnv } from "./env";
import { AuthError } from "./errors";
import { decrypt, maskPAN } from "./crypto";
import { toCamelRow } from "./db";
import type {
  Permissions,
  Role,
  User,
  Donor,
  ClientSession,
  Principal,
} from "./types";

export type { Principal };

export interface SanitizedDonor extends Omit<Donor, "pan"> {
  panMasked?: string;
  [k: string]: unknown;
}

interface RawUserRow {
  id: string;
  username: string;
  password_hash: string;
  password_scheme: string;
  role: string;
  center_id: string | null;
  temple_id: string | null;
  department_id: string | null;
  permissions: unknown;
  cashbooks: unknown;
  is_active: boolean;
}

interface RawDonorRow {
  id: string;
  name: string;
  spiritual_name: string;
  indian_passport: boolean;
  pan: string;
  mobile: string;
  whatsapp: string;
  email: string;
  flat: string;
  road: string;
  po: string;
  area: string;
  pincode: string;
  district: string;
  state: string;
  country: string;
  tally_name: string;
  center_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function parsePermissions(p: unknown): Permissions {
  if (p && typeof p === "object") return p as Permissions;
  if (typeof p === "string") {
    try {
      const o = JSON.parse(p);
      return (o && typeof o === "object" ? o : {}) as Permissions;
    } catch {
      return {};
    }
  }
  return {};
}

function parseCashbooks(c: unknown): string[] | "*" {
  if (c === "*") return "*";
  if (Array.isArray(c)) return c as string[];
  if (typeof c === "string" && c.trim() === "*") return "*";
  if (typeof c === "string" && c.trim() !== "") {
    try {
      const o = JSON.parse(c);
      if (Array.isArray(o)) return o as string[];
    } catch {
      return c.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function sanitizeDonor(row: RawDonorRow): SanitizedDonor {
  const donor = toCamelRow<Donor>(row as unknown as Record<string, unknown>);
  // pan is stored encrypted (AES-GCM or legacy XOR). Decrypt only to mask for
  // the client — never return the full plaintext to the donor themselves.
  let panMasked: string | undefined;
  try {
    const panPlain = decrypt(row.pan);
    if (panPlain) panMasked = maskPAN(panPlain);
  } catch {
    panMasked = "******";
  }
  const { pan: _drop, ...rest } = donor;
  void _drop;
  return { ...rest, panMasked } as SanitizedDonor;
}

/**
 * Resolve a principal from a sessionId. Throws AuthError if the session is
 * missing/expired. Returns null only if sessionId was empty (for unauthed
 * endpoints to opt in).
 */
export async function resolvePrincipal(
  sessionId: string | undefined
): Promise<Principal> {
  if (!sessionId) throw new AuthError("No session ID provided");

  const session = await getSession(sessionId);
  if (!session) throw new AuthError("Invalid or expired session");

  const env = getEnv();

  // Developer (highest privilege; can detain superadmin).
  if (session.role === "developer") {
    const detained = await getConfigFlag("SUPERADMIN_DETAINED");
    return {
      backendId: "developer-001",
      type: "user",
      username: session.username,
      role: "developer",
      centerId: "all_centers",
      permissions: {},
      cashbooks: "*",
      superadminDetained: detained,
      expiresAt: session.expires_at,
    };
  }

  // Superadmin
  if (session.role === "superadmin") {
    return {
      backendId: "superadmin-001",
      type: "user",
      username: session.username,
      role: "superadmin",
      centerId: "all_centers",
      permissions: {},
      cashbooks: "*",
      expiresAt: session.expires_at,
    };
  }

  // Donor
  if (session.role === "donor") {
    const row = await sqlOne<RawDonorRow>`
      SELECT id, name, spiritual_name, indian_passport, pan, mobile, whatsapp,
             email, flat, road, po, area, pincode, district, state, country,
             tally_name, center_id, created_by, created_at, updated_at
      FROM donors WHERE id = ${session.user_id} LIMIT 1
    `;
    if (!row) throw new AuthError("User not found");
    return {
      backendId: row.id,
      type: "donor_user",
      username: session.username,
      role: "donor",
      donorId: row.id,
      centerId: row.center_id ?? "",
      permissions: {},
      cashbooks: [],
      donorData: sanitizeDonor(row),
      expiresAt: session.expires_at,
    };
  }

  // Regular user (admin / volunteer / etc.)
  const u = await sqlOne<RawUserRow>`
    SELECT id, username, password_hash, password_scheme, role, center_id,
           temple_id, department_id, permissions, cashbooks, is_active
    FROM users WHERE id = ${session.user_id} LIMIT 1
  `;
  if (!u || !u.is_active) throw new AuthError("User not found or inactive");

  let resolvedCenterId = u.center_id ?? "";
  if (u.department_id && !resolvedCenterId) {
    const dept = await sqlOne<{ center_id: string | null }>`
      SELECT center_id FROM departments WHERE id = ${u.department_id} LIMIT 1
    `;
    if (dept?.center_id) resolvedCenterId = dept.center_id;
  }

  return {
    backendId: u.id,
    type: "user",
    username: u.username,
    role: u.role as Role,
    centerId: resolvedCenterId,
    templeId: u.temple_id ?? "",
    departmentId: u.department_id ?? "",
    permissions: parsePermissions(u.permissions),
    cashbooks: parseCashbooks(u.cashbooks),
    expiresAt: session.expires_at,
  };
}

// ---------- app_config helpers ----------

export async function getConfigFlag(key: string): Promise<boolean> {
  const row = await sqlOne<{ value: string }>`SELECT value FROM app_config WHERE key = ${key}`;
  return row?.value === "true";
}

export async function setConfigFlag(key: string, value: boolean): Promise<void> {
  await sql`
    INSERT INTO app_config (key, value, updated_at) VALUES (${key}, ${value ? "true" : "false"}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
}

export async function getConfigValue(key: string): Promise<string | null> {
  const row = await sqlOne<{ value: string }>`SELECT value FROM app_config WHERE key = ${key}`;
  return row?.value ?? null;
}

export async function setConfigValue(key: string, value: string): Promise<void> {
  await sql`
    INSERT INTO app_config (key, value, updated_at) VALUES (${key}, ${value}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
}

/** Convert a Principal into the ClientSession shape for the frontend. */
export function principalToClientSession(
  principal: Principal,
  sessionId: string
): ClientSession {
  return {
    sessionId,
    userId: principal.donorId ?? principal.backendId,
    username: principal.username,
    role: principal.role,
    centerId: principal.centerId,
    isDonor: principal.type === "donor_user",
    permissions: principal.permissions,
    expiresAt: principal.expiresAt,
  };
}
