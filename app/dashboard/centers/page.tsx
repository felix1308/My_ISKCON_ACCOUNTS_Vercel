"use client";

import { useState } from "react";
import { useAllData, byType } from "@/lib/use-all-data";
import { useAuth } from "@/lib/auth-context";
import { callApi } from "@/lib/client";

export default function CentersPage() {
  const { data, loading, reload } = useAllData();
  const { isSuperuser } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", city: "", state: "", templeId: "" });

  const centers = byType<{ id: string; name: string; city: string; state: string; templeId: string }>(data, "center");
  const temples = byType<{ id: string; name: string }>(data, "temple");

  async function handleSave() {
    await callApi("create", { record: { type: "center", name: form.name, city: form.city, state: form.state, templeId: form.templeId || undefined } });
    setShowForm(false); setForm({ name: "", city: "", state: "", templeId: "" }); reload();
  }

  if (loading) return <div className="text-center py-12 text-gray-400">Loading centers...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Centers ({centers.length})</h1>
        {isSuperuser && <button onClick={() => setShowForm(true)} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg">+ Add Center</button>}
      </div>

      {showForm && (
        <div className="bg-white border rounded-xl p-5 space-y-3">
          <h2 className="font-semibold">New Center</h2>
          <div className="grid grid-cols-2 gap-3">
            <input className="px-3 py-2 border rounded-lg text-sm" placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="px-3 py-2 border rounded-lg text-sm" placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            <input className="px-3 py-2 border rounded-lg text-sm" placeholder="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
            <select className="px-3 py-2 border rounded-lg text-sm" value={form.templeId} onChange={(e) => setForm({ ...form, templeId: e.target.value })}>
              <option value="">No temple</option>
              {temples.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
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
            <tr><th className="px-4 py-2 text-left font-medium">Name</th><th className="px-4 py-2 text-left font-medium">City</th><th className="px-4 py-2 text-left font-medium">State</th><th className="px-4 py-2 text-left font-medium">Temple</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {centers.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 font-medium">{c.name}</td>
                <td className="px-4 py-2.5 text-gray-600">{c.city || "—"}</td>
                <td className="px-4 py-2.5 text-gray-600">{c.state || "—"}</td>
                <td className="px-4 py-2.5 text-gray-600">{temples.find((t) => t.id === c.templeId)?.name || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
