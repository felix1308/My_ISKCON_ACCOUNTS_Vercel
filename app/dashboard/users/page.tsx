"use client";

import { useState } from "react";
import { useAllData, byType } from "@/lib/use-all-data";
import { useAuth } from "@/lib/auth-context";
import { callApi } from "@/lib/client";

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

  if (loading) return <div className="text-center py-12 text-gray-400">Loading users...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Users ({users.length})</h1>
        {isSuperuser && <button onClick={() => setShowForm(true)} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg">+ Add User</button>}
      </div>

      {showForm && (
        <div className="bg-white border rounded-xl p-5 space-y-3">
          <h2 className="font-semibold">New User</h2>
          <div className="grid grid-cols-2 gap-3">
            <input className="px-3 py-2 border rounded-lg text-sm" placeholder="Username *" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <input type="password" className="px-3 py-2 border rounded-lg text-sm" placeholder="Password *" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <select className="px-3 py-2 border rounded-lg text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="volunteer">Volunteer</option>
              <option value="admin">Admin</option>
            </select>
            <select className="px-3 py-2 border rounded-lg text-sm" value={form.centerId} onChange={(e) => setForm({ ...form, centerId: e.target.value })}>
              <option value="">Select center</option>
              {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className="bg-orange-500 hover:bg-orange-600 text-white text-sm px-4 py-2 rounded-lg">Save</button>
            <button onClick={() => setShowForm(false)} className="text-sm px-4 py-2 border rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr><th className="px-4 py-2 text-left font-medium">Username</th><th className="px-4 py-2 text-left font-medium">Role</th><th className="px-4 py-2 text-left font-medium">Center</th><th className="px-4 py-2 text-left font-medium">Created By</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {users.map((u) => (
              <tr key={u.__backendId} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 font-medium">{u.username}</td>
                <td className="px-4 py-2.5"><span className="capitalize px-2 py-0.5 rounded-full text-xs bg-gray-100">{u.role}</span></td>
                <td className="px-4 py-2.5 text-gray-600">{centers.find((c) => c.id === u.centerId)?.name || u.centerId || "—"}</td>
                <td className="px-4 py-2.5 text-gray-500">{u.createdBy || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
