// ============================================================================
// Env config — single source of truth for all environment variables.
// Fails fast at boot if a required secret is missing.
// ============================================================================

import { z } from "zod";

const EnvSchema = z.object({
  // Database (Neon via Vercel integration)
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_URL_DIRECT: z.string().optional().default(""),

  // Session signing
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be >= 32 chars"),

  // Legacy compatibility
  LEGACY_PASSWORD_SALT: z.string().min(1, "LEGACY_PASSWORD_SALT is required for migrated user logins"),
  LEGACY_ENCRYPTION_KEY: z.string().min(1, "LEGACY_ENCRYPTION_KEY is required to decrypt migrated PAN/email"),

  // Modern encryption (AES-256-GCM, 32-byte key as 64 hex chars)
  ENCRYPTION_KEY_HEX: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY_HEX must be 64 hex chars (32 bytes)"),

  // Auth
  SESSION_TIMEOUT_HOURS: z
    .string()
    .optional()
    .default("24")
    .transform((v) => Number.parseInt(v, 10)),

  SUPERADMIN_USERNAME: z.string().optional().default("admin"),
  DEVELOPER_USERNAME: z.string().optional().default(""),

  // Razorpay
  RAZORPAY_KEY_ID: z.string().default(""),
  RAZORPAY_KEY_SECRET: z.string().default(""),

  // WhatsApp (bhashsms)
  BHASHSMS_USER: z.string().default(""),
  BHASHSMS_PASSWORD: z.string().default(""),
  BHASHSMS_SENDER_ID: z.string().default(""),
  BHASHSMS_TEMPLATE: z.string().default(""),

  // Cron
  CRON_SECRET: z.string().default(""),

  // Audit
  AUDIT_LOG_ENABLED: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/**
 * Returns the validated env config. Throws on first call if env is invalid,
 * which surfaces misconfiguration at boot instead of at request time.
 */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * Soft accessor for code paths that run without a full env (e.g. the static
 * login page). Returns undefined instead of throwing.
 */
export function tryGetEnv(): Env | undefined {
  try {
    return getEnv();
  } catch {
    return undefined;
  }
}
