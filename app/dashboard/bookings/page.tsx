"use client";

import { useState, useMemo } from "react";
import { useAllData, byType } from "@/lib/use-all-data";
import { callApi } from "@/lib/client";

interface BookingRecord {
  __backendId: string; donorId: string; items: Array<{ name?: string; amount?: number; quantity?: number }>;
  totalAmount: number; paymentStatus: string; paymentMode: string; bookingDate: string;
  centerId: string; collectedBy: string; remarks: string;
}
interface DonorRecord { __backendId: string; name: string; }
interface SevaRecord { id: string; name: string; amount: number; }

export default function BookingsPage() {
  const { data, loading, reload } = useAllData();
  const [filter, setFilter] = useState<"all" | "paid" | "pending">("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState({ donorId: "", sevaId: "", amount: "0", quantity: "1", paymentStatus: "pending", paymentMode: "cash", bookingDate: new Date().toISOString().split("T")[0] });

  const donors = byType<DonorRecord>(data, "donor");
  const sevas = byType<SevaRecord>(data, "seva");

  const bookings = useMemo(() => {
    let all = byType<BookingRecord>(data, "booking");
    if (filter !== "all") all = all.filter((b) => b.paymentStatus === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      const donorMap = new Map(donors.map((d) => [d.__backendId, d.name.toLowerCase()]));
      all = all.filter((b) => {
        const dname = donorMap.get(b.donorId) || "";
        return dname.includes(q) || b.remarks?.toLowerCase().includes(q) || b.__backendId.includes(q);
      });
    }
    return all.sort((a, b) => String(b.bookingDate || "").localeCompare(String(a.bookingDate || "")));
  }, [data, filter, search, donors]);

  const donorName = (id: string) => donors.find((d) => d.__backendId === id)?.name || "—";
  const fmtINR = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  async function handleSave() {
    setSaving(true);
    setFormError("");
    const seva = sevas.find((s) => s.id === form.sevaId);
    const amount = Number(form.amount) || seva?.amount || 0;
    const qty = Number(form.quantity) || 1;
    const result = await callApi("create", {
      record: {
        type: "booking",
        donorId: form.donorId,
        items: [{ sevaId: form.sevaId, name: seva?.name || "Custom", amount, quantity: qty, bookingDate: form.bookingDate }],
        totalAmount: amount * qty,
        paymentStatus: form.paymentStatus,
        paymentMode: form.paymentMode,
        bookingDate: form.bookingDate,
      },
    });
    setSaving(false);
    if (!result.isOk) { setFormError((result as { error?: string }).error || "Failed"); return; }
    setShowForm(false);
    setForm({ donorId: "", sevaId: "", amount: "0", quantity: "1", paymentStatus: "pending", paymentMode: "cash", bookingDate: new Date().toISOString().split("T")[0] });
    reload();
  }

  if (loading) return <div className="text-center py-12 text-gray-400">Loading bookings...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-800">Bookings ({bookings.length})</h1>
        <div className="flex gap-2 flex-wrap">
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="px-3 py-2 border rounded-lg text-sm">
            <option value="all">All</option>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
          </select>
          <input type="text" placeholder="Search donor..." value={search} onChange={(e) => setSearch(e.target.value)} className="px-3 py-2 border rounded-lg text-sm w-48" />
          <button onClick={() => setShowForm(true)} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg">+ New Booking</button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white border rounded-xl p-5 space-y-3">
          <h2 className="font-semibold">New Booking</h2>
          {formError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-2">{formError}</div>}
          <div className="grid grid-cols-2 gap-3">
            <select className="px-3 py-2 border rounded-lg text-sm" value={form.donorId} onChange={(e) => setForm({ ...form, donorId: e.target.value })}>
              <option value="">Select donor *</option>
              {donors.slice(0, 200).map((d) => <option key={d.__backendId} value={d.__backendId}>{d.name}</option>)}
            </select>
            <select className="px-3 py-2 border rounded-lg text-sm" value={form.sevaId} onChange={(e) => setForm({ ...form, sevaId: e.target.value, amount: String(sevas.find((s) => s.id === e.target.value)?.amount ?? form.amount) })}>
              <option value="">Select seva</option>
              {sevas.map((s) => <option key={s.id} value={s.id}>{s.name} (₹{s.amount})</option>)}
            </select>
            <input type="number" className="px-3 py-2 border rounded-lg text-sm" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <input type="number" className="px-3 py-2 border rounded-lg text-sm" placeholder="Qty" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            <select className="px-3 py-2 border rounded-lg text-sm" value={form.paymentStatus} onChange={(e) => setForm({ ...form, paymentStatus: e.target.value })}>
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
            </select>
            <select className="px-3 py-2 border rounded-lg text-sm" value={form.paymentMode} onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="online">Online</option>
              <option value="upi">UPI</option>
            </select>
            <input type="date" className="px-3 py-2 border rounded-lg text-sm" value={form.bookingDate} onChange={(e) => setForm({ ...form, bookingDate: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving} className="bg-orange-500 hover:bg-orange-600 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50">{saving ? "Saving..." : "Save"}</button>
            <button onClick={() => setShowForm(false)} className="text-sm px-4 py-2 border rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Donor</th>
                <th className="px-4 py-2 text-left font-medium">Sevas</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 text-center font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Date</th>
                <th className="px-4 py-2 text-left font-medium">Mode</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {bookings.slice(0, 100).map((b) => (
                <tr key={b.__backendId} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium">{donorName(b.donorId)}</td>
                  <td className="px-4 py-2.5 text-gray-600">{b.items?.map((i) => `${i.name || "—"} ×${i.quantity || 1}`).join(", ") || "—"}</td>
                  <td className="px-4 py-2.5 text-right font-medium">{fmtINR(b.totalAmount || 0)}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${b.paymentStatus === "paid" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>{b.paymentStatus}</span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">{String(b.bookingDate || "—").split("T")[0]}</td>
                  <td className="px-4 py-2.5 text-gray-500 capitalize">{b.paymentMode || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {bookings.length > 100 && <div className="px-4 py-3 text-center text-xs text-gray-400">Showing 100 of {bookings.length}</div>}
      </div>
    </div>
  );
}
