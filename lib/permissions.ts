// ============================================================================
// Permissions & allowed-center resolution — port of getAllowedCenterIdsForUser
// and checkPermission from Code.gs.
// ============================================================================

import { sqlTyped } from "./db";
import type { Permissions, Principal, Role } from "./types";

/**
 * Get center IDs the principal is allowed to access.
 *   developer / superadmin: all active centers
 *   everyone else (admin, volunteer, dept staff, ...): their OWN center only.
 *
 * Owner decision (Aug 2026): admins and volunteers are strictly center-scoped;
 * the legacy temple-wide visibility for admins was removed.
 */
export async function getAllowedCenterIdsForUser(p: Principal): Promise<string[]> {
  if ((p.role as string) === "developer" || (p.role as string) === "superadmin") {
    const rows = await sqlTyped<{ id: string }>`SELECT id FROM centers WHERE is_active = TRUE`;
    return rows.map((r) => r.id);
  }
  if (p.centerId && p.centerId !== "all_centers") return [p.centerId];
  return [];
}

export type ResourceType =
  | "donor" | "seva" | "user" | "department" | "department_head" | "departmentHead"
  | "bank_account" | "bankAccount" | "booking" | "report" | "center" | "temple"
  | "event" | "eventBooking" | "payment_gateway" | "paymentGateway";

export type Action = "read" | "create" | "update" | "delete";

/**
 * Check if a principal may perform `action` on a resource of `type` belonging
 * to `resourceCenterId` (when known). Center scoping is enforced in addition
 * to fine-grained permissions.
 */
export async function checkPermission(
  p: Principal,
  type: ResourceType,
  action: Action,
  resourceCenterId?: string
): Promise<boolean> {
  if ((p.role as string) === "developer" || (p.role as string) === "superadmin") return true;

  if (p.role === "donor") {
    return action === "read" && (type === "booking" || type === "eventBooking");
  }

  // Dept staff can manage events/eventBookings for their department
  // (department-level scoping is enforced in lib/handlers/events.ts).
  if (p.role === "dept_staff") {
    return type === "event" || type === "eventBooking";
  }

  // Center scoping.
  if (resourceCenterId && resourceCenterId !== "all_centers") {
    const allowed = await getAllowedCenterIdsForUser(p);
    if (!allowed.includes(resourceCenterId)) return false;
  }
  if (action === "delete" && type === "booking" && resourceCenterId === "all_centers") {
    return false; // only superadmin can delete all_centers bookings (handled above)
  }

  const perms: Permissions = p.permissions ?? {};

  switch (type) {
    case "donor":
      if (action === "delete") return p.role === "admin";
      return perms.manage_donors === true;
    case "seva":
      return perms.manage_sevas === true;
    case "user":
      return perms.manage_users === true;
    case "department":
      return (p.role as string) === "developer" || (p.role as string) === "superadmin";
    case "department_head":
    case "departmentHead":
      return true; // admins/superadmins within their centers (center-scope enforced above)
    case "bank_account":
    case "bankAccount":
      return perms.manage_bank_accounts === true;
    case "booking":
      if (action === "delete") return p.role === "admin";
      return perms.booking === true;
    case "report":
      return perms.reports === true;
    case "center":
    case "temple":
      return perms.manage_centers === true || perms.manage_temples === true;
    case "event":
    case "eventBooking":
      return perms.manage_events === true || p.role === "admin";
    case "payment_gateway":
    case "paymentGateway":
      return (p.role as string) === "developer" || (p.role as string) === "superadmin";
    default:
      return false;
  }
}

/** Convenience: throw ForbiddenError if the check fails. */
export async function requirePermission(
  p: Principal,
  type: ResourceType,
  action: Action,
  resourceCenterId?: string
): Promise<void> {
  const ok = await checkPermission(p, type, action, resourceCenterId);
  if (!ok) {
    const { ForbiddenError } = await import("./errors");
    throw new ForbiddenError();
  }
}

/** Roles that bypass per-row center scoping. */
export function isSuperuserRole(role: Role): boolean {
  return role === "developer" || role === "superadmin";
}
