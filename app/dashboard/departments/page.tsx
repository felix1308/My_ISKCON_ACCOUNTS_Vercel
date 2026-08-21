"use client";

import { useState } from "react";
import { useAllData, byType } from "@/lib/use-all-data";
import { useAuth } from "@/lib/auth-context";
import { callApi } from "@/lib/client";

interface DeptRecord {
  __backendId: string; id: string; name: string; type: string;
  centerId: string; templeId: string; description: string; isActive: boolean;
}

export default function DepartmentsPage() {
  const { data, loading, reload } = useAllData();
  const { isSuperuser } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DeptRecord | null>(null);
  const [form, setForm] = useState({ name: "", deptType: "", centerId: "", templeId: "", description: "" });
  const [saving, setSaving] = useState(false);

  const departments = byType<DeptRecord>(data, "department");
  const temples = byType<{ id: string; name: string }>(data, "temple");
  const centers = byType<{ id: string; name: string }>(data, "center");
  const users = byType<{ departmentId: string }>(data, "user");

  function startNew() { setEditing(null); setForm({ name: "", deptType: "", centerId: "", templeId: "", description: "" }); setShowForm(true); }
  function startEdit(d: DeptRecord) { setEditing(d); setForm({ name: d.name, deptType: d.type, centerId: d.centerId, templeId: d.templeId, description: d.description }); setShowForm(true); }

  async function handleSave() {
    setSaving(true);
    const base = { name: form.name, centerId: form.centerId, templeId: form.templeId, description: form.description };
    if (editing) {
      await callApi("update", { record: Object.assign({ type: "department", __backendId: editing.__backendId || editing.id }, base) });
    } else {
      await callApi("create", { record: Object.assign({ type: "department" }, base) });
    }
    setSaving(false); setShowForm(false); reload();
  }

  async function handleDelete(d: DeptRecord) {
    if (!confirm(`Delete department "${d.name}"?`)) return;
    await callApi("delete", { record: { type: "department", __backendId: d.__backendId || d.id } });
    reload();
  }

  if (loading) return <div className="text-center py-12 text-theme-muted">Loading...</div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl card-shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="font-display text-xl font-semibold text-theme-primary">Departments</h3>
            <p className="text-sm text-theme-secondary mt-1">Departments are parallel to Centers under a Temple (e.g. Yatras, Kitchen, Deity)</p>
          </div>
          {isSuperuser && <button onClick={startNew} className="btn-primary text-sm px-4 py-2 rounded-lg">Add Department</button>}
        </div>

        {showForm && (
          <div className="bg-theme-page rounded-lg p-4 mb-6 space-y-3 border border-theme">
            <h4 className="font-semibold text-theme-primary">{editing ? "Edit Department" : "New Department"}</h4>
            <div className="grid grid-cols-2 gap-3">
              <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Type (e.g. Yatra, Kitchen)" value={form.deptType} onChange={(e) => setForm({ ...form, deptType: e.target.value })} />
              <select className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" value={form.templeId} onChange={(e) => setForm({ ...form, templeId: e.target.value })}>
                <option value="">Select Temple</option>
                {temples.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" value={form.centerId} onChange={(e) => setForm({ ...form, centerId: e.target.value })}>
                <option value="">Linked Center</option>
                {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm col-span-2" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <button onClick={handleSave} disabled={saving} className="btn-primary text-sm px-4 py-2 rounded-lg">{saving ? "Saving..." : "Save"}</button>
              <button onClick={() => setShowForm(false)} className="text-sm px-4 py-2 border border-theme rounded-lg text-theme-secondary">Cancel</button>
            </div>
          </div>
        )}

        {departments.length === 0 ? (
          <p className="text-center text-theme-muted py-8">No departments yet. Add a department to get started.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-theme-muted text-theme-secondary">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">#</th>
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">Temple</th>
                  <th className="px-4 py-3 text-left font-medium">Linked Center</th>
                  <th className="px-4 py-3 text-left font-medium">Users</th>
                  <th className="px-4 py-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-muted">
                {departments.map((d, i) => {
                  const deptUsers = users.filter((u) => u.departmentId === (d.__backendId || d.id)).length;
                  return (
                    <tr key={d.__backendId || d.id} className="hover:bg-theme-page transition">
                      <td className="px-4 py-2.5 text-theme-muted">{i + 1}</td>
                      <td className="px-4 py-2.5 font-medium text-theme-primary">{d.name}{d.type ? ` (${d.type})` : ""}</td>
                      <td className="px-4 py-2.5 text-theme-secondary">{temples.find((t) => t.id === d.templeId)?.name || "—"}</td>
                      <td className="px-4 py-2.5 text-theme-secondary">{centers.find((c) => c.id === d.centerId)?.name || "—"}</td>
                      <td className="px-4 py-2.5 text-theme-secondary">{deptUsers}</td>
                      <td className="px-4 py-2.5">
                        <button onClick={() => startEdit(d)} className="text-xs text-theme-accent hover:underline mr-2">Edit</button>
                        <button onClick={() => handleDelete(d)} className="text-xs text-red-600 hover:underline">Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
