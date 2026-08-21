"use client";

import { useState, useMemo } from "react";
import { useAllData, byType } from "@/lib/use-all-data";
import { useAuth } from "@/lib/auth-context";
import { callApi } from "@/lib/client";

interface DonorRecord {
  __backendId: string; name: string; spiritualName: string; tallyName: string;
  mobile: string; whatsapp: string; centerId: string;
}
interface BookingRecord { donorId: string; totalAmount: number; paymentStatus: string; }

export default function DonorLoginsPage() {
  const { data, loading } = useAllData();
  const { isSuperuser } = useAuth();
  const [search, setSearch] = useState("");
  const [centerFilter, setCenterFilter] = useState("");
  const [sendingAll, setSendingAll] = useState(false);
  const [sendStatus, setSendStatus] = useState("");

  const donors = byType<DonorRecord>(data, "donor");
  const bookings = byType<BookingRecord>(data, "booking");
  const centers = byType<{ id: string; name: string }>(data, "center");

  const donorStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of bookings) {
      if (b.paymentStatus === "paid") {
        map.set(b.donorId, (map.get(b.donorId) || 0) + (b.totalAmount || 0));
      }
    }
    return map;
  }, [bookings]);

  const filtered = useMemo(() => {
    let list = donors;
    if (centerFilter) list = list.filter((d) => d.centerId === centerFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((d) => d.name?.toLowerCase().includes(q) || d.mobile?.includes(q));
    }
    return list;
  }, [donors, centerFilter, search]);

  async function sendBulkWhatsApp() {
    if (!confirm("Send login credentials to all donors via WhatsApp (BhashSMS)?")) return;
    setSendingAll(true);
    setSendStatus("Sending...");
    const result = await callApi("sendBulkDonorLoginWhatsApp", {});
    setSendingAll(false);
    setSendStatus(result.isOk ? "Sent successfully!" : ((result as { error?: string }).error || "Failed"));
  }

  async function sendSingle(donor: DonorRecord) {
    const result = await callApi("sendDonorLoginWhatsApp", {
      phone: donor.whatsapp || donor.mobile,
      name: donor.name,
    });
    if (!result.isOk) alert((result as { error?: string }).error || "Failed");
  }

  function downloadCSV() {
    const rows = [["Name", "Tally Name", "Spiritual Name", "Mobile", "Username", "Password", "Total Donated"]];
    for (const d of filtered) {
      rows.push([d.name, d.tallyName || "", d.spiritualName || "", d.mobile, d.name, d.name, String(donorStats.get(d.__backendId) || 0)]);
    }
    const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "donor_logins.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  // Bulk-upload format for bhashsms.com: mobile,var1,var2 (91-prefixed mobile, name twice)
  function downloadBhashSMSCSV() {
    const rows = [["mobile", "var1", "var2"]];
    for (const d of filtered) {
      const mobile10 = String(d.mobile || "").replace(/\D/g, "").slice(-10);
      if (!/^\d{10}$/.test(mobile10)) continue;
      rows.push([`91${mobile10}`, d.name || "", d.name || ""]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "bhashsms_upload.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  if (!isSuperuser) return <div className="text-center py-12 text-theme-muted">Superadmin access required.</div>;
  if (loading) return <div className="text-center py-12 text-theme-muted">Loading...</div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl card-shadow p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h3 className="font-display text-xl font-semibold text-theme-primary">Donor Login Credentials</h3>
            <p className="text-sm text-theme-secondary mt-1">Share these login details with donors so they can access their donation history.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={downloadCSV} className="text-sm px-3 py-2 border border-theme rounded-lg text-theme-secondary hover:text-theme-primary">Download CSV</button>
            <button onClick={downloadBhashSMSCSV} className="text-sm px-3 py-2 border border-theme rounded-lg text-theme-secondary hover:text-theme-primary">BhashSMS CSV</button>
            <button onClick={sendBulkWhatsApp} disabled={sendingAll} className="btn-primary text-sm px-3 py-2 rounded-lg">{sendingAll ? "Sending..." : "Send via BhashSMS"}</button>
          </div>
        </div>

        {sendStatus && <div className="text-sm text-theme-muted mb-3">{sendStatus}</div>}

        <div className="bg-theme-page border border-theme rounded-lg p-3 mb-4 text-sm text-theme-secondary">
          <strong>Note:</strong> For demo purposes, both username and password are the donor&apos;s Legal Name. Donors can change their password after first login.
        </div>

        <div className="flex gap-3 mb-4 flex-wrap">
          <select value={centerFilter} onChange={(e) => setCenterFilter(e.target.value)} className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm">
            <option value="">All Centers</option>
            {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input type="text" placeholder="Search name or mobile..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm w-64" />
        </div>

        {filtered.length === 0 ? (
          <p className="text-center text-theme-muted py-8">No donors found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-theme-muted text-theme-secondary">
                <tr>
                  <th className="px-3 py-3 text-left font-medium">#</th>
                  <th className="px-3 py-3 text-left font-medium">Legal Name</th>
                  <th className="px-3 py-3 text-left font-medium">Tally Name</th>
                  <th className="px-3 py-3 text-left font-medium">Spiritual Name</th>
                  <th className="px-3 py-3 text-left font-medium">Mobile</th>
                  <th className="px-3 py-3 text-left font-medium">Username</th>
                  <th className="px-3 py-3 text-right font-medium">Total Donated</th>
                  <th className="px-3 py-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-muted">
                {filtered.slice(0, 200).map((d, i) => (
                  <tr key={d.__backendId} className="hover:bg-theme-page transition">
                    <td className="px-3 py-2 text-theme-muted">{i + 1}</td>
                    <td className="px-3 py-2 font-medium text-theme-primary">{d.name}</td>
                    <td className="px-3 py-2 text-theme-secondary">{d.tallyName || "—"}</td>
                    <td className="px-3 py-2 text-theme-secondary">{d.spiritualName || "—"}</td>
                    <td className="px-3 py-2 text-theme-secondary">{d.mobile}</td>
                    <td className="px-3 py-2 text-theme-secondary font-mono text-xs">{d.name}</td>
                    <td className="px-3 py-2 text-right text-theme-primary">₹{(donorStats.get(d.__backendId) || 0).toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => sendSingle(d)} className="text-xs text-theme-accent hover:underline">Send WhatsApp</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > 200 && <div className="text-center text-xs text-theme-muted py-2">Showing 200 of {filtered.length}</div>}
      </div>
    </div>
  );
}
