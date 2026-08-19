// ============================================================================
// Sessions — HMAC-signed opaque tokens, stored in the `sessions` table.
//
// The token sent to the client is `payload.signature` where payload is a
// base64url JSON of {sid, exp}. Verification recomputes the HMAC and looks up
// the row by stored_hash (sha256 of the full token) for revocation/expiry.
// ============================================================================

import { createHmac, createHash, randomBytes, timingSafeEqual as eq } from "node:crypto";
import { sql, sqlOne } from "./db";
import { getEnv } from "./env";
import type { ClientSession, Permissions, Role } from "./types";

const TOKEN_TTL_SECONDS = () => getEnv().SESSION_TIMEOUT_HOURS * 3600;

interface TokenPayload {
  sid: string; // opaque random id
  exp: number; // epoch seconds
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

function sign(payload: TokenPayload): string {
  const env = getEnv();
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", env.SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyTokenFormat(token: string): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const env = getEnv();
  const expected = createHmac("sha256", env.SESSION_SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !eq(a, b)) return null;
  try {
    const p = JSON.parse(b64urlDecode(body).toString("utf8")) as TokenPayload;
    if (typeof p.sid !== "string" || typeof p.exp !== "number") return null;
    return p;
  } catch {
    return null;
  }
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export interface CreateSessionInput {
  userId: string;
  username: string;
  role: Role;
  centerId: string;
  isDonor: boolean;
  permissions: Permissions;
  ipAddress: string;
  userAgent: string;
}

export async function createSession(
  input: CreateSessionInput
): Promise<ClientSession> {
  const sid = randomBytes(18).toString("hex");
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS();
  const token = sign({ sid, exp });
  const storedHash = sha256(token);
  const expiresAt = new Date(exp * 1000).toISOString();

  await sql`
    INSERT INTO sessions
      (session_id, stored_hash, user_id, username, role, center_id,
       is_donor, created_at, expires_at, ip_address, user_agent)
    VALUES
      (${token}, ${storedHash}, ${input.userId}, ${input.username},
       ${input.role}, ${input.centerId}, ${input.isDonor},
       now(), ${expiresAt}, ${input.ipAddress}, ${input.userAgent})
  `;

  return {
    sessionId: token,
    userId: input.userId,
    username: input.username,
    role: input.role,
    centerId: input.centerId,
    isDonor: input.isDonor,
    permissions: input.permissions,
    expiresAt,
  };
}

interface SessionRow {
  user_id: string;
  username: string;
  role: string;
  center_id: string;
  is_donor: boolean;
  expires_at: string;
}

/**
 * Look up a session by its token. Returns null if missing, expired, or
 * malformed. Deletes expired rows opportunistically.
 */
export async function getSession(token: string): Promise<SessionRow | null> {
  const payload = verifyTokenFormat(token);
  if (!payload) return null;
  if (payload.exp * 1000 < Date.now()) {
    await sql`DELETE FROM sessions WHERE stored_hash = ${sha256(token)}`;
    return null;
  }
  const row = await sqlOne<SessionRow>`
    SELECT user_id, username, role, center_id, is_donor, expires_at
    FROM sessions WHERE stored_hash = ${sha256(token)} LIMIT 1
  `;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await sql`DELETE FROM sessions WHERE stored_hash = ${sha256(token)}`;
    return null;
  }
  return row;
}

export async function deleteSession(token: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE stored_hash = ${sha256(token)}`;
}

export async function cleanupExpiredSessions(): Promise<number> {
  const res = await sql`DELETE FROM sessions WHERE expires_at < now() RETURNING id`;
  return res.length;
}
