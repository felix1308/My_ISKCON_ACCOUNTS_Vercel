"use client";

import { useState, useMemo } from "react";
import { useAllData, byType } from "@/lib/use-all-data";
import { useAuth } from "@/lib/auth-context";
import { callApi } from "@/lib/client";

const ALL_PERMISSIONS = [
  { id: "view_dashboard", label: "Dashboard" },
  { id: "booking", label: "Booking" },
  { id: "reports", label: "Reports" },
  { id: "manage_donors", label: "Donors" },
  { id: "manage_sevas", label: "Sevas" },
  { id: "manage_users", label: "Users" },
  { id: "donor_logins", label: "Donor Logins" },
  { id: "manage_bank_accounts", label: "Bank Accounts" },
  { id: "payment_gateways", label: "Payment Gateways" },
  { id: "centers", label: "Centers" },
  { id: "temples", label: "Temples" },
  { id: "departments", label: "Departments" },
  { id: "department_heads", label: "Dept Heads" },
  { id: "validate_qr", label: "Validate QR" },
  { id: "event_bookings", label: "Events" },
  { id: "manage_access", label: "Permissions" },
  { id: "sadhana", label: "Sadhana" },
  { id: "asset_management", label: "Assets" },
  { id: "ashram_management", label: "Ashram" },
];

interface UserRecord {
  __backendId: string; username: string; role: string; permissions: string | Record<string, boolean>;
}

export default function PermissionsPage() {
  const { data, loading, reload } = useAllData();
  const { isSuperuser } = useAuth();
  const [saving, setSaving] = useState<string | null>(null);

  const adminUsers = useMemo(() => {
    return byType<UserRecord>(data, "user").filter((u) =>
      u.role !== "superadmin" && u.role !== "developer"
    );
  }, [data]);

  function getPerms(u: UserRecord): Record<string, boolean> {
    if (!u.permissions) return {};
    if (typeof u.permissions === "string") {
      try { return JSON.parse(u.permissions); } catch { return {}; }
    }
    return u.permissions;
  }

  async function togglePermission(user: UserRecord, permId: string) {
    const perms = getPerms(user);
    const newPerms = { ...perms, [permId]: !perms[permId] };
    setSaving(`${user.__backendId}-${permId}`);
    await callApi("update", {
      record: { type: "user", __backendId: user.__backendId, permissions: newPerms },
    });
    setSaving(null);
    reload();
  }

  if (!isSuperuser) return <div className="text-center py-12 text-theme-muted">Superadmin access required.</div>;
  if (loading) return <div className="text-center py-12 text-theme-muted">Loading...</div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl card-shadow p-6">
        <h3 className="font-display text-xl font-semibold text-theme-primary mb-1">Manage User Access</h3>
        <p className="text-sm text-theme-secondary mb-6">Control what features each admin/volunteer can access. Superadmins always have full access.</p>

        {adminUsers.length === 0 ? (
          <p className="text-center text-theme-muted py-8">No admin/volunteer users found.</p>
        ) : (
          <div className="space-y-4">
            {adminUsers.map((u) => {
              const perms = getPerms(u);
              const roleColor = u.role === "admin" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700";
              return (
                <div key={u.__backendId} className="permission-card">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="font-medium text-theme-primary">{u.username}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${roleColor}`}>{u.role}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {ALL_PERMISSIONS.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 text-sm text-theme-secondary cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!perms[p.id]}
                          onChange={() => togglePermission(u, p.id)}
                          disabled={saving === `${u.__backendId}-${p.id}`}
                          className="permission-checkbox"
                        />
                        {p.label}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
