// ============================================================================
// Auth handlers — port of handleLogin / handleLogout / validateSession /
// handleChangePassword / handleResetDonorPassword / handleSelfRegister /
// handleApproveSelfSignup from Code.gs.
//
// Differences from legacy:
//   - Superadmin/developer hashes live in app_config (was PropertiesService).
//   - Password verification supports bcrypt AND legacy SHA-256, with
//     transparent rehash-to-bcrypt on the first successful legacy login.
//   - PAN/email are stored AES-256-GCM encrypted; we decrypt only for the
//     matching/masking boundary checks.
// ============================================================================

import { sql, sqlOne, sqlTyped } from "../db";
import { getEnv } from "../env";
import { addAuditLog } from "../audit";
import { AuthError, ForbiddenError } from "../errors";
import { decrypt, encrypt } from "../crypto";
import { hashPassword, verifyPassword, detectScheme } from "../password";
import { createSession, deleteSession } from "../sessions";
import {
  resolvePrincipal,
  principalToClientSession,
  getConfigFlag,
  setConfigFlag,
  getConfigValue,
} from "../context";
import { generateId } from "../ids";
import type { ApiResult, Permissions, Principal, Role } from "../types";

const SUPERADMIN_BACKEND_ID = "superadmin-001";
const DEVELOPER_BACKEND_ID = "developer-001";

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
}
function userAgent(req: Request): string {
  return req.headers.get("user-agent") ?? "";
}

function successUserPrincipal(
  backendId: string,
  type: "user" | "donor_user",
  username: string,
  role: Role,
  centerId: string,
  extras: Partial<Principal> = {}
): Principal {
  return {
    backendId,
    type,
    username,
    role,
    centerId,
    permissions: {},
    cashbooks: role === "superadmin" || role === "developer" ? "*" : [],
    expiresAt: new Date(Date.now() + getEnv().SESSION_TIMEOUT_HOURS * 3600_000).toISOString(),
    ...extras,
  };
}

// ---------------------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------------------

export async function handleLogin(params: {
  username?: string;
  password?: string;
}, req: Request): Promise<ApiResult> {
  const username = (params.username ?? "").trim();
  const password = params.password ?? "";
  const ip = clientIp(req);
  const ua = userAgent(req);
  const env = getEnv();

  if (!username || !password) {
    await addAuditLog({
      username,
      action: "LOGIN_ATTEMPT",
      resourceType: "user",
      details: "Missing credentials",
      ipAddress: ip,
      success: false,
    });
    return { isOk: false, error: "Username and password are required" };
  }

  // --- Developer (highest privilege; can detain superadmin) ---
  if (username === env.DEVELOPER_USERNAME && env.DEVELOPER_USERNAME) {
    const devHash = await getConfigValue("DEVELOPER_HASH");
    if (devHash) {
      const scheme = detectScheme(devHash);
      const { ok, needsRehash } = await verifyPassword(password, devHash, scheme);
      if (ok) {
        if (needsRehash) {
          const fresh = await hashPassword(password);
          await setConfigFlag("__DEVELOPER_HASH_REHASHED__", true);
          await sql`UPDATE app_config SET value = ${fresh} WHERE key = 'DEVELOPER_HASH'`;
        }
        const detained = await getConfigFlag("SUPERADMIN_DETAINED");
        const session = await createSession({
          userId: DEVELOPER_BACKEND_ID,
          username: env.DEVELOPER_USERNAME,
          role: "developer",
          centerId: "all_centers",
          isDonor: false,
          permissions: {},
          ipAddress: ip,
          userAgent: ua,
        });
        await addAuditLog({
          userId: DEVELOPER_BACKEND_ID,
          username: env.DEVELOPER_USERNAME,
          action: "LOGIN",
          resourceType: "user",
          resourceId: DEVELOPER_BACKEND_ID,
          details: "Developer login",
          ipAddress: ip,
        });
        return {
          isOk: true,
          sessionId: session.sessionId,
          user: {
            __backendId: DEVELOPER_BACKEND_ID,
            type: "user",
            username: env.DEVELOPER_USERNAME,
            role: "developer",
            centerId: "all_centers",
            permissions: "{}",
            cashbooks: "*",
            superadminDetained: detained,
          },
        };
      }
    }
    await addAuditLog({
      username: env.DEVELOPER_USERNAME,
      action: "LOGIN_FAILED",
      resourceType: "user",
      details: "Invalid developer password",
      ipAddress: ip,
      success: false,
    });
    return { isOk: false, error: "Invalid username or password" };
  }

  // --- Superadmin ---
  if (username === env.SUPERADMIN_USERNAME) {
    if (await getConfigFlag("SUPERADMIN_DETAINED")) {
      await addAuditLog({
        username: env.SUPERADMIN_USERNAME,
        action: "LOGIN_BLOCKED",
        resourceType: "user",
        details: "Superadmin access detained by developer",
        ipAddress: ip,
        success: false,
      });
      return {
        isOk: false,
        error: "Access temporarily restricted. Please contact the system developer.",
      };
    }
    const hash = await getConfigValue("SUPERADMIN_HASH");
    if (hash) {
      const scheme = detectScheme(hash);
      const { ok, needsRehash } = await verifyPassword(password, hash, scheme);
      if (ok) {
        if (needsRehash) {
          const fresh = await hashPassword(password);
          await sql`UPDATE app_config SET value = ${fresh} WHERE key = 'SUPERADMIN_HASH'`;
        }
        const session = await createSession({
          userId: SUPERADMIN_BACKEND_ID,
          username: env.SUPERADMIN_USERNAME,
          role: "superadmin",
          centerId: "all_centers",
          isDonor: false,
          permissions: {},
          ipAddress: ip,
          userAgent: ua,
        });
        await addAuditLog({
          userId: SUPERADMIN_BACKEND_ID,
          username: env.SUPERADMIN_USERNAME,
          action: "LOGIN",
          resourceType: "user",
          resourceId: SUPERADMIN_BACKEND_ID,
          details: "Superadmin login",
          ipAddress: ip,
        });
        return {
          isOk: true,
          sessionId: session.sessionId,
          user: {
            __backendId: SUPERADMIN_BACKEND_ID,
            type: "user",
            username: env.SUPERADMIN_USERNAME,
            role: "superadmin",
            centerId: "all_centers",
            permissions: "{}",
            cashbooks: "*",
          },
        };
      }
    }
    await addAuditLog({
      username: env.SUPERADMIN_USERNAME,
      action: "LOGIN_FAILED",
      resourceType: "user",
      details: "Invalid superadmin password",
      ipAddress: ip,
      success: false,
    });
    return { isOk: false, error: "Invalid username or password" };
  }

  // --- Regular user (admins / volunteers) ---
  const userRow = await sqlOne<{
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
  }>`
    SELECT id, username, password_hash, password_scheme, role, center_id,
           temple_id, department_id, permissions, cashbooks, is_active
    FROM users WHERE username = ${username} AND is_active = TRUE LIMIT 1
  `;

  if (userRow) {
    const scheme = (userRow.password_scheme as "bcrypt" | "legacy_sha256") || detectScheme(userRow.password_hash);
    const { ok, needsRehash } = await verifyPassword(password, userRow.password_hash, scheme);
    if (ok) {
      if (needsRehash) {
        const fresh = await hashPassword(password);
        await sql`UPDATE users SET password_hash = ${fresh}, password_scheme = 'bcrypt', updated_at = now() WHERE id = ${userRow.id}`;
      }

      // Resolve center via department if user has none (mirrors legacy logic).
      let resolvedCenterId = userRow.center_id ?? "";
      if (userRow.department_id && !resolvedCenterId) {
        const dept = await sqlOne<{ center_id: string | null }>`SELECT center_id FROM departments WHERE id = ${userRow.department_id} LIMIT 1`;
        if (dept?.center_id) resolvedCenterId = dept.center_id;
      }

      // jsonb may hold an object OR a (possibly legacy double-encoded) string.
      const parseJsonb = <T>(v: unknown, fallback: T): T => {
        if (v && typeof v === "object") return v as T;
        if (typeof v === "string") {
          try {
            const o = JSON.parse(v);
            if (o && typeof o === "object") return o as T;
          } catch { /* */ }
        }
        return fallback;
      };
      const perms = parseJsonb<Permissions>(userRow.permissions, {});
      const cashbooks = userRow.cashbooks === "*"
        ? "*"
        : parseJsonb<string[]>(userRow.cashbooks, []);

      const session = await createSession({
        userId: userRow.id,
        username: userRow.username,
        role: userRow.role as Role,
        centerId: resolvedCenterId,
        isDonor: false,
        permissions: perms,
        ipAddress: ip,
        userAgent: ua,
      });

      await addAuditLog({
        userId: userRow.id,
        username: userRow.username,
        action: "LOGIN",
        resourceType: "user",
        resourceId: userRow.id,
        details: "User login",
        ipAddress: ip,
      });

      return {
        isOk: true,
        sessionId: session.sessionId,
        user: {
          __backendId: userRow.id,
          type: "user",
          username: userRow.username,
          role: userRow.role,
          centerId: resolvedCenterId,
          templeId: userRow.temple_id ?? "",
          departmentId: userRow.department_id ?? "",
          permissions: JSON.stringify(perms),
          cashbooks: cashbooks === "*" ? "*" : JSON.stringify(cashbooks),
        },
      };
    }
  }

  // --- Donor login: match by name; verify password (hash if set, else legacy name fallback) ---
  const donorRow = await sqlOne<{
    id: string;
    name: string;
    password_hash: string;
    password_scheme: string;
    center_id: string | null;
    created_by: string;
    created_at: string;
  }>`
    SELECT id, name, password_hash, password_scheme, center_id, created_by, created_at
    FROM donors WHERE name = ${username} LIMIT 1
  `;

  if (donorRow) {
    let donorOk = false;
    if (donorRow.password_hash) {
      const scheme = (donorRow.password_scheme as "bcrypt" | "legacy_sha256") || detectScheme(donorRow.password_hash);
      const { ok, needsRehash } = await verifyPassword(password, donorRow.password_hash, scheme);
      if (ok) {
        donorOk = true;
        if (needsRehash) {
          const fresh = await hashPassword(password);
          await sql`UPDATE donors SET password_hash = ${fresh}, password_scheme = 'bcrypt', updated_at = now() WHERE id = ${donorRow.id}`;
        }
      }
    } else if (donorRow.name === password) {
      // Legacy fallback: password = donor name when no hash is set.
      donorOk = true;
    }

    if (donorOk) {
      // Self-signup accounts: allow login for 3 days, then require admin approval.
      if (donorRow.created_by === "self-signup") {
        const daysSince = (Date.now() - new Date(donorRow.created_at).getTime()) / 86_400_000;
        if (daysSince > 3) {
          await addAuditLog({
            userId: donorRow.id,
            username: donorRow.name,
            action: "LOGIN_FAILED",
            resourceType: "donor",
            resourceId: donorRow.id,
            details: "Self-signup account pending admin approval",
            ipAddress: ip,
            success: false,
          });
          return {
            isOk: false,
            error: "Your account is pending admin approval. Please contact the temple office.",
          };
        }
      }

      const session = await createSession({
        userId: donorRow.id,
        username: donorRow.name,
        role: "donor",
        centerId: donorRow.center_id ?? "",
        isDonor: true,
        permissions: {},
        ipAddress: ip,
        userAgent: ua,
      });

      await addAuditLog({
        userId: donorRow.id,
        username: donorRow.name,
        action: "LOGIN",
        resourceType: "donor",
        resourceId: donorRow.id,
        details: "Donor login",
        ipAddress: ip,
      });

      // Reuse resolvePrincipal to build the sanitized donor payload.
      const principal = await resolvePrincipal(session.sessionId);
      return {
        isOk: true,
        sessionId: session.sessionId,
        user: {
          __backendId: principal.backendId,
          type: "donor_user",
          username: principal.username,
          role: "donor",
          donorId: principal.donorId,
          centerId: principal.centerId,
          permissions: "{}",
          donorData: principal.donorData,
        },
      };
    }
  }

  await addAuditLog({
    username,
    action: "LOGIN_FAILED",
    resourceType: "user",
    details: "Invalid credentials",
    ipAddress: ip,
    success: false,
  });
  return { isOk: false, error: "Invalid username or password" };
}

// ---------------------------------------------------------------------------
// LOGOUT
// ---------------------------------------------------------------------------

export async function handleLogout(params: { sessionId?: string }): Promise<ApiResult> {
  if (params.sessionId) {
    try {
      const principal = await resolvePrincipal(params.sessionId);
      await addAuditLog({
        userId: principal.backendId,
        username: principal.username,
        action: "LOGOUT",
        resourceType: "user",
        resourceId: principal.backendId,
        details: "User logout",
        success: true,
      });
    } catch {
      // Session may already be invalid — logout is still a success.
    }
    await deleteSession(params.sessionId);
  }
  return { isOk: true };
}

// ---------------------------------------------------------------------------
// VALIDATE SESSION
// ---------------------------------------------------------------------------

export async function handleValidateSession(params: { sessionId?: string }): Promise<ApiResult> {
  if (!params.sessionId) return { isOk: false, error: "No session ID provided" };
  try {
    const principal = await resolvePrincipal(params.sessionId);
    const client = principalToClientSession(principal, params.sessionId);
    return {
      isOk: true,
      user: {
        __backendId: principal.backendId,
        type: principal.type,
        username: principal.username,
        role: principal.role,
        centerId: principal.centerId,
        templeId: principal.templeId ?? "",
        departmentId: principal.departmentId ?? "",
        donorId: principal.donorId,
        permissions: JSON.stringify(principal.permissions),
        cashbooks: principal.cashbooks === "*" ? "*" : JSON.stringify(principal.cashbooks),
        superadminDetained: principal.superadminDetained,
        donorData: principal.donorData,
        // Echo the client session for the React app to refresh from.
        session: client,
      },
    };
  } catch (e) {
    return { isOk: false, error: e instanceof Error ? e.message : "Invalid session" };
  }
}

// ---------------------------------------------------------------------------
// CHANGE PASSWORD
// ---------------------------------------------------------------------------

export async function handleChangePassword(params: {
  sessionId?: string;
  currentPassword?: string;
  newPassword?: string;
}, req: Request): Promise<ApiResult> {
  const ip = clientIp(req);
  const principal = await resolvePrincipal(params.sessionId);
  const current = params.currentPassword ?? "";
  const next = params.newPassword ?? "";
  if (!current || !next) return { isOk: false, error: "Current and new passwords are required" };
  if (next.length < 6) return { isOk: false, error: "New password must be at least 6 characters" };

  // Developer / superadmin hashes live in app_config.
  if (principal.role === "developer" || principal.role === "superadmin") {
    const key = principal.role === "developer" ? "DEVELOPER_HASH" : "SUPERADMIN_HASH";
    const stored = await getConfigValue(key);
    if (!stored) return { isOk: false, error: "Current password is incorrect" };
    const scheme = detectScheme(stored);
    const { ok, needsRehash } = await verifyPassword(current, stored, scheme);
    if (!ok) {
      await addAuditLog({
        userId: principal.backendId,
        username: principal.username,
        action: "PASSWORD_CHANGE_FAILED",
        resourceType: "user",
        resourceId: principal.backendId,
        details: "Invalid current password",
        ipAddress: ip,
        success: false,
      });
      return { isOk: false, error: "Current password is incorrect" };
    }
    const fresh = await hashPassword(next);
    await sql`UPDATE app_config SET value = ${fresh}, updated_at = now() WHERE key = ${key}`;
    void needsRehash; // legacy already handled by storing bcrypt above
    await addAuditLog({
      userId: principal.backendId,
      username: principal.username,
      action: "PASSWORD_CHANGE",
      resourceType: "user",
      resourceId: principal.backendId,
      details: `${principal.role} password changed`,
      ipAddress: ip,
    });
    return { isOk: true, message: "Password changed successfully" };
  }

  // Regular user or donor.
  const isDonor = principal.type === "donor_user";
  const row = isDonor
    ? await sqlOne<{ password_hash: string; password_scheme: string }>`
        SELECT password_hash, password_scheme FROM donors WHERE id = ${principal.backendId} LIMIT 1
      `
    : await sqlOne<{ password_hash: string; password_scheme: string }>`
        SELECT password_hash, password_scheme FROM users WHERE id = ${principal.backendId} LIMIT 1
      `;
  if (!row) return { isOk: false, error: "Account not found" };
  const scheme = (row.password_scheme as "bcrypt" | "legacy_sha256") || detectScheme(row.password_hash);
  const { ok } = await verifyPassword(current, row.password_hash, scheme);
  if (!ok) {
    await addAuditLog({
      userId: principal.backendId,
      username: principal.username,
      action: "PASSWORD_CHANGE_FAILED",
      resourceType: isDonor ? "donor" : "user",
      resourceId: principal.backendId,
      details: "Invalid current password",
      ipAddress: ip,
      success: false,
    });
    return { isOk: false, error: "Current password is incorrect" };
  }
  const fresh = await hashPassword(next);
  if (isDonor) {
    await sql`UPDATE donors SET password_hash = ${fresh}, password_scheme = 'bcrypt', updated_at = now() WHERE id = ${principal.backendId}`;
  } else {
    await sql`UPDATE users SET password_hash = ${fresh}, password_scheme = 'bcrypt', updated_at = now() WHERE id = ${principal.backendId}`;
  }
  await addAuditLog({
    userId: principal.backendId,
    username: principal.username,
    action: "PASSWORD_CHANGE",
    resourceType: principal.type === "donor_user" ? "donor" : "user",
    resourceId: principal.backendId,
    details: "Password changed",
    ipAddress: ip,
  });
  return { isOk: true, message: "Password changed successfully" };
}

// ---------------------------------------------------------------------------
// RESET DONOR PASSWORD (self-service, no session)
// ---------------------------------------------------------------------------

export async function handleResetDonorPassword(params: {
  identifier?: string;
  newPassword?: string;
  ipAddress?: string;
}, req: Request): Promise<ApiResult> {
  const identifier = (params.identifier ?? "").trim().toUpperCase();
  const next = params.newPassword ?? "";
  const ip = params.ipAddress ?? clientIp(req);
  if (!identifier || !next) return { isOk: false, error: "Identifier and new password are required" };
  if (next.length < 6) return { isOk: false, error: "Password must be at least 6 characters" };

  // Match by PAN (decrypt and compare) or mobile (last 10 digits).
  // We can't index on encrypted PAN, so we scan — donor count is modest (~3.7k)
  // and this is a low-frequency self-service endpoint.
  const mobile10 = identifier.replace(/\D/g, "").slice(-10);
  const rows = await sqlTyped<{ id: string; name: string; pan: string; mobile: string }>`
    SELECT id, name, pan, mobile FROM donors
  `;
  let matched: { id: string; name: string } | null = null;
  for (const r of rows) {
    if (mobile10.length === 10 && r.mobile && r.mobile.replace(/\D/g, "").slice(-10) === mobile10) {
      matched = r;
      break;
    }
    if (r.pan) {
      try {
        const panPlain = decrypt(r.pan).toUpperCase();
        if (panPlain === identifier) { matched = r; break; }
      } catch {
        // ignore decrypt errors
      }
    }
  }

  if (!matched) {
    await addAuditLog({
      username: params.identifier,
      action: "PASSWORD_RESET_FAILED",
      resourceType: "donor",
      details: "Donor not found",
      ipAddress: ip,
      success: false,
    });
    return { isOk: false, error: "No donor found with that PAN or mobile number" };
  }

  const fresh = await hashPassword(next);
  await sql`UPDATE donors SET password_hash = ${fresh}, password_scheme = 'bcrypt', updated_at = now() WHERE id = ${matched.id}`;
  await addAuditLog({
    userId: matched.id,
    username: matched.name,
    action: "PASSWORD_RESET",
    resourceType: "donor",
    resourceId: matched.id,
    details: "Donor self-service password reset",
    ipAddress: ip,
  });
  return { isOk: true, donorName: matched.name };
}

// ---------------------------------------------------------------------------
// SELF REGISTER (no session)
// ---------------------------------------------------------------------------

export async function handleSelfRegister(params: {
  record?: Record<string, unknown>;
  ipAddress?: string;
}, req: Request): Promise<ApiResult> {
  const rec = params.record ?? {};
  const ip = params.ipAddress ?? clientIp(req);
  const name = String(rec.name ?? "").trim();
  const mobile = String(rec.mobile ?? "").trim();
  const pan = String(rec.pan ?? "").trim().toUpperCase();

  if (!name) return { isOk: false, error: "Legal name is required" };
  if (!mobile) return { isOk: false, error: "Mobile number is required" };
  if (!/^\d{10}$/.test(mobile.replace(/^\+91/, ""))) return { isOk: false, error: "Enter a valid 10-digit mobile number" };
  if (!pan) return { isOk: false, error: "PAN number is required" };
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return { isOk: false, error: "Enter a valid PAN number (e.g. ABCDE1234F)" };

  const mobile10 = mobile.replace(/^\+91/, "").replace(/\D/g, "").slice(-10);

  // Duplicate check on mobile and PAN (PAN scan is unavoidable since encrypted).
  const existing = await sqlTyped<{ mobile: string; pan: string }>`SELECT mobile, pan FROM donors`;
  for (const d of existing) {
    if (d.mobile && d.mobile.replace(/\D/g, "").slice(-10) === mobile10) {
      return { isOk: false, error: "A donor account with this mobile number already exists. Please login or reset your password." };
    }
    if (d.pan) {
      try {
        if (decrypt(d.pan).toUpperCase() === pan) {
          return { isOk: false, error: "A donor account with this PAN number already exists. Please login or reset your password." };
        }
      } catch { /* ignore */ }
    }
  }

  // Assign to first active center.
  const c = await sqlOne<{ id: string }>`SELECT id FROM centers WHERE is_active = TRUE ORDER BY created_at LIMIT 1`;
  const centerId = c?.id ?? "";
  const id = generateId("donor");
  const now = new Date().toISOString();

  await sql`
    INSERT INTO donors
      (id, name, spiritual_name, indian_passport, pan, mobile, whatsapp, email,
       flat, road, po, area, pincode, district, state, country, tally_name,
       center_id, password_hash, password_scheme, created_by, created_at, updated_at)
    VALUES
      (${id}, ${name}, ${String(rec.spiritualName ?? "").trim()},
       ${rec.indianPassport === true || rec.indianPassport === "true"},
       ${encrypt(pan)}, ${mobile}, ${String(rec.whatsapp ?? "").trim() || mobile},
       ${encrypt(String(rec.email ?? "").trim())},
       ${String(rec.flat ?? "").trim()}, ${String(rec.road ?? "").trim()},
       ${String(rec.po ?? "").trim()}, ${String(rec.area ?? "").trim()},
       ${String(rec.pincode ?? "").trim()}, ${String(rec.district ?? "").trim()},
       ${String(rec.state ?? "").trim()}, ${String(rec.country ?? "India").trim()},
       "", ${centerId}, ${await hashPassword(mobile)}, 'bcrypt', 'self-signup', ${now}, ${now})
  `;
  await addAuditLog({
    userId: id,
    username: name,
    action: "SELF_REGISTER",
    resourceType: "donor",
    resourceId: id,
    details: "Devotee self-registration",
    ipAddress: ip,
  });
  return { isOk: true, donorName: name };
}

// ---------------------------------------------------------------------------
// APPROVE SELF SIGNUP (admin/superadmin)
// ---------------------------------------------------------------------------

export async function handleApproveSelfSignup(params: {
  sessionId?: string;
  donorId?: string;
  ipAddress?: string;
}, req: Request): Promise<ApiResult> {
  const principal = await resolvePrincipal(params.sessionId);
  if (principal.role === "donor") throw new ForbiddenError("Only admins can approve signup accounts");
  const donorId = params.donorId;
  if (!donorId) return { isOk: false, error: "donorId is required" };

  const row = await sqlOne<{ created_by: string; name: string }>`
    SELECT created_by, name FROM donors WHERE id = ${donorId} LIMIT 1
  `;
  if (!row) return { isOk: false, error: "Donor not found" };
  if (row.created_by !== "self-signup") return { isOk: false, error: "This account is not a pending self-signup" };

  await sql`UPDATE donors SET created_by = 'approved', updated_at = now() WHERE id = ${donorId}`;
  await addAuditLog({
    userId: principal.backendId,
    username: principal.username,
    action: "APPROVE_SIGNUP",
    resourceType: "donor",
    resourceId: donorId,
    details: "Admin approved self-signup account",
    ipAddress: params.ipAddress ?? clientIp(req),
  });
  return { isOk: true, donorName: row.name };
}

// Re-exports for the dispatcher / other handlers.
export { AuthError, setConfigFlag, getConfigFlag };
