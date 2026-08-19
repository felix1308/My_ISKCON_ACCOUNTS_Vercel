// ============================================================================
// ID generation — same scheme as the legacy backend so migrated rows and new
// rows coexist without id collisions, and frontend links keep working.
// ============================================================================

import { randomBytes } from "node:crypto";

export function generateId(prefix = "id"): string {
  return `${prefix}_${Date.now()}_${randomBytes(5).toString("hex")}`;
}

export function generateSevaId(): string {
  return `seva_${Date.now()}_${randomBytes(3).toString("hex")}`;
}

export function generateCenterId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `center_${slug || randomBytes(3).toString("hex")}`;
}

export function generateTempleId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `temple_${slug || randomBytes(3).toString("hex")}`;
}
