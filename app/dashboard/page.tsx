"use client";

import { useState, useMemo } from "react";
import { useAllData, byType } from "@/lib/use-all-data";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  Title, Tooltip, Legend, Filler,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler);

interface DonorRecord { __backendId: string; name: string; centerId: string; }
interface BookingRecord {
  __backendId: string; totalAmount: number; paymentStatus: string; bookingDate: string;
  donorId: string; centerId: string;
  items: Array<{ name?: string; amount?: number; quantity?: number }>;
  createdAt?: string;
}
interface SevaRecord { id: string; name: string; amount: number; }
interface CenterRecord { id: string; name: string; }

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl card-shadow p-6">
      <p className="text-theme-muted text-sm font-medium mb-1">{label}</p>
      <p className="font-display text-3xl font-bold text-theme-primary">{value}</p>
      {sub && <p className="text-xs text-theme-muted mt-1">{sub}</p>}
    </div>
  );
}

type DateRange = "all" | "today" | "week" | "month" | "year";

function getDateFilter(range: DateRange, startCustom: string, endCustom: string): (date: string) => boolean {
  if (startCustom || endCustom) {
    return (d) => {
      const ds = d.split("T")[0];
      if (startCustom && ds < startCustom) return false;
      if (endCustom && ds > endCustom) return false;
      return true;
    };
  }
  if (range === "all") return () => true;
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  if (range === "today") return (d) => d.split("T")[0] === todayStr;
  if (range === "week") {
    const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().split("T")[0];
    return (d) => d.split("T")[0] >= weekAgo;
  }
  if (range === "month") {
    const monthStr = todayStr.slice(0, 7);
    return (d) => d.split("T")[0].slice(0, 7) === monthStr;
  }
  // year
  const yearStr = todayStr.slice(0, 4);
  return (d) => d.split("T")[0].slice(0, 4) === yearStr;
}

export default function DashboardPage() {
  const { data, loading, error } = useAllData();
  const { user } = useAuth();

  const [sevaFilter, setSevaFilter] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const donors = byType<DonorRecord>(data, "donor");
  const allBookings = byType<BookingRecord>(data, "booking");
  const sevas = byType<SevaRecord>(data, "seva");
  const centers = byType<CenterRecord>(data, "center");

  const dateFn = useMemo(() => getDateFilter(dateRange, startDate, endDate), [dateRange, startDate, endDate]);

  const filteredBookings = useMemo(() => {
    let list = allBookings.filter((b) => b.paymentStatus === "paid");
    list = list.filter((b) => dateFn(b.bookingDate || ""));
    if (sevaFilter) {
      list = list.filter((b) => b.items?.some((i) => i.name === sevaFilter));
    }
    return list;
  }, [allBookings, dateFn, sevaFilter]);

  const stats = useMemo(() => {
    const totalCollected = filteredBookings.reduce((s, b) => s + (b.totalAmount || 0), 0);
    return {
      bookingCount: filteredBookings.length,
      totalCollected,
      donorCount: donors.length,
      avg: filteredBookings.length > 0 ? Math.round(totalCollected / filteredBookings.length) : 0,
    };
  }, [filteredBookings, donors]);

  // Top sevas
  const topSevas = useMemo(() => {
    const map = new Map<string, { name: string; count: number; total: number }>();
    for (const b of filteredBookings) {
      for (const item of (b.items || [])) {
        const name = item.name || "Other";
        const entry = map.get(name) || { name, count: 0, total: 0 };
        entry.count += item.quantity || 1;
        entry.total += (item.amount || 0) * (item.quantity || 1);
        map.set(name, entry);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [filteredBookings]);

  // Recent transactions
  const recentTxns = useMemo(() => {
    return filteredBookings
      .map((b) => ({
        ...b,
        _donorName: donors.find((d) => d.__backendId === b.donorId)?.name || "—",
      }))
      .sort((a, b) => {
        const cmp = formatDate(b.bookingDate, "").localeCompare(formatDate(a.bookingDate, ""));
        if (cmp !== 0) return cmp;
        return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
      })
      .slice(0, 50);
  }, [filteredBookings, donors]);

  const fmtINR = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  // ---- Chart: Revenue by Seva (horizontal bar) ----
  const sevaChartData = useMemo(() => {
    const top = topSevas.slice(0, 8);
    return {
      labels: top.map((s) => s.name.length > 20 ? s.name.slice(0, 20) + "..." : s.name),
      datasets: [{
        label: "Revenue (₹)",
        data: top.map((s) => s.total),
        backgroundColor: "rgba(255, 102, 196, 0.6)",
        borderColor: "rgba(255, 102, 196, 1)",
        borderWidth: 1,
        borderRadius: 4,
      }],
    };
  }, [topSevas]);

  // ---- Chart: Revenue Trend (daily line) ----
  const trendChartData = useMemo(() => {
    const dayMap = new Map<string, number>();
    for (const b of filteredBookings) {
      const day = String(b.bookingDate || "").split("T")[0];
      if (!day) continue;
      dayMap.set(day, (dayMap.get(day) || 0) + (b.totalAmount || 0));
    }
    const sorted = Array.from(dayMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    // Show last 30 data points max
    const recent = sorted.slice(-30);
    return {
      labels: recent.map(([d]) => d.slice(5)), // MM-DD
      datasets: [{
        label: "Daily Revenue (₹)",
        data: recent.map(([, v]) => v),
        borderColor: "rgba(255, 145, 77, 1)",
        backgroundColor: "rgba(255, 145, 77, 0.15)",
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: "rgba(255, 145, 77, 1)",
      }],
    };
  }, [filteredBookings]);

  // Unique seva names for filter
  const sevaNames = useMemo(() => {
    const names = new Set<string>();
    allBookings.forEach((b) => b.items?.forEach((i) => { if (i.name) names.add(i.name); }));
    return Array.from(names).sort();
  }, [allBookings]);

  if (loading) return <div className="text-center py-12 text-theme-muted">Loading dashboard...</div>;
  if (error) return <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">{error}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-theme-primary">Welcome, {user?.username}</h1>
        <p className="text-sm text-theme-secondary mt-1">{user?.isDonor ? "Your donation history and profile" : "Temple donation management overview"}</p>
      </div>

      {/* Statistics Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Bookings" value={stats.bookingCount} />
        <StatCard label="Total Revenue" value={fmtINR(stats.totalCollected)} />
        <StatCard label="Total Donors" value={stats.donorCount} />
        <StatCard label="Avg. Transaction" value={fmtINR(stats.avg)} />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl card-shadow p-6">
        <h3 className="font-display text-lg font-semibold text-theme-primary mb-4">Filters and Analytics</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-theme-secondary mb-2">Filter by Seva</label>
            <select value={sevaFilter} onChange={(e) => setSevaFilter(e.target.value)} className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm">
              <option value="">All Sevas</option>
              {sevaNames.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-theme-secondary mb-2">Date Range</label>
            <select value={dateRange} onChange={(e) => { setDateRange(e.target.value as DateRange); setStartDate(""); setEndDate(""); }} className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm">
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="year">This Year</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-theme-secondary mb-2">Start Date</label>
            <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setDateRange("all"); }} className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-theme-secondary mb-2">End Date</label>
            <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setDateRange("all"); }} className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" />
          </div>
        </div>
      </div>

      {/* Charts */}
      {filteredBookings.length > 0 && (
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Revenue by Seva — horizontal bar */}
          <div className="bg-white rounded-xl card-shadow p-6">
            <h3 className="font-display text-lg font-semibold text-theme-primary mb-4">Revenue by Seva</h3>
            <div style={{ maxHeight: 300 }}>
              <Bar data={sevaChartData} options={{
                indexAxis: "y" as const,
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  x: { ticks: { callback: (v) => `₹${Number(v).toLocaleString("en-IN")}` }, grid: { color: "rgba(255,194,232,0.3)" } },
                  y: { grid: { display: false } },
                },
              }} height={300} />
            </div>
          </div>

          {/* Revenue Trend — daily line */}
          <div className="bg-white rounded-xl card-shadow p-6">
            <h3 className="font-display text-lg font-semibold text-theme-primary mb-4">Revenue Trend</h3>
            <div style={{ maxHeight: 300 }}>
              <Line data={trendChartData} options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  y: { ticks: { callback: (v) => `₹${Number(v).toLocaleString("en-IN")}` }, grid: { color: "rgba(255,194,232,0.2)" } },
                  x: { grid: { display: false } },
                },
              }} height={300} />
            </div>
          </div>
        </div>
      )}

      {/* Top Performing Sevas */}
      {topSevas.length > 0 && (
        <div className="bg-white rounded-xl card-shadow overflow-hidden">
          <div className="px-5 py-3 border-b border-theme">
            <h3 className="font-display text-lg font-semibold text-theme-primary">Top Performing Sevas</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-theme-muted text-theme-secondary">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Seva Name</th>
                  <th className="px-4 py-3 text-right font-medium">Bookings</th>
                  <th className="px-4 py-3 text-right font-medium">Total Revenue</th>
                  <th className="px-4 py-3 text-right font-medium">Avg Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-muted">
                {topSevas.map((s) => (
                  <tr key={s.name} className="hover:bg-theme-page transition">
                    <td className="px-4 py-2.5 font-medium text-theme-primary">{s.name}</td>
                    <td className="px-4 py-2.5 text-right text-theme-secondary">{s.count}</td>
                    <td className="px-4 py-2.5 text-right text-theme-primary font-medium">{fmtINR(s.total)}</td>
                    <td className="px-4 py-2.5 text-right text-theme-secondary">{fmtINR(s.count > 0 ? Math.round(s.total / s.count) : 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Transactions */}
      <div className="bg-white rounded-xl card-shadow overflow-hidden">
        <div className="px-5 py-3 border-b border-theme">
          <h2 className="font-display text-lg font-semibold text-theme-primary">Filtered Transactions ({recentTxns.length})</h2>
        </div>
        {recentTxns.length === 0 ? (
          <div className="px-5 py-8 text-center text-theme-muted text-sm">No transactions match your filters</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-theme-muted text-theme-secondary">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-left font-medium">Donor</th>
                  <th className="px-4 py-3 text-left font-medium">Sevas</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                  <th className="px-4 py-3 text-center font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-muted">
                {recentTxns.map((b, i) => (
                  <tr key={i} className="hover:bg-theme-page transition">
                    <td className="px-4 py-2.5 text-theme-secondary">{formatDate(b.bookingDate)}</td>
                    <td className="px-4 py-2.5 text-theme-primary font-medium">{b._donorName}</td>
                    <td className="px-4 py-2.5 text-theme-secondary">{b.items?.map((i) => i.name || "—").join(", ") || "—"}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-theme-primary">{fmtINR(b.totalAmount || 0)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">{b.paymentStatus}</span>
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
