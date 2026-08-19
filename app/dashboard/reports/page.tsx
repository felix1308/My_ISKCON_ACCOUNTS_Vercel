"use client";

import { useState, useMemo } from "react";
import { useAllData, byType } from "@/lib/use-all-data";

interface BookingRecord { totalAmount: number; paymentStatus: string; bookingDate: string; centerId: string; paymentMode: string; }

export default function ReportsPage() {
  const { data, loading } = useAllData();
  const [groupBy, setGroupBy] = useState<"center" | "month" | "mode">("center");

  const bookings = byType<BookingRecord>(data, "booking").filter((b) => b.paymentStatus === "paid");
  const centers = byType<{ id: string; name: string }>(data, "center");

  const report = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of bookings) {
      let key = "";
      if (groupBy === "center") key = centers.find((c) => c.id === b.centerId)?.name || b.centerId || "Unknown";
      else if (groupBy === "month") key = String(b.bookingDate || "").slice(0, 7) || "Unknown";
      else if (groupBy === "mode") key = b.paymentMode || "unknown";
      map.set(key, (map.get(key) || 0) + (b.totalAmount || 0));
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [bookings, groupBy, centers]);

  const total = report.reduce((s, [, v]) => s + v, 0);
  const fmtINR = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  if (loading) return <div className="text-center py-12 text-gray-400">Loading reports...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-800">Reports</h1>
        <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)} className="px-3 py-2 border rounded-lg text-sm">
          <option value="center">By Center</option>
          <option value="month">By Month</option>
          <option value="mode">By Payment Mode</option>
        </select>
      </div>

      <div className="bg-green-50 border border-green-200 rounded-xl p-5">
        <div className="text-sm text-green-700 font-medium">Total Collected (Paid Bookings)</div>
        <div className="text-3xl font-bold text-green-800 mt-1">{fmtINR(total)}</div>
        <div className="text-xs text-green-600 mt-1">{bookings.length} paid bookings</div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium capitalize">{groupBy}</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
              <th className="px-4 py-2 text-right font-medium">% of Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {report.map(([key, val]) => (
              <tr key={key} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 font-medium">{key}</td>
                <td className="px-4 py-2.5 text-right">{fmtINR(val)}</td>
                <td className="px-4 py-2.5 text-right text-gray-500">{total > 0 ? ((val / total) * 100).toFixed(1) : 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
