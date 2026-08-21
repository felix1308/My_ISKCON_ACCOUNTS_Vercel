"use client";

import { useState, useMemo } from "react";
import { useAllData, byType } from "@/lib/use-all-data";
import { useAuth } from "@/lib/auth-context";
import { callApi } from "@/lib/client";
import { formatDate } from "@/lib/format";

interface DonorRecord {
  __backendId: string; name: string; spiritualName: string; mobile: string;
  whatsapp: string; email: string; pan: string; area: string; pincode: string;
  flat: string; road: string; po: string; district: string; state: string; country: string;
  tallyName: string; centerId: string; createdAt: string;
}
interface BookingRecord { donorId: string; totalAmount: number; paymentStatus: string; bookingDate: string; }

export default function DonorsPage() {
  const { data, loading, reload } = useAllData();
  const { hasPermission, isSuperuser } = useAuth();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DonorRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState({ name: "", mobile: "", whatsapp: "", email: "", pan: "", area: "", pincode: "", centerId: "", spiritualName: "", flat: "", road: "", po: "", district: "", state: "", country: "India", tallyName: "" });
  const [viewDonor, setViewDonor] = useState<DonorRecord | null>(null);

  const allDonors = byType<DonorRecord>(data, "donor");
  const bookings = byType<BookingRecord>(data, "booking");
  const centers = byType<{ id: string; name: string }>(data, "center");

  const donorStats = useMemo(() => {
    const map = new Map<string, { count: number; total: number; lastDate: string }>();
    for (const b of bookings) {
      if (b.paymentStatus !== "paid") continue;
      const s = map.get(b.donorId) || { count: 0, total: 0, lastDate: "" };
      s.count++;
      s.total += b.totalAmount || 0;
      const bd = formatDate(b.bookingDate, "");
      if (bd > s.lastDate) s.lastDate = bd;
      map.set(b.donorId, s);
    }
    return map;
  }, [bookings]);

  const donors = useMemo(() => {
    if (!search.trim()) return allDonors;
    const q = search.toLowerCase();
    return allDonors.filter((d) =>
      d.name?.toLowerCase().includes(q) || d.mobile?.includes(q) ||
      d.email?.toLowerCase().includes(q) || d.pan?.toLowerCase().includes(q) ||
      d.tallyName?.toLowerCase().includes(q)
    );
  }, [allDonors, search]);

  const canManage = hasPermission("manage_donors") || isSuperuser;

  function startNew() {
    setEditing(null);
    setForm({ name: "", mobile: "", whatsapp: "", email: "", pan: "", area: "", pincode: "", centerId: "", spiritualName: "", flat: "", road: "", po: "", district: "", state: "", country: "India", tallyName: "" });
    setShowForm(true); setFormError("");
  }
  function startEdit(d: DonorRecord) {
    setEditing(d);
    setForm({ name: d.name, mobile: d.mobile, whatsapp: d.whatsapp || "", email: d.email || "", pan: d.pan || "", area: d.area || "", pincode: d.pincode || "", centerId: d.centerId || "", spiritualName: d.spiritualName || "", flat: d.flat || "", road: d.road || "", po: d.po || "", district: d.district || "", state: d.state || "", country: d.country || "India", tallyName: d.tallyName || "" });
    setShowForm(true); setFormError("");
  }

  async function handleSave() {
    setSaving(true); setFormError("");
    const payload = { ...form, centerId: form.centerId || undefined };
    let result;
    if (editing) {
      result = await callApi("update", { record: { type: "donor", __backendId: editing.__backendId, ...payload } });
    } else {
      result = await callApi("create", { record: { type: "donor", ...payload } });
    }
    setSaving(false);
    if (!result.isOk) { setFormError((result as { error?: string }).error || "Failed to save"); return; }
    setShowForm(false); reload();
  }

  async function handleDelete(d: DonorRecord) {
    if (!confirm(`Delete donor "${d.name}"? This cannot be undone.`)) return;
    await callApi("delete", { record: { type: "donor", __backendId: d.__backendId } });
    reload();
  }

  const fmtINR = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  if (loading) return <div className="text-center py-12 text-theme-muted">Loading donors...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-display text-2xl font-bold text-theme-primary">Registered Donors ({donors.length})</h1>
        <div className="flex gap-2">
          <input type="text" placeholder="Search name, mobile, PAN, tally..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="px-4 py-2 border border-theme rounded-lg theme-focus text-sm w-64" />
          {canManage && <button onClick={startNew} className="btn-primary text-sm font-medium px-4 py-2 rounded-lg">+ Add Donor</button>}
        </div>
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <div className="bg-white rounded-xl card-shadow border border-theme p-5 space-y-3">
          <h2 className="font-display font-semibold text-theme-primary">{editing ? "Edit Donor" : "New Donor"}</h2>
          {formError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-2">{formError}</div>}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Spiritual Name" value={form.spiritualName} onChange={(e) => setForm({ ...form, spiritualName: e.target.value })} />
            <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Mobile *" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
            <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="WhatsApp" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
            <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm uppercase" placeholder="PAN" value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} maxLength={10} />
            <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Tally Name" value={form.tallyName} onChange={(e) => setForm({ ...form, tallyName: e.target.value })} />
            <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Flat/Building" value={form.flat} onChange={(e) => setForm({ ...form, flat: e.target.value })} />
            <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Road/Street" value={form.road} onChange={(e) => setForm({ ...form, road: e.target.value })} />
            <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Area" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
            <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Pincode" value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} maxLength={6} />
            <select className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" value={form.centerId} onChange={(e) => setForm({ ...form, centerId: e.target.value })}>
              <option value="">Select center</option>
              {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving} className="btn-primary text-sm px-4 py-2 rounded-lg">{saving ? "Saving..." : "Save"}</button>
            <button onClick={() => setShowForm(false)} className="text-sm px-4 py-2 border border-theme rounded-lg text-theme-secondary">Cancel</button>
          </div>
        </div>
      )}

      {/* Donors table */}
      <div className="bg-white rounded-xl card-shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-theme-muted text-theme-secondary">
              <tr>
                <th className="px-3 py-3 text-left font-medium">Name</th>
                <th className="px-3 py-3 text-left font-medium">Mobile</th>
                <th className="px-3 py-3 text-left font-medium">Tally Name</th>
                <th className="px-3 py-3 text-left font-medium">Area</th>
                <th className="px-3 py-3 text-right font-medium">Bookings</th>
                <th className="px-3 py-3 text-right font-medium">Total Donated</th>
                <th className="px-3 py-3 text-left font-medium">Center</th>
                <th className="px-3 py-3 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-theme-muted">
              {donors.slice(0, 200).map((d) => {
                const center = centers.find((c) => c.id === d.centerId);
                const st = donorStats.get(d.__backendId);
                return (
                  <tr key={d.__backendId} className="hover:bg-theme-page transition">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-theme-primary">{d.name}</div>
                      {d.spiritualName && <div className="text-xs text-theme-muted">{d.spiritualName}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-theme-secondary">{d.mobile}</td>
                    <td className="px-3 py-2.5 text-theme-secondary">{d.tallyName || "—"}</td>
                    <td className="px-3 py-2.5 text-theme-secondary">{d.area || "—"}</td>
                    <td className="px-3 py-2.5 text-right">
                      {st ? <span className="bg-theme-muted text-theme-secondary text-xs px-2 py-0.5 rounded-full">{st.count}</span> : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium text-theme-primary">{st ? fmtINR(st.total) : "₹0"}</td>
                    <td className="px-3 py-2.5 text-theme-secondary">{center?.name || "—"}</td>
                    <td className="px-3 py-2.5 space-x-1">
                      <button onClick={() => setViewDonor(d)} className="text-xs text-theme-accent hover:underline">View</button>
                      {canManage && <button onClick={() => startEdit(d)} className="text-xs text-blue-600 hover:underline">Edit</button>}
                      {isSuperuser && <button onClick={() => handleDelete(d)} className="text-xs text-red-600 hover:underline">Del</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {donors.length > 200 && <div className="px-4 py-3 text-center text-xs text-theme-muted">Showing 200 of {donors.length} — use search to narrow down</div>}
      </div>

      {/* View Donor Modal */}
      {viewDonor && (
        <div className="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4">
          <div className="bg-white rounded-xl card-shadow p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-display text-lg font-semibold text-theme-primary">Donor Details</h3>
              <button onClick={() => setViewDonor(null)} className="text-theme-muted hover:text-theme-primary text-xl">&times;</button>
            </div>
            <div className="space-y-2 text-sm">
              <Row label="Name" value={viewDonor.name} />
              <Row label="Spiritual Name" value={viewDonor.spiritualName} />
              <Row label="Mobile" value={viewDonor.mobile} />
              <Row label="WhatsApp" value={viewDonor.whatsapp} />
              <Row label="Email" value={viewDonor.email} />
              <Row label="PAN" value={viewDonor.pan} />
              <Row label="Tally Name" value={viewDonor.tallyName} />
              <div className="border-t border-theme pt-2 mt-2">
                <p className="font-medium text-theme-primary mb-1">Address</p>
              </div>
              <Row label="Flat" value={viewDonor.flat} />
              <Row label="Road" value={viewDonor.road} />
              <Row label="Area" value={viewDonor.area} />
              <Row label="Pincode" value={viewDonor.pincode} />
              <Row label="District" value={viewDonor.district} />
              <Row label="State" value={viewDonor.state} />
              <Row label="Country" value={viewDonor.country} />
              <div className="border-t border-theme pt-2 mt-2">
                <p className="font-medium text-theme-primary mb-1">Stats</p>
              </div>
              <Row label="Total Bookings" value={String(donorStats.get(viewDonor.__backendId)?.count || 0)} />
              <Row label="Total Donated" value={fmtINR(donorStats.get(viewDonor.__backendId)?.total || 0)} />
              <Row label="Last Donation" value={formatDate(donorStats.get(viewDonor.__backendId)?.lastDate)} />
              <Row label="Center" value={centers.find((c) => c.id === viewDonor.centerId)?.name || "—"} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex">
      <span className="w-32 flex-shrink-0 text-theme-muted">{label}:</span>
      <span className="text-theme-primary">{value || "—"}</span>
    </div>
  );
}
