// ============================================================================
// Password hashing — bcrypt (modern) + legacy SHA-256 verification for
// migrated users. On the first successful login with a legacy hash, we
// transparently rehash to bcrypt so the legacy scheme disappears over time.
// ============================================================================

import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { getEnv } from "./env";

const BCRYPT_ROUNDS = 12;

export type PasswordScheme = "bcrypt" | "legacy_sha256";

/** Hash a plaintext password with bcrypt. */
export function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

/**
 * Verify a plaintext password against a stored hash, supporting both schemes.
 * Returns true if it matches (and `needsRehash` is true when the stored hash
 * was the legacy SHA-256 scheme and should be upgraded to bcrypt).
 */
export async function verifyPassword(
  plaintext: string,
  storedHash: string,
  scheme: PasswordScheme
): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (!storedHash) return { ok: false, needsRehash: false };

  if (scheme === "bcrypt") {
    // bcrypt hashes start with $2 — only valid bcrypt input should reach this.
    try {
      const ok = await bcrypt.compare(plaintext, storedHash);
      return { ok, needsRehash: false };
    } catch {
      return { ok: false, needsRehash: false };
    }
  }

  // Legacy SHA-256 with salt — mirrors hashPassword() in Code.gs.
  const env = getEnv();
  const salted = env.LEGACY_PASSWORD_SALT + plaintext + env.LEGACY_PASSWORD_SALT;
  const computed = createHash("sha256").update(salted, "utf8").digest("hex");
  // Constant-time-ish compare.
  const ok =
    computed.length === storedHash.length &&
    timingSafeEqual(computed, storedHash);
  return { ok, needsRehash: scheme === "legacy_sha256" };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Detect scheme from a stored hash string when the column is missing. */
export function detectScheme(storedHash: string): PasswordScheme {
  if (/^\$2[abxy]\$\d+\$/.test(storedHash)) return "bcrypt";
  return "legacy_sha256";
}
