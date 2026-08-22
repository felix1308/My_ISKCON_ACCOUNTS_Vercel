"use client";

import { useState } from "react";
import { useAllData, byType } from "@/lib/use-all-data";
import { useAuth } from "@/lib/auth-context";
import { callApi } from "@/lib/client";

interface SevaRecord {
  id: string; name: string; description: string; amount: number;
  centerId: string; isActive: boolean;
  darshanQR?: string; sevaQR?: string; prasadamQR?: string; notifyNumbers?: string;
}

export default function SevasPage() {
  const { data, loading, reload } = useAllData();
  const { hasPermission, isSuperuser } = useAuth();
  const [editing, setEditing] = useState<SevaRecord | null>(null);
  const [showForm, setShowForm] = useState(false);
  const qrOn = (v?: string) => v === "true" || v === "1";
  const [form, setForm] = useState({ name: "", description: "", amount: "0", centerId: "", darshanQR: false, sevaQR: false, prasadamQR: false, notifyNumbers: "" });

  const sevas = byType<SevaRecord>(data, "seva");
  const centers = byType<{ id: string; name: string }>(data, "center");
  const canManage = hasPermission("manage_sevas") || isSuperuser;

  function startEdit(s: SevaRecord) { setEditing(s); setForm({ name: s.name, description: s.description, amount: String(s.amount), centerId: s.centerId, darshanQR: qrOn(s.darshanQR), sevaQR: qrOn(s.sevaQR), prasadamQR: qrOn(s.prasadamQR), notifyNumbers: s.notifyNumbers || "" }); setShowForm(true); }
  function startNew() { setEditing(null); setForm({ name: "", description: "", amount: "0", centerId: "", darshanQR: false, sevaQR: false, prasadamQR: false, notifyNumbers: "" }); setShowForm(true); }

  async function handleSave() {
    const amount = Number(form.amount) || 0;
    const qrFields = {
      darshanQR: form.darshanQR ? "true" : "",
      sevaQR: form.sevaQR ? "true" : "",
      prasadamQR: form.prasadamQR ? "true" : "",
      notifyNumbers: form.notifyNumbers,
    };
    if (editing) {
      await callApi("update", { record: { type: "seva", __backendId: editing.id, name: form.name, description: form.description, amount, centerId: form.centerId || undefined, ...qrFields } });
    } else {
      await callApi("create", { record: { type: "seva", name: form.name, description: form.description, amount, centerId: form.centerId || undefined, ...qrFields } });
    }
    setShowForm(false); reload();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this seva?")) return;
    await callApi("delete", { record: { type: "seva", __backendId: id } });
    reload();
  }

  if (loading) return <div className="text-center py-12 text-theme-muted">Loading sevas...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-theme-primary">Manage Sevas / Donations ({sevas.length})</h1>
        {canManage && <button onClick={startNew} className="btn-primary text-sm font-medium px-4 py-2 rounded-lg">+ Add Seva</button>}
      </div>

      {showForm && (
        <div className="bg-white rounded-xl card-shadow border border-theme p-5 space-y-3">
          <h2 className="font-display font-semibold text-theme-primary">{editing ? "Edit Seva" : "New Seva"}</h2>
          <div className="grid grid-cols-2 gap-3">
            <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input type="number" className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Amount (₹)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm col-span-2" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            {isSuperuser && (
              <select className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" value={form.centerId} onChange={(e) => setForm({ ...form, centerId: e.target.value })}>
                <option value="">All centers</option>
                {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>
          {/* QR flags printed on receipts + WhatsApp reminder numbers */}
          <div className="border-t border-theme pt-3 space-y-2">
            <p className="text-xs font-semibold text-theme-secondary">Receipt QR codes (scanned at venue)</p>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-theme-secondary">
                <input type="checkbox" checked={form.darshanQR} onChange={(e) => setForm({ ...form, darshanQR: e.target.checked })} className="w-4 h-4" /> Entry / Darshan QR
              </label>
              <label className="flex items-center gap-2 text-sm text-theme-secondary">
                <input type="checkbox" checked={form.sevaQR} onChange={(e) => setForm({ ...form, sevaQR: e.target.checked })} className="w-4 h-4" /> Seva QR
              </label>
              <label className="flex items-center gap-2 text-sm text-theme-secondary">
                <input type="checkbox" checked={form.prasadamQR} onChange={(e) => setForm({ ...form, prasadamQR: e.target.checked })} className="w-4 h-4" /> Prasadam QR
              </label>
            </div>
            <input className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="WhatsApp reminder numbers (comma-separated, e.g. pujari/cook phones)" value={form.notifyNumbers} onChange={(e) => setForm({ ...form, notifyNumbers: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className="btn-primary text-sm px-4 py-2 rounded-lg">Save</button>
            <button onClick={() => setShowForm(false)} className="text-sm px-4 py-2 border border-theme rounded-lg text-theme-secondary hover:text-theme-primary">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sevas.map((s) => (
          <div key={s.id} className="seva-card bg-white rounded-xl card-shadow border border-theme p-5 transition">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-display font-semibold text-theme-primary">{s.name}</h3>
                {s.description && <p className="text-xs text-theme-muted mt-1">{s.description}</p>}
              </div>
              <div className="text-lg font-bold text-theme-accent">₹{s.amount}</div>
            </div>
            <div className="text-xs text-theme-muted mt-2">{s.centerId === "all_centers" || !s.centerId ? "All centers" : centers.find((c) => c.id === s.centerId)?.name || s.centerId}</div>
            {(qrOn(s.darshanQR) || qrOn(s.sevaQR) || qrOn(s.prasadamQR)) && (
              <div className="flex flex-wrap gap-1 mt-2">
                {qrOn(s.darshanQR) && <span className="text-[10px] px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 font-medium">Entry QR</span>}
                {qrOn(s.sevaQR) && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">Seva QR</span>}
                {qrOn(s.prasadamQR) && <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-medium">Prasadam QR</span>}
              </div>
            )}
            {canManage && (
              <div className="flex gap-2 mt-3">
                <button onClick={() => startEdit(s)} className="text-xs text-theme-accent hover:underline">Edit</button>
                <button onClick={() => handleDelete(s.id)} className="text-xs text-red-600 hover:underline">Delete</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
