"use client";

import { useState } from "react";
import { useAllData, byType } from "@/lib/use-all-data";
import { useAuth } from "@/lib/auth-context";
import { callApi } from "@/lib/client";

interface TempleRecord { __backendId: string; id: string; name: string; city: string; state: string; isActive: boolean; }
interface CenterRecord { id: string; name: string; templeId: string; }
interface UserRecord { centerId: string; role: string; }
interface DonorRecord { centerId: string; }

export default function TemplesPage() {
  const { data, loading, reload } = useAllData();
  const { isSuperuser } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", city: "", state: "" });
  const [saving, setSaving] = useState(false);

  const temples = byType<TempleRecord>(data, "temple");
  const centers = byType<CenterRecord>(data, "center");
  const users = byType<UserRecord>(data, "user");
  const donors = byType<DonorRecord>(data, "donor");

  async function handleSave() {
    setSaving(true);
    await callApi("create", { record: { type: "temple", ...form } });
    setSaving(false); setShowForm(false); setForm({ name: "", city: "", state: "" }); reload();
  }

  if (loading) return <div className="text-center py-12 text-theme-muted">Loading...</div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl card-shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="font-display text-xl font-semibold text-theme-primary">Temple Hierarchy</h3>
            <p className="text-sm text-theme-secondary mt-1">Temples contain centers. Under each center: Volunteers, Counters/Kiosks, and Donors.</p>
          </div>
          {isSuperuser && <button onClick={() => setShowForm(true)} className="btn-primary text-sm px-4 py-2 rounded-lg">Add Temple</button>}
        </div>

        {showForm && (
          <div className="bg-theme-page rounded-lg p-4 mb-6 space-y-3 border border-theme">
            <h4 className="font-semibold text-theme-primary">New Temple</h4>
            <div className="grid grid-cols-3 gap-3">
              <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Temple Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <button onClick={handleSave} disabled={saving} className="btn-primary text-sm px-4 py-2 rounded-lg">{saving ? "Saving..." : "Save"}</button>
              <button onClick={() => setShowForm(false)} className="text-sm px-4 py-2 border border-theme rounded-lg text-theme-secondary">Cancel</button>
            </div>
          </div>
        )}

        {temples.length === 0 ? (
          <p className="text-center text-theme-muted py-8">No temples yet. Add a temple to get started.</p>
        ) : (
          <div className="space-y-4">
            {temples.map((t) => {
              const templeCenters = centers.filter((c) => c.templeId === (t.__backendId || t.id));
              return (
                <div key={t.__backendId || t.id} className="border border-theme rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-display font-semibold text-theme-primary text-lg">{t.name}</h4>
                      <p className="text-sm text-theme-secondary">{[t.city, t.state].filter(Boolean).join(", ") || "—"}</p>
                    </div>
                    <span className="text-xs bg-theme-muted text-theme-secondary px-2 py-1 rounded-full">{templeCenters.length} center(s)</span>
                  </div>
                  {templeCenters.length > 0 && (
                    <div className="mt-3 ml-4 space-y-2">
                      {templeCenters.map((c) => {
                        const centerUsers = users.filter((u) => u.centerId === c.id).length;
                        const centerDonors = donors.filter((d) => d.centerId === c.id).length;
                        return (
                          <div key={c.id} className="flex items-center gap-4 bg-theme-page rounded-lg px-3 py-2 text-sm">
                            <span className="font-medium text-theme-primary">{c.name}</span>
                            <span className="text-theme-muted">{centerUsers} users</span>
                            <span className="text-theme-muted">{centerDonors} donors</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
