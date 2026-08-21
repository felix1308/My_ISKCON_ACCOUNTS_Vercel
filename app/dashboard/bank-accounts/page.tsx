"use client";

import { useState } from "react";
import { useAllData, byType } from "@/lib/use-all-data";
import { useAuth } from "@/lib/auth-context";
import { callApi } from "@/lib/client";

interface BankRecord {
  __backendId: string; id: string; name: string; accountNumber: string;
  bankName: string; centerId: string; paymentGatewayId: string; isActive: boolean;
}

export default function BankAccountsPage() {
  const { data, loading, reload } = useAllData();
  const { isSuperuser } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BankRecord | null>(null);
  const [form, setForm] = useState({ name: "", accountNumber: "", bankName: "", centerId: "", paymentGatewayId: "" });
  const [saving, setSaving] = useState(false);

  const banks = byType<BankRecord>(data, "bank_account");
  const centers = byType<{ id: string; name: string }>(data, "center");
  const gateways = byType<{ id: string; name: string }>(data, "payment_gateway");

  function startNew() { setEditing(null); setForm({ name: "", accountNumber: "", bankName: "", centerId: "", paymentGatewayId: "" }); setShowForm(true); }
  function startEdit(b: BankRecord) { setEditing(b); setForm({ name: b.name, accountNumber: b.accountNumber, bankName: b.bankName, centerId: b.centerId, paymentGatewayId: b.paymentGatewayId }); setShowForm(true); }

  async function handleSave() {
    setSaving(true);
    if (editing) {
      await callApi("update", { record: { type: "bank_account", __backendId: editing.__backendId || editing.id, ...form } });
    } else {
      await callApi("create", { record: { type: "bank_account", ...form } });
    }
    setSaving(false); setShowForm(false); reload();
  }

  async function handleDelete(b: BankRecord) {
    if (!confirm(`Delete bank account "${b.name}"?`)) return;
    await callApi("delete", { record: { type: "bank_account", __backendId: b.__backendId || b.id } });
    reload();
  }

  if (!isSuperuser) return <div className="text-center py-12 text-theme-muted">Superadmin access required.</div>;
  if (loading) return <div className="text-center py-12 text-theme-muted">Loading...</div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl card-shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="font-display text-xl font-semibold text-theme-primary">Bank Accounts</h3>
            <p className="text-sm text-theme-secondary mt-1">Add bank accounts for cheque deposits. These appear in the Cheque tab dropdown.</p>
          </div>
          <button onClick={startNew} className="btn-primary text-sm px-4 py-2 rounded-lg">Add Bank Account</button>
        </div>

        {showForm && (
          <div className="bg-theme-page rounded-lg p-4 mb-6 space-y-3 border border-theme">
            <h4 className="font-semibold text-theme-primary">{editing ? "Edit Bank Account" : "New Bank Account"}</h4>
            <div className="grid grid-cols-2 gap-3">
              <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Account Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Account Number" value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} />
              <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Bank Name" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
              <select className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" value={form.centerId} onChange={(e) => setForm({ ...form, centerId: e.target.value })}>
                <option value="">Select Center</option>
                {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" value={form.paymentGatewayId} onChange={(e) => setForm({ ...form, paymentGatewayId: e.target.value })}>
                <option value="">Payment Gateway</option>
                {gateways.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSave} disabled={saving} className="btn-primary text-sm px-4 py-2 rounded-lg">{saving ? "Saving..." : "Save"}</button>
              <button onClick={() => setShowForm(false)} className="text-sm px-4 py-2 border border-theme rounded-lg text-theme-secondary">Cancel</button>
            </div>
          </div>
        )}

        {banks.length === 0 ? (
          <p className="text-center text-theme-muted py-8">No bank accounts yet. Add a bank account to get started.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-theme-muted text-theme-secondary">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">#</th>
                  <th className="px-4 py-3 text-left font-medium">Account Name</th>
                  <th className="px-4 py-3 text-left font-medium">Account Number</th>
                  <th className="px-4 py-3 text-left font-medium">Bank Name</th>
                  <th className="px-4 py-3 text-left font-medium">Center</th>
                  <th className="px-4 py-3 text-left font-medium">Gateway</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-muted">
                {banks.map((b, i) => (
                  <tr key={b.__backendId || b.id} className="hover:bg-theme-page transition">
                    <td className="px-4 py-2.5 text-theme-muted">{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium text-theme-primary">{b.name}</td>
                    <td className="px-4 py-2.5 text-theme-secondary font-mono text-xs">{b.accountNumber || "—"}</td>
                    <td className="px-4 py-2.5 text-theme-secondary">{b.bankName || "—"}</td>
                    <td className="px-4 py-2.5 text-theme-secondary">{centers.find((c) => c.id === b.centerId)?.name || "—"}</td>
                    <td className="px-4 py-2.5 text-theme-secondary">{gateways.find((g) => g.id === b.paymentGatewayId)?.name || "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${b.isActive !== false ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {b.isActive !== false ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <button onClick={() => startEdit(b)} className="text-xs text-theme-accent hover:underline mr-2">Edit</button>
                      <button onClick={() => handleDelete(b)} className="text-xs text-red-600 hover:underline">Delete</button>
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
