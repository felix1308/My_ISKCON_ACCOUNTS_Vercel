// ============================================================================
// Crypto — at-rest encryption for sensitive fields (PAN, email, gateway keys).
//
// Modern: AES-256-GCM with a 32-byte key from ENCRYPTION_KEY_HEX.
//   Ciphertext format (string, base64):  b64(iv[12] || tag[16] || ciphertext)
//
// Legacy (for migration only): the old Apps Script backend used a XOR cipher
// with a repeating key, then base64-encoded the result. We decrypt with the
// old LEGACY_ENCRYPTION_KEY once during migration and re-encrypt with AES-GCM.
//
// IMPORTANT: never log plaintext PAN/email. Decrypt only at the API boundary
// and only for callers who are authorized to see it.
// ============================================================================

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { getEnv } from "./env";

const IV_LEN = 12; // GCM standard 96-bit IV
const TAG_LEN = 16;

function getKey(): Buffer {
  const env = getEnv();
  return Buffer.from(env.ENCRYPTION_KEY_HEX, "hex"); // exactly 32 bytes
}

/** Encrypt a UTF-8 string to a base64 ciphertext string (iv+tag+cipher). */
export function encrypt(plaintext: string): string {
  if (plaintext === "" || plaintext == null) return "";
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/** Decrypt a base64 ciphertext string back to the UTF-8 plaintext. */
export function decrypt(b64: string): string {
  if (!b64) return "";
  const buf = Buffer.from(b64, "base64");
  if (buf.length < IV_LEN + TAG_LEN) {
    // Not a GCM ciphertext — probably a legacy XOR blob. Try legacy.
    return decryptLegacy(b64);
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
}

// ---------------------------------------------------------------------------
// Legacy XOR + base64 (mirrors encryptText/decryptText in Code.gs).
// Used ONLY to read migrated rows during the one-time migration, and as a
// fallback in decrypt() for rows not yet re-encrypted.
// ---------------------------------------------------------------------------

function getKeyLegacy(): string {
  return getEnv().LEGACY_ENCRYPTION_KEY;
}

export function decryptLegacy(b64: string): string {
  if (!b64) return "";
  const bytes = Buffer.from(b64, "base64");
  const key = getKeyLegacy();
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(
      bytes[i] ^ key.charCodeAt(i % key.length)
    );
  }
  return out;
}

/**
 * Mask a PAN for display: first 2 + last 4, middle hidden.
 * "ALTPY4186H" -> "AL******86H"  (PAN is 10 chars).
 */
export function maskPAN(pan: string): string {
  if (!pan) return "";
  if (pan.length <= 6) return "******";
  return pan.slice(0, 2) + "*".repeat(pan.length - 6) + pan.slice(-4);
}

/** Mask the local part of an email for non-privileged display. */
export function maskEmail(email: string): string {
  if (!email) return "";
  const at = email.indexOf("@");
  if (at <= 1) return "****" + email.slice(at);
  return email.slice(0, 1) + "***" + email.slice(at);
}
