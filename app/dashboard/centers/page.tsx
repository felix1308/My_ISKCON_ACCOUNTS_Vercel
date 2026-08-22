"use client";

import { useState } from "react";
import { useAllData, byType } from "@/lib/use-all-data";
import { useAuth } from "@/lib/auth-context";
import { callApi } from "@/lib/client";

interface CenterRecord { id: string; name: string; city: string; state: string; templeId: string; }

export default function CentersPage() {
  const { data, loading, reload } = useAllData();
  const { isSuperuser } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CenterRecord | null>(null);
  const [form, setForm] = useState({ name: "", city: "", state: "", templeId: "" });
  const [error, setError] = useState("");

  const centers = byType<CenterRecord>(data, "center");
  const temples = byType<{ id: string; name: string }>(data, "temple");

  function startNew() { setEditing(null); setForm({ name: "", city: "", state: "", templeId: "" }); setError(""); setShowForm(true); }
  function startEdit(c: CenterRecord) { setEditing(c); setForm({ name: c.name, city: c.city || "", state: c.state || "", templeId: c.templeId || "" }); setError(""); setShowForm(true); }

  async function handleSave() {
    setError("");
    const result = editing
      ? await callApi("update", { record: { type: "center", __backendId: editing.id, name: form.name, city: form.city, state: form.state, templeId: form.templeId } })
      : await callApi("create", { record: { type: "center", name: form.name, city: form.city, state: form.state, templeId: form.templeId || undefined } });
    if (result.isOk) { setShowForm(false); reload(); }
    else setError((result as { error?: string }).error || "Save failed");
  }

  async function handleDelete(c: CenterRecord) {
    if (!confirm(`Deactivate center "${c.name}"? It will no longer accept bookings.`)) return;
    const result = await callApi("delete", { record: { type: "center", __backendId: c.id } });
    if (result.isOk) reload();
    else alert((result as { error?: string }).error || "Delete failed");
  }

  if (loading) return <div className="text-center py-12 text-theme-muted">Loading centers...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-theme-primary">Centers ({centers.length})</h1>
        {isSuperuser && <button onClick={startNew} className="btn-primary text-sm font-medium px-4 py-2 rounded-lg">+ Add Center</button>}
      </div>

      {showForm && (
        <div className="bg-white rounded-xl card-shadow border border-theme p-5 space-y-3">
          <h2 className="font-display font-semibold text-theme-primary">{editing ? `Edit Center — ${editing.name}` : "New Center"}</h2>
          <div className="grid grid-cols-2 gap-3">
            <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
            <select className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" value={form.templeId} onChange={(e) => setForm({ ...form, templeId: e.target.value })}>
              <option value="">No temple</option>
              {temples.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
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
            <tr><th className="px-4 py-3 text-left font-medium">Name</th><th className="px-4 py-3 text-left font-medium">City</th><th className="px-4 py-3 text-left font-medium">State</th><th className="px-4 py-3 text-left font-medium">Temple</th>{isSuperuser && <th className="px-4 py-3 text-right font-medium">Actions</th>}</tr>
          </thead>
          <tbody className="divide-y divide-theme-muted">
            {centers.map((c) => (
              <tr key={c.id} className="hover:bg-theme-page transition">
                <td className="px-4 py-2.5 font-medium text-theme-primary">{c.name}</td>
                <td className="px-4 py-2.5 text-theme-secondary">{c.city || "—"}</td>
                <td className="px-4 py-2.5 text-theme-secondary">{c.state || "—"}</td>
                <td className="px-4 py-2.5 text-theme-secondary">{temples.find((t) => t.id === c.templeId)?.name || "—"}</td>
                {isSuperuser && (
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => startEdit(c)} className="text-xs text-theme-accent hover:underline mr-3">Edit</button>
                    <button onClick={() => handleDelete(c)} className="text-xs text-red-600 hover:underline">Delete</button>
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
