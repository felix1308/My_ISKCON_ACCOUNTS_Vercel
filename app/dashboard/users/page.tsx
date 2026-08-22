"use client";

import { useState } from "react";
import { useAllData, byType } from "@/lib/use-all-data";
import { useAuth } from "@/lib/auth-context";
import { callApi } from "@/lib/client";

const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "volunteer", label: "Volunteer" },
  { value: "admin", label: "Admin" },
  { value: "dept_staff", label: "Department Staff" },
  { value: "EntryScanner", label: "Entry Scanner (QR)" },
  { value: "SevaScanner", label: "Seva Scanner (QR)" },
  { value: "PrasadamScanner", label: "Prasadam Scanner (QR)" },
];
const roleLabel = (r: string) => ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r;

interface UserRecord {
  __backendId: string; username: string; role: string; centerId: string;
  templeId: string; departmentId?: string; createdBy: string;
}

export default function UsersPage() {
  const { data, loading, reload } = useAllData();
  const { isSuperuser, user: me } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<UserRecord | null>(null);
  const [form, setForm] = useState({ username: "", password: "", role: "volunteer", centerId: "", templeId: "", isActive: true });
  const [error, setError] = useState("");

  const users = byType<UserRecord>(data, "user");
  const centers = byType<{ id: string; name: string }>(data, "center");
  const temples = byType<{ id: string; name: string }>(data, "temple");

  function startNew() {
    setEditing(null);
    setForm({ username: "", password: "", role: "volunteer", centerId: "", templeId: "", isActive: true });
    setError(""); setShowForm(true);
  }
  function startEdit(u: UserRecord) {
    setEditing(u);
    setForm({ username: u.username, password: "", role: u.role, centerId: u.centerId || "", templeId: u.templeId || "", isActive: true });
    setError(""); setShowForm(true);
  }

  async function handleSave() {
    setError("");
    if (!editing && (!form.username || !form.password)) { setError("Username and password are required"); return; }
    const result = editing
      ? await callApi("update", {
          record: {
            type: "user", __backendId: editing.__backendId,
            role: form.role, centerId: form.centerId, templeId: form.templeId,
            isActive: form.isActive,
            ...(form.password ? { password: form.password } : {}),
          },
        })
      : await callApi("create", { record: { type: "user", username: form.username, password: form.password, role: form.role, centerId: form.centerId || undefined, templeId: form.templeId || undefined } });
    if (result.isOk) { setShowForm(false); reload(); }
    else setError((result as { error?: string }).error || "Save failed");
  }

  async function handleDelete(u: UserRecord) {
    if (!confirm(`Deactivate user "${u.username}"? They will no longer be able to log in.`)) return;
    const result = await callApi("delete", { record: { type: "user", __backendId: u.__backendId } });
    if (result.isOk) reload();
    else alert((result as { error?: string }).error || "Delete failed");
  }

  if (loading) return <div className="text-center py-12 text-theme-muted">Loading users...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-theme-primary">Manage Users ({users.length})</h1>
        {isSuperuser && <button onClick={startNew} className="btn-primary text-sm font-medium px-4 py-2 rounded-lg">+ Add User</button>}
      </div>

      {showForm && (
        <div className="bg-white rounded-xl card-shadow border border-theme p-5 space-y-3">
          <h2 className="font-display font-semibold text-theme-primary">{editing ? `Edit User — ${editing.username}` : "New User"}</h2>
          <div className="grid grid-cols-2 gap-3">
            <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm disabled:bg-theme-page disabled:text-theme-muted" placeholder="Username *" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} disabled={!!editing} />
            <input type="password" className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder={editing ? "New password (leave blank to keep)" : "Password *"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <select className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" value={form.centerId} onChange={(e) => setForm({ ...form, centerId: e.target.value })}>
              <option value="">Select center</option>
              {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" value={form.templeId} onChange={(e) => setForm({ ...form, templeId: e.target.value })}>
              <option value="">No temple</option>
              {temples.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {editing && (
              <label className="flex items-center gap-2 text-sm text-theme-secondary">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="w-4 h-4" />
                Active (can log in)
              </label>
            )}
          </div>
          <p className="text-xs text-theme-muted">Permissions are managed on the Manage Access page.</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={handleSave} className="btn-primary text-sm px-4 py-2 rounded-lg">Save</button>
            <button onClick={() => setShowForm(false)} className="text-sm px-4 py-2 border border-theme rounded-lg text-theme-secondary hover:text-theme-primary">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl card-shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-theme-muted text-theme-secondary">
            <tr><th className="px-4 py-3 text-left font-medium">Username</th><th className="px-4 py-3 text-left font-medium">Role</th><th className="px-4 py-3 text-left font-medium">Center</th><th className="px-4 py-3 text-left font-medium">Created By</th>{isSuperuser && <th className="px-4 py-3 text-right font-medium">Actions</th>}</tr>
          </thead>
          <tbody className="divide-y divide-theme-muted">
            {users.map((u) => (
              <tr key={u.__backendId} className="hover:bg-theme-page transition">
                <td className="px-4 py-2.5 font-medium text-theme-primary">{u.username}{u.username === me?.username && <span className="text-xs text-theme-muted ml-1">(you)</span>}</td>
                <td className="px-4 py-2.5"><span className="px-2 py-0.5 rounded-full text-xs bg-theme-muted text-theme-secondary">{roleLabel(u.role)}</span></td>
                <td className="px-4 py-2.5 text-theme-secondary">{centers.find((c) => c.id === u.centerId)?.name || u.centerId || "—"}</td>
                <td className="px-4 py-2.5 text-theme-secondary">{u.createdBy || "—"}</td>
                {isSuperuser && (
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => startEdit(u)} className="text-xs text-theme-accent hover:underline mr-3">Edit</button>
                    {u.username !== me?.username && (
                      <button onClick={() => handleDelete(u)} className="text-xs text-red-600 hover:underline">Delete</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
