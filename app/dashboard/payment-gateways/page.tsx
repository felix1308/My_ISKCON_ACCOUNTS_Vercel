"use client";

import { useState } from "react";
import { useAllData, byType } from "@/lib/use-all-data";
import { useAuth } from "@/lib/auth-context";
import { callApi } from "@/lib/client";

interface GatewayRecord {
  __backendId: string; id: string; name: string; razorpayKeyId: string; isActive: boolean;
}

export default function PaymentGatewaysPage() {
  const { data, loading, reload } = useAllData();
  const { isSuperuser } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<GatewayRecord | null>(null);
  const [form, setForm] = useState({ name: "", razorpayKeyId: "", razorpayKeySecret: "" });
  const [saving, setSaving] = useState(false);

  const gateways = byType<GatewayRecord>(data, "payment_gateway");

  function startNew() { setEditing(null); setForm({ name: "", razorpayKeyId: "", razorpayKeySecret: "" }); setShowForm(true); }
  function startEdit(g: GatewayRecord) { setEditing(g); setForm({ name: g.name, razorpayKeyId: g.razorpayKeyId, razorpayKeySecret: "" }); setShowForm(true); }

  async function handleSave() {
    setSaving(true);
    const record: Record<string, unknown> = { type: "payment_gateway", name: form.name, razorpayKeyId: form.razorpayKeyId };
    if (form.razorpayKeySecret) record.razorpayKeySecret = form.razorpayKeySecret;
    if (editing) {
      record.__backendId = editing.__backendId || editing.id;
      await callApi("update", { record });
    } else {
      await callApi("create", { record });
    }
    setSaving(false); setShowForm(false); reload();
  }

  async function handleDelete(g: GatewayRecord) {
    if (!confirm(`Delete payment gateway "${g.name}"? Linked bank accounts will lose their gateway credentials.`)) return;
    await callApi("delete", { record: { type: "payment_gateway", __backendId: g.__backendId || g.id } });
    reload();
  }

  if (!isSuperuser) return <div className="text-center py-12 text-theme-muted">Superadmin access required.</div>;
  if (loading) return <div className="text-center py-12 text-theme-muted">Loading...</div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl card-shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="font-display text-xl font-semibold text-theme-primary">Payment Gateways</h3>
            <p className="text-sm text-theme-secondary mt-1">Add Razorpay credentials (Key ID and Key Secret) for processing online payments.</p>
          </div>
          <button onClick={startNew} className="btn-primary text-sm px-4 py-2 rounded-lg">Add Payment Gateway</button>
        </div>

        {showForm && (
          <div className="bg-theme-page rounded-lg p-4 mb-6 space-y-3 border border-theme">
            <h4 className="font-semibold text-theme-primary">{editing ? "Edit Gateway" : "New Gateway"}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm font-mono" placeholder="Razorpay Key ID *" value={form.razorpayKeyId} onChange={(e) => setForm({ ...form, razorpayKeyId: e.target.value })} />
              <input type="password" className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder={editing ? "Key Secret (leave blank to keep)" : "Razorpay Key Secret *"} value={form.razorpayKeySecret} onChange={(e) => setForm({ ...form, razorpayKeySecret: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <button onClick={handleSave} disabled={saving} className="btn-primary text-sm px-4 py-2 rounded-lg">{saving ? "Saving..." : "Save"}</button>
              <button onClick={() => setShowForm(false)} className="text-sm px-4 py-2 border border-theme rounded-lg text-theme-secondary">Cancel</button>
            </div>
          </div>
        )}

        {gateways.length === 0 ? (
          <p className="text-center text-theme-muted py-8">No payment gateways yet. Add one to enable online payments.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-theme-muted text-theme-secondary">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">#</th>
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">Razorpay Key ID</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-muted">
                {gateways.map((g, i) => (
                  <tr key={g.__backendId || g.id} className="hover:bg-theme-page transition">
                    <td className="px-4 py-2.5 text-theme-muted">{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium text-theme-primary">{g.name}</td>
                    <td className="px-4 py-2.5 text-theme-secondary font-mono text-xs">{g.razorpayKeyId || "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${g.isActive !== false ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {g.isActive !== false ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <button onClick={() => startEdit(g)} className="text-xs text-theme-accent hover:underline mr-2">Edit</button>
                      <button onClick={() => handleDelete(g)} className="text-xs text-red-600 hover:underline">Delete</button>
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
