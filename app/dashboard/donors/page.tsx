"use client";

import { useState, useMemo } from "react";
import { useAllData, byType } from "@/lib/use-all-data";
import { useAuth } from "@/lib/auth-context";
import { callApi } from "@/lib/client";

interface DonorRecord {
  __backendId: string; name: string; spiritualName: string; mobile: string;
  whatsapp: string; email: string; pan: string; area: string; pincode: string;
  centerId: string; createdAt: string;
}

export default function DonorsPage() {
  const { data, loading, reload } = useAllData();
  const { hasPermission, isSuperuser } = useAuth();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState({ name: "", mobile: "", whatsapp: "", email: "", pan: "", area: "", pincode: "", centerId: "" });

  const donors = useMemo(() => {
    const all = byType<DonorRecord>(data, "donor");
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter((d) =>
      d.name?.toLowerCase().includes(q) ||
      d.mobile?.includes(q) ||
      d.email?.toLowerCase().includes(q) ||
      d.pan?.toLowerCase().includes(q)
    );
  }, [data, search]);

  const centers = byType<{ id: string; name: string }>(data, "center");

  async function handleSave() {
    setSaving(true);
    setFormError("");
    const result = await callApi("create", {
      record: { type: "donor", ...form, centerId: form.centerId || undefined },
    });
    setSaving(false);
    if (!result.isOk) {
      setFormError((result as { error?: string }).error || "Failed to save");
      return;
    }
    setShowForm(false);
    setForm({ name: "", mobile: "", whatsapp: "", email: "", pan: "", area: "", pincode: "", centerId: "" });
    reload();
  }

  if (loading) return <div className="text-center py-12 text-gray-400">Loading donors...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-800">Donors ({donors.length})</h1>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search name, mobile, PAN..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm w-64"
          />
          {(hasPermission("manage_donors") || isSuperuser) && (
            <button
              onClick={() => setShowForm(true)}
              className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg"
            >
              + Add Donor
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          <h2 className="font-semibold">New Donor</h2>
          {formError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-2">{formError}</div>}
          <div className="grid grid-cols-2 gap-3">
            <input className="px-3 py-2 border rounded-lg text-sm" placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="px-3 py-2 border rounded-lg text-sm" placeholder="Mobile *" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
            <input className="px-3 py-2 border rounded-lg text-sm" placeholder="WhatsApp" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
            <input className="px-3 py-2 border rounded-lg text-sm" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input className="px-3 py-2 border rounded-lg text-sm" placeholder="PAN" value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} />
            <input className="px-3 py-2 border rounded-lg text-sm" placeholder="Area" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
            <input className="px-3 py-2 border rounded-lg text-sm" placeholder="Pincode" value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} />
            <select className="px-3 py-2 border rounded-lg text-sm" value={form.centerId} onChange={(e) => setForm({ ...form, centerId: e.target.value })}>
              <option value="">Select center</option>
              {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving} className="bg-orange-500 hover:bg-orange-600 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50">
              {saving ? "Saving..." : "Save"}
            </button>
            <button onClick={() => setShowForm(false)} className="text-sm px-4 py-2 border rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Name</th>
                <th className="px-4 py-2 text-left font-medium">Mobile</th>
                <th className="px-4 py-2 text-left font-medium">PAN</th>
                <th className="px-4 py-2 text-left font-medium">Area</th>
                <th className="px-4 py-2 text-left font-medium">Center</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {donors.slice(0, 200).map((d) => {
                const center = centers.find((c) => c.id === d.centerId);
                return (
                  <tr key={d.__backendId} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium">{d.name}</td>
                    <td className="px-4 py-2.5 text-gray-600">{d.mobile}</td>
                    <td className="px-4 py-2.5 text-gray-600">{d.pan || "—"}</td>
                    <td className="px-4 py-2.5 text-gray-600">{d.area || "—"}</td>
                    <td className="px-4 py-2.5 text-gray-600">{center?.name || d.centerId || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {donors.length > 200 && (
          <div className="px-4 py-3 text-center text-xs text-gray-400">
            Showing 200 of {donors.length} donors — use search to narrow down
          </div>
        )}
      </div>
    </div>
  );
}
