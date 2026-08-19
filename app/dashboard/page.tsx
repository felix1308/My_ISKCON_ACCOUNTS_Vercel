"use client";

import { useMemo } from "react";
import { useAllData, byType } from "@/lib/use-all-data";
import { useAuth } from "@/lib/auth-context";

interface DonorRecord { name: string; centerId: string; }
interface BookingRecord {
  totalAmount: number; paymentStatus: string; bookingDate: string;
  donorId: string; items: Array<{ name?: string; amount?: number; quantity?: number }>;
}
interface SevaRecord { name: string; amount: number; }

function StatCard({ label, value, sub, color = "orange" }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  const colors: Record<string, string> = {
    orange: "bg-orange-50 text-orange-700 border-orange-200",
    green: "bg-green-50 text-green-700 border-green-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    purple: "bg-purple-50 text-purple-700 border-purple-200",
  };
  return (
    <div className={`rounded-xl border p-5 ${colors[color] || colors.orange}`}>
      <div className="text-sm font-medium opacity-80">{label}</div>
      <div className="text-3xl font-bold mt-1">{value}</div>
      {sub && <div className="text-xs opacity-60 mt-1">{sub}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const { data, loading, error } = useAllData();
  const { user } = useAuth();

  const stats = useMemo(() => {
    const donors = byType<DonorRecord>(data, "donor");
    const bookings = byType<BookingRecord>(data, "booking");
    const sevas = byType<SevaRecord>(data, "seva");
    const paidBookings = bookings.filter((b) => b.paymentStatus === "paid");
    const totalCollected = paidBookings.reduce((s, b) => s + (b.totalAmount || 0), 0);
    const pendingBookings = bookings.filter((b) => b.paymentStatus === "pending").length;
    return {
      donorCount: donors.length,
      bookingCount: bookings.length,
      paidCount: paidBookings.length,
      pendingCount: pendingBookings,
      totalCollected,
      sevaCount: sevas.length,
    };
  }, [data]);

  const recentBookings = useMemo(() => {
    const bookings = byType<BookingRecord>(data, "booking");
    return bookings
      .map((b, i) => ({ ...b, _idx: i, _donorName: byType<DonorRecord>(data, "donor").find((d) => (d as { __backendId?: string }).__backendId === b.donorId)?.name || "—" }))
      .sort((a, b) => String(b.bookingDate || "").localeCompare(String(a.bookingDate || "")))
      .slice(0, 10);
  }, [data]);

  if (loading) {
    return <div className="text-center py-12 text-gray-400">Loading dashboard...</div>;
  }
  if (error) {
    return <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">{error}</div>;
  }

  const fmtINR = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">
          Welcome, {user?.username}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {user?.isDonor ? "Your donation history and profile" : "Temple donation management overview"}
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Donors" value={stats.donorCount} color="orange" />
        <StatCard label="Total Collected" value={fmtINR(stats.totalCollected)} sub={`${stats.paidCount} paid bookings`} color="green" />
        <StatCard label="Pending Bookings" value={stats.pendingCount} color="blue" />
        <StatCard label="Active Sevas" value={stats.sevaCount} color="purple" />
      </div>

      {/* Recent bookings */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">Recent Bookings</h2>
        </div>
        {recentBookings.length === 0 ? (
          <div className="px-5 py-8 text-center text-gray-400 text-sm">No bookings yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-5 py-2 text-left font-medium">Donor</th>
                  <th className="px-5 py-2 text-left font-medium">Date</th>
                  <th className="px-5 py-2 text-right font-medium">Amount</th>
                  <th className="px-5 py-2 text-center font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recentBookings.map((b, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-5 py-2.5">{b._donorName}</td>
                    <td className="px-5 py-2.5 text-gray-500">{String(b.bookingDate || "—").split("T")[0]}</td>
                    <td className="px-5 py-2.5 text-right font-medium">{fmtINR(b.totalAmount || 0)}</td>
                    <td className="px-5 py-2.5 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        b.paymentStatus === "paid"
                          ? "bg-green-100 text-green-700"
                          : "bg-yellow-100 text-yellow-700"
                      }`}>
                        {b.paymentStatus}
                      </span>
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
