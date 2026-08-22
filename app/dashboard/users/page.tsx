"use client";

import { useState } from "react";
import { useAllData, byType } from "@/lib/use-all-data";
import { useAuth } from "@/lib/auth-context";
import { callApi } from "@/lib/client";

const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "volunteer", label: "Volunteer" },
  { value: "admin", label: "Admin" },
  { value: "EntryScanner", label: "Entry Scanner (QR)" },
  { value: "SevaScanner", label: "Seva Scanner (QR)" },
  { value: "PrasadamScanner", label: "Prasadam Scanner (QR)" },
];
const roleLabel = (r: string) => ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r;

export default function UsersPage() {
  const { data, loading, reload } = useAllData();
  const { isSuperuser } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", role: "volunteer", centerId: "", templeId: "" });

  const users = byType<{ __backendId: string; username: string; role: string; centerId: string; templeId: string; createdBy: string }>(data, "user");
  const centers = byType<{ id: string; name: string }>(data, "center");
  const temples = byType<{ id: string; name: string }>(data, "temple");

  async function handleSave() {
    const result = await callApi("create", { record: { type: "user", username: form.username, password: form.password, role: form.role, centerId: form.centerId || undefined, templeId: form.templeId || undefined } });
    if (result.isOk) { setShowForm(false); setForm({ username: "", password: "", role: "volunteer", centerId: "", templeId: "" }); reload(); }
    else alert((result as { error?: string }).error);
  }

  if (loading) return <div className="text-center py-12 text-theme-muted">Loading users...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-theme-primary">Manage Users ({users.length})</h1>
        {isSuperuser && <button onClick={() => setShowForm(true)} className="btn-primary text-sm font-medium px-4 py-2 rounded-lg">+ Add User</button>}
      </div>

      {showForm && (
        <div className="bg-white rounded-xl card-shadow border border-theme p-5 space-y-3">
          <h2 className="font-display font-semibold text-theme-primary">New User</h2>
          <div className="grid grid-cols-2 gap-3">
            <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Username *" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <input type="password" className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Password *" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <select className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" value={form.centerId} onChange={(e) => setForm({ ...form, centerId: e.target.value })}>
              <option value="">Select center</option>
              {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className="btn-primary text-sm px-4 py-2 rounded-lg">Save</button>
            <button onClick={() => setShowForm(false)} className="text-sm px-4 py-2 border border-theme rounded-lg text-theme-secondary hover:text-theme-primary">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl card-shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-theme-muted text-theme-secondary">
            <tr><th className="px-4 py-3 text-left font-medium">Username</th><th className="px-4 py-3 text-left font-medium">Role</th><th className="px-4 py-3 text-left font-medium">Center</th><th className="px-4 py-3 text-left font-medium">Created By</th></tr>
          </thead>
          <tbody className="divide-y divide-theme-muted">
            {users.map((u) => (
              <tr key={u.__backendId} className="hover:bg-theme-page transition">
                <td className="px-4 py-2.5 font-medium text-theme-primary">{u.username}</td>
                <td className="px-4 py-2.5"><span className="px-2 py-0.5 rounded-full text-xs bg-theme-muted text-theme-secondary">{roleLabel(u.role)}</span></td>
                <td className="px-4 py-2.5 text-theme-secondary">{centers.find((c) => c.id === u.centerId)?.name || u.centerId || "—"}</td>
                <td className="px-4 py-2.5 text-theme-secondary">{u.createdBy || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
