"use client";

import { useState } from "react";
import { useAllData, byType } from "@/lib/use-all-data";
import { useAuth } from "@/lib/auth-context";
import { callApi } from "@/lib/client";

interface DeptHead {
  __backendId: string; id: string; name: string; role: string; phone: string;
  templeId: string; centerId: string; isActive: boolean;
}

export default function DeptHeadsPage() {
  const { data, loading, reload } = useAllData();
  const { isSuperuser } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DeptHead | null>(null);
  const [form, setForm] = useState({ name: "", role: "Pujari", phone: "", templeId: "", centerId: "" });
  const [saving, setSaving] = useState(false);

  const heads = byType<DeptHead>(data, "department_head");
  const temples = byType<{ id: string; name: string }>(data, "temple");
  const centers = byType<{ id: string; name: string }>(data, "center");

  function startNew() { setEditing(null); setForm({ name: "", role: "Pujari", phone: "", templeId: "", centerId: "" }); setShowForm(true); }
  function startEdit(h: DeptHead) { setEditing(h); setForm({ name: h.name, role: h.role, phone: h.phone, templeId: h.templeId || "", centerId: h.centerId || "" }); setShowForm(true); }

  async function handleSave() {
    setSaving(true);
    if (editing) {
      await callApi("update", { record: { type: "department_head", __backendId: editing.__backendId || editing.id, ...form } });
    } else {
      await callApi("create", { record: { type: "department_head", ...form } });
    }
    setSaving(false); setShowForm(false); reload();
  }

  async function handleDelete(h: DeptHead) {
    if (!confirm(`Delete ${h.name}?`)) return;
    await callApi("delete", { record: { type: "department_head", __backendId: h.__backendId || h.id } });
    reload();
  }

  if (loading) return <div className="text-center py-12 text-theme-muted">Loading...</div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl card-shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="font-display text-xl font-semibold text-theme-primary">Department Heads</h3>
            <p className="text-sm text-theme-secondary mt-1">Manage Pujaris, Cooks and other department heads</p>
          </div>
          {isSuperuser && <button onClick={startNew} className="btn-primary text-sm px-4 py-2 rounded-lg">Add Contact</button>}
        </div>

        {showForm && (
          <div className="bg-theme-page rounded-lg p-4 mb-6 space-y-3 border border-theme">
            <h4 className="font-semibold text-theme-primary">{editing ? "Edit Contact" : "New Contact"}</h4>
            <div className="grid grid-cols-2 gap-3">
              <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <select className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="Pujari">Pujari</option>
                <option value="Cook">Cook</option>
                <option value="Other">Other</option>
              </select>
              <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <select className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" value={form.templeId} onChange={(e) => setForm({ ...form, templeId: e.target.value })}>
                <option value="">Select Temple</option>
                {temples.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" value={form.centerId} onChange={(e) => setForm({ ...form, centerId: e.target.value })}>
                <option value="">Select Center</option>
                {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSave} disabled={saving} className="btn-primary text-sm px-4 py-2 rounded-lg">{saving ? "Saving..." : "Save"}</button>
              <button onClick={() => setShowForm(false)} className="text-sm px-4 py-2 border border-theme rounded-lg text-theme-secondary">Cancel</button>
            </div>
          </div>
        )}

        {heads.length === 0 ? (
          <p className="text-center text-theme-muted py-8">No contacts found. Add department heads to get started.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-theme-muted text-theme-secondary">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">#</th>
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">Role</th>
                  <th className="px-4 py-3 text-left font-medium">Phone</th>
                  <th className="px-4 py-3 text-left font-medium">Temple</th>
                  <th className="px-4 py-3 text-left font-medium">Center</th>
                  <th className="px-4 py-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-muted">
                {heads.map((h, i) => (
                  <tr key={h.__backendId || h.id} className="hover:bg-theme-page transition">
                    <td className="px-4 py-2.5 text-theme-muted">{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium text-theme-primary">{h.name}</td>
                    <td className="px-4 py-2.5 text-theme-secondary">{h.role}</td>
                    <td className="px-4 py-2.5 text-theme-secondary">{h.phone || "—"}</td>
                    <td className="px-4 py-2.5 text-theme-secondary">{temples.find((t) => t.id === h.templeId)?.name || "—"}</td>
                    <td className="px-4 py-2.5 text-theme-secondary">{centers.find((c) => c.id === h.centerId)?.name || "—"}</td>
                    <td className="px-4 py-2.5">
                      <button onClick={() => startEdit(h)} className="text-xs text-theme-accent hover:underline mr-2">Edit</button>
                      <button onClick={() => handleDelete(h)} className="text-xs text-red-600 hover:underline">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
