"use client";

import { useState, useMemo } from "react";
import { useAllData, byType } from "@/lib/use-all-data";
import { useAuth } from "@/lib/auth-context";
import { callApi } from "@/lib/client";
import { formatDate } from "@/lib/format";
import { loadSheetJs } from "@/lib/excel";
import { openReceiptsWindow } from "@/lib/receipt";

interface BookingRecord {
  __backendId: string; totalAmount: number; paymentStatus: string; bookingDate: string;
  centerId: string; paymentMode: string; donorId: string; collectedBy: string;
  items: Array<{ id?: string; sevaId?: string; name?: string; amount?: number; quantity?: number }>;
  remarks: string;
  razorpayOrderId?: string; razorpayPaymentId?: string; paidAt?: string;
  createdAt?: string;
}
interface DonorRecord {
  __backendId: string; name: string; mobile: string; email: string; pan: string;
  flat?: string; road?: string; po?: string; area?: string; pincode?: string;
  district?: string; state?: string; country?: string;
}
interface CenterRecord { id: string; name: string; }
interface SevaRecord { id: string; darshanQR?: string | boolean; sevaQR?: string | boolean; prasadamQR?: string | boolean; }

type DateRange = "all" | "today" | "week" | "month" | "year";

/** Remarks helpers (ported from legacy renderReportsTable). */
function parse10beUrlFromRemarks(remarks: string): string {
  const m = remarks?.match(/10beUrl:(https?:\/\/\S+)/);
  return m ? m[1].trim() : "";
}
function parseVoucherNoFromRemarks(remarks: string): string {
  const m = remarks?.match(/voucherNo:(.+?)(?:\s*\|[^|]*bank:|$)/);
  return m ? m[1].trim() : "";
}

export default function ReportsPage() {
  const { data, loading, reload } = useAllData();
  const { hasPermission, isSuperuser, user } = useAuth();
  const [statusFilter, setStatusFilter] = useState("paid");
  const [collectorFilter, setCollectorFilter] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [excelLoading, setExcelLoading] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [tenbeLoadingId, setTenbeLoadingId] = useState<string | null>(null);

  const allBookings = byType<BookingRecord>(data, "booking");
  const donors = byType<DonorRecord>(data, "donor");
  const centers = byType<CenterRecord>(data, "center");
  const sevas = byType<SevaRecord>(data, "seva");

  const canReceipts = hasPermission("receipts") || isSuperuser;
  const isDonorView = user?.isDonor === true;

  // Unique collectors
  const collectors = useMemo(() => {
    const set = new Set<string>();
    allBookings.forEach((b) => { if (b.collectedBy) set.add(b.collectedBy); });
    return Array.from(set).sort();
  }, [allBookings]);

  // Filtered bookings
  const bookings = useMemo(() => {
    let list = [...allBookings];
    if (statusFilter !== "all") list = list.filter((b) => b.paymentStatus === statusFilter);
    if (collectorFilter) list = list.filter((b) => b.collectedBy === collectorFilter);

    // Date filtering
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];
    if (startDate || endDate) {
      list = list.filter((b) => {
        const ds = (b.bookingDate || "").split("T")[0];
        if (startDate && ds < startDate) return false;
        if (endDate && ds > endDate) return false;
        return true;
      });
    } else if (dateRange === "today") {
      list = list.filter((b) => (b.bookingDate || "").split("T")[0] === todayStr);
    } else if (dateRange === "week") {
      const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().split("T")[0];
      list = list.filter((b) => (b.bookingDate || "").split("T")[0] >= weekAgo);
    } else if (dateRange === "month") {
      const monthStr = todayStr.slice(0, 7);
      list = list.filter((b) => (b.bookingDate || "").split("T")[0].slice(0, 7) === monthStr);
    } else if (dateRange === "year") {
      const yearStr = todayStr.slice(0, 4);
      list = list.filter((b) => (b.bookingDate || "").split("T")[0].slice(0, 4) === yearStr);
    }

    // Latest donations first. Only valid YYYY-MM-DD dates participate in the
    // sort; garbage/empty legacy dates sink to the bottom. createdAt breaks ties.
    const dateKey = (b: BookingRecord) => formatDate(b.bookingDate, "");
    return list.sort((a, b) => {
      const cmp = dateKey(b).localeCompare(dateKey(a));
      if (cmp !== 0) return cmp;
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
  }, [allBookings, statusFilter, collectorFilter, dateRange, startDate, endDate]);

  const total = bookings.reduce((s, b) => s + (b.totalAmount || 0), 0);
  const fmtINR = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  const findDonor = (id: string) => donors.find((d) => d.__backendId === id);
  const donorName = (id: string) => findDonor(id)?.name || "—";
  const centerName = (id: string) => centers.find((c) => c.id === id)?.name || "—";

  function downloadCSV() {
    const header = ["Date", "Donor", "Mobile", "Sevas", "Amount", "Collected By", "Center", "Status", "Payment Mode", "Remarks", "Booking ID"];
    const rows = bookings.map((b) => {
      const donor = findDonor(b.donorId);
      return [
        formatDate(b.bookingDate),
        donor?.name || "", donor?.mobile || "",
        b.items?.map((i) => `${i.name || "—"} x${i.quantity || 1}`).join("; ") || "",
        String(b.totalAmount || 0), b.collectedBy || "",
        centerName(b.centerId), b.paymentStatus, b.paymentMode || "",
        b.remarks || "", b.__backendId,
      ];
    });
    const csv = "\uFEFF" + [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `reports_${new Date().toISOString().split("T")[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadExcel() {
    if (bookings.length === 0) { alert("No reports to download"); return; }
    setExcelLoading(true);
    try {
      const XLSX = await loadSheetJs();
      const rows = bookings.map((b) => {
        const donor = findDonor(b.donorId);
        return {
          "Date": formatDate(b.bookingDate),
          "Donor": donor?.name || "",
          "Mobile": donor?.mobile || "",
          "Sevas": b.items?.map((i) => `${i.name || "—"} x${i.quantity || 1}`).join("; ") || "",
          "Amount": b.totalAmount || 0,
          "Collected By": b.collectedBy || "",
          "Center": centerName(b.centerId),
          "Status": b.paymentStatus,
          "Payment Mode": b.paymentMode || "",
          "Remarks": b.remarks || "",
          "Razorpay Order ID": b.razorpayOrderId || "",
          "Razorpay Payment ID": b.razorpayPaymentId || "",
          "Paid At": b.paidAt ? new Date(b.paidAt).toLocaleString("en-GB") : "",
          "Booking ID": b.__backendId,
        };
      });
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = [
        { wch: 12 }, { wch: 20 }, { wch: 15 }, { wch: 40 }, { wch: 12 },
        { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 14 }, { wch: 30 },
        { wch: 22 }, { wch: 22 }, { wch: 20 }, { wch: 25 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, "Reports");
      const today = new Date().toISOString().split("T")[0];
      const filename = (startDate && endDate)
        ? `reports_${startDate}_to_${endDate}.xlsx`
        : `reports_${today}.xlsx`;
      XLSX.writeFile(wb, filename);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Excel export failed");
    } finally {
      setExcelLoading(false);
    }
  }

  function printReport() {
    const rows = bookings.map((b) => {
      return `<tr><td>${formatDate(b.bookingDate)}</td><td>${donorName(b.donorId)}</td><td>${b.items?.map((i) => i.name).join(", ") || "—"}</td><td style="text-align:right">${fmtINR(b.totalAmount || 0)}</td><td>${b.paymentStatus}</td></tr>`;
    }).join("");
    const html = `<html><head><title>Report</title><style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px 8px;font-size:12px}th{background:#f5f5f5}h2{margin:0 0 4px}</style></head><body><h2>MyISKCON Accounts — Report</h2><p style="font-size:12px;color:#666">Generated: ${new Date().toLocaleString()}</p><p><strong>Total: ${fmtINR(total)}</strong> (${bookings.length} transactions)</p><table><thead><tr><th>Date</th><th>Donor</th><th>Sevas</th><th>Amount</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.print(); }
  }

  // ---- Acknowledgement receipts (port of legacy generateReceipts) ----
  function handleReceipt(b: BookingRecord) {
    const donor = findDonor(b.donorId);
    if (!donor) { alert("Donor not found - please check the booking details"); return; }
    if (!b.items || b.items.length === 0) { alert("No sevas in this booking"); return; }
    const ok = openReceiptsWindow(b, donor, sevas);
    if (!ok) alert("Could not open the receipt window — please allow popups for this site.");
  }

  // ---- 10BE download ----
  async function handle10be(b: BookingRecord) {
    // First: read 10beUrl directly from remarks (stored during import)
    const directUrl = parse10beUrlFromRemarks(b.remarks);
    if (directUrl) { window.open(directUrl, "_blank", "noopener"); return; }

    // Fallback: server-side fuzzy lookup in ten_be_records
    const voucherNo = parseVoucherNoFromRemarks(b.remarks);
    if (!voucherNo) return;
    setTenbeLoadingId(b.__backendId);
    try {
      const donor = findDonor(b.donorId);
      const result = await callApi("lookup10BeUrl", {
        voucherNo,
        pan: donor?.pan || "",
        amount: b.totalAmount ?? null,
        date: formatDate(b.bookingDate, ""),
      });
      const url = (result as unknown as { url?: string }).url;
      if (result.isOk && url) {
        window.open(url, "_blank", "noopener");
      } else {
        alert("No 10BE receipt found for this booking.");
      }
    } finally {
      setTenbeLoadingId(null);
    }
  }

  // ---- Pay Now for pending bookings (port of legacy payPendingBooking) ----
  async function handlePayNow(b: BookingRecord) {
    if (b.paymentStatus === "paid") return;
    const RazorpayClass = (globalThis as unknown as { Razorpay?: new (opts: Record<string, unknown>) => { open: () => void } }).Razorpay;
    if (!RazorpayClass) { alert("Razorpay is still loading. Please wait a moment and try again."); return; }
    const totalAmt = b.totalAmount || b.items?.reduce((s, i) => s + (i.amount || 0) * (i.quantity || 1), 0) || 0;
    if (!totalAmt || totalAmt <= 0) { alert("Invalid booking amount"); return; }

    setPayingId(b.__backendId);
    try {
      const orderResult = await callApi("createRazorpayOrder", {
        amount: Math.round(totalAmt * 100),
        receipt: b.__backendId,
        currency: "INR",
        centerId: (b.centerId || "").trim() || undefined,
      });
      if (!orderResult.isOk) {
        alert((orderResult as { error?: string }).error || "Failed to create payment order");
        setPayingId(null);
        return;
      }
      const order = orderResult as Record<string, unknown>;
      const paymentGatewayId = (order.paymentGatewayId as string) || "";
      const donor = findDonor(b.donorId);

      const rzp = new RazorpayClass({
        key: order.keyId,
        amount: order.amount,
        order_id: order.orderId,
        name: "ISKCON Cultural Centre",
        description: `Pay pending booking (${b.__backendId.substring(0, 8)})`,
        prefill: { name: donor?.name || "Donor", contact: donor?.mobile || "", email: donor?.email || "" },
        handler: (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          callApi("verifyRazorpayPayment", {
            orderId: response.razorpay_order_id,
            paymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature,
            bookingId: b.__backendId,
            paymentGatewayId: paymentGatewayId || undefined,
          }).then((verifyResult) => {
            setPayingId(null);
            if (verifyResult.isOk) {
              alert("Payment successful!");
              reload();
            } else {
              alert((verifyResult as { error?: string }).error || "Payment verification failed. Contact admin with Razorpay Payment ID: " + response.razorpay_payment_id);
            }
          });
        },
        modal: { ondismiss: () => setPayingId(null) },
      });
      rzp.open();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Something went wrong");
      setPayingId(null);
    }
  }

  if (loading) return <div className="text-center py-12 text-theme-muted">Loading reports...</div>;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-xl card-shadow p-6">
        <h3 className="font-display text-xl font-bold text-theme-primary mb-4">Reports</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-theme-secondary mb-1">Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm">
              <option value="all">All Status</option>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-theme-secondary mb-1">Collected By</label>
            <select value={collectorFilter} onChange={(e) => setCollectorFilter(e.target.value)} className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm">
              <option value="">All Collectors</option>
              {collectors.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-theme-secondary mb-1">Date Range</label>
            <select value={dateRange} onChange={(e) => { setDateRange(e.target.value as DateRange); setStartDate(""); setEndDate(""); }} className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm">
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="year">This Year</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-theme-secondary mb-1">Start Date</label>
            <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setDateRange("all"); }} className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-theme-secondary mb-1">End Date</label>
            <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setDateRange("all"); }} className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" />
          </div>
        </div>
      </div>

      {/* Summary + Download */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="bg-white rounded-xl card-shadow border border-theme p-5">
          <div className="text-sm text-theme-muted font-medium">Total ({bookings.length} transactions)</div>
          <div className="font-display text-3xl font-bold text-theme-primary mt-1">{fmtINR(total)}</div>
        </div>
        <div className="flex gap-2">
          <button onClick={downloadCSV} className="text-sm px-4 py-2 border border-theme rounded-lg text-theme-secondary hover:text-theme-primary transition">Download CSV</button>
          <button onClick={downloadExcel} disabled={excelLoading} className="text-sm px-4 py-2 border border-theme rounded-lg text-theme-secondary hover:text-theme-primary transition disabled:opacity-50">
            {excelLoading ? "Loading Excel..." : "Excel (.xlsx)"}
          </button>
          <button onClick={printReport} className="btn-primary text-sm px-4 py-2 rounded-lg">Print / PDF</button>
        </div>
      </div>

      {/* Bookings table */}
      <div className="bg-white rounded-xl card-shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-theme-muted text-theme-secondary">
              <tr>
                <th className="px-3 py-3 text-left font-medium">Date</th>
                <th className="px-3 py-3 text-left font-medium">Donor</th>
                <th className="px-3 py-3 text-left font-medium">Sevas</th>
                <th className="px-3 py-3 text-right font-medium">Amount</th>
                <th className="px-3 py-3 text-left font-medium">Collected By</th>
                <th className="px-3 py-3 text-left font-medium">Center</th>
                <th className="px-3 py-3 text-center font-medium">Status</th>
                <th className="px-3 py-3 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-theme-muted">
              {bookings.slice(0, 200).map((b) => {
                const isPending = b.paymentStatus !== "paid";
                const remarks10beUrl = parse10beUrlFromRemarks(b.remarks);
                const voucherNo = parseVoucherNoFromRemarks(b.remarks);
                const can10be = !!remarks10beUrl || !!voucherNo;
                return (
                  <tr key={b.__backendId} className="hover:bg-theme-page transition">
                    <td className="px-3 py-2.5 text-theme-secondary">{formatDate(b.bookingDate)}</td>
                    <td className="px-3 py-2.5 font-medium text-theme-primary">{donorName(b.donorId)}</td>
                    <td className="px-3 py-2.5 text-theme-secondary">{b.items?.map((i) => `${i.name || "—"} x${i.quantity || 1}`).join(", ") || "—"}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-theme-primary">{fmtINR(b.totalAmount || 0)}</td>
                    <td className="px-3 py-2.5 text-theme-secondary">{b.collectedBy || "—"}</td>
                    <td className="px-3 py-2.5 text-theme-secondary">{centerName(b.centerId)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${b.paymentStatus === "paid" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                        {b.paymentStatus}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {isPending && !isDonorView && (
                          <button
                            onClick={() => handlePayNow(b)}
                            disabled={payingId === b.__backendId}
                            className="px-2.5 py-1 rounded text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition">
                            {payingId === b.__backendId ? "Preparing..." : "Pay Now"}
                          </button>
                        )}
                        {canReceipts && (
                          <button
                            onClick={() => handleReceipt(b)}
                            className="px-2 py-1 rounded text-xs font-medium bg-amber-100 text-amber-800 hover:bg-amber-200 transition">
                            Receipt
                          </button>
                        )}
                        <button
                          onClick={() => handle10be(b)}
                          disabled={!can10be || tenbeLoadingId === b.__backendId}
                          title={can10be ? "Download 10BE receipt" : "No 10BE (no voucher/URL in remarks)"}
                          className={`px-2 py-1 rounded text-xs font-medium transition ${
                            can10be
                              ? "bg-green-100 text-green-800 hover:bg-green-200"
                              : "bg-gray-100 text-gray-400 cursor-not-allowed"
                          }`}>
                          {tenbeLoadingId === b.__backendId ? "Searching..." : "10BE"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {bookings.length > 200 && <div className="px-4 py-3 text-center text-xs text-theme-muted">Showing 200 of {bookings.length}</div>}
      </div>
    </div>
  );
}
