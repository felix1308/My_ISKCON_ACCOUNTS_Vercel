"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { callApi } from "@/lib/client";
import { SADHANA_BOOKS } from "@/lib/sadhana-books";
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  Title, Tooltip, Legend,
  type ChartData,
} from "chart.js";
import { Chart, Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend);

interface SadhanaEntry {
  entryDate: string;
  wakeUpAt: string;
  sleepAt: string;
  chantingRounds: number;
  hearingMinutes: number;
  readingMinutes: number;
  readingBook: string;
  serviceMinutes: number;
  serviceNote: string;
  notes: string;
}

// Local-calendar date (not UTC) — devotees log early-morning IST.
function localDate(d = new Date()): string {
  return d.toLocaleDateString("en-CA"); // YYYY-MM-DD
}
function toMin(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function fmtMin(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}
// Sleep duration from previous-night bedtime + wake time.
function sleepDuration(sleepAt: string, wakeUpAt: string): number | null {
  const s = toMin(sleepAt), w = toMin(wakeUpAt);
  if (s === null || w === null) return null;
  return s > w ? 1440 - s + w : w - s;
}

const TARGET_ROUNDS = 16;
const TARGET_WAKE = "04:00";

const EMPTY: Omit<SadhanaEntry, "entryDate"> = {
  wakeUpAt: "", sleepAt: "", chantingRounds: 0, hearingMinutes: 0,
  readingMinutes: 0, readingBook: "", serviceMinutes: 0, serviceNote: "", notes: "",
};

export default function SadhanaPage() {
  const [entries, setEntries] = useState<SadhanaEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(localDate());
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await callApi("getSadhanaEntries", {});
    if (res.isOk) setEntries((res as { entries?: SadhanaEntry[] }).entries ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Load the selected date's entry into the form whenever date/data changes.
  useEffect(() => {
    const existing = entries.find((e) => e.entryDate === date);
    setForm(existing ? { ...EMPTY, ...existing } : { ...EMPTY });
    setMessage("");
  }, [date, entries]);

  async function handleSave() {
    setSaving(true); setMessage("");
    const res = await callApi("saveSadhanaEntry", { entry: { entryDate: date, ...form } });
    setSaving(false);
    if (res.isOk) { setMessage("Saved ✓"); await load(); }
    else setMessage((res as { error?: string }).error || "Save failed");
  }

  // ---- Metrics ----
  const byDate = useMemo(() => new Map(entries.map((e) => [e.entryDate, e])), [entries]);

  const streak = useMemo(() => {
    let n = 0;
    const d = new Date();
    // Allow streak to count from today or yesterday (today may be unfilled).
    if (!byDate.has(localDate(d))) d.setDate(d.getDate() - 1);
    while (byDate.has(localDate(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }, [byDate]);

  const recent30 = useMemo(() => {
    const out: SadhanaEntry[] = [];
    const d = new Date();
    for (let i = 29; i >= 0; i--) {
      const dd = new Date(d); dd.setDate(d.getDate() - i);
      const key = localDate(dd);
      const e = byDate.get(key);
      out.push(e ?? { entryDate: key, ...EMPTY });
    }
    return out;
  }, [byDate]);

  const filled = entries;
  const avgOf = (fn: (e: SadhanaEntry) => number | null): number | null => {
    const vals = filled.map(fn).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const avgRounds = avgOf((e) => e.chantingRounds || null);
  const avgHearing = avgOf((e) => e.hearingMinutes || null);
  const avgReading = avgOf((e) => e.readingMinutes || null);
  const avgService = avgOf((e) => e.serviceMinutes || null);
  const avgWakeMin = avgOf((e) => toMin(e.wakeUpAt));
  const avgSleepDur = avgOf((e) => sleepDuration(e.sleepAt, e.wakeUpAt));
  const targetWakeMin = toMin(TARGET_WAKE)!;

  const roundsChart: ChartData<"bar" | "line", (number | null)[], string> = {
    labels: recent30.map((e) => e.entryDate.slice(5)),
    datasets: [
      {
        label: "Rounds",
        data: recent30.map((e) => e.chantingRounds),
        backgroundColor: "rgba(128, 0, 0, 0.65)",
        borderRadius: 3,
      },
      {
        label: `Target (${TARGET_ROUNDS})`,
        data: recent30.map(() => TARGET_ROUNDS),
        type: "line" as const,
        borderColor: "#c9a24d",
        borderDash: [6, 4],
        pointRadius: 0,
        fill: false,
      },
    ],
  };

  const wakeChart: ChartData<"line", (number | null)[], string> = {
    labels: recent30.map((e) => e.entryDate.slice(5)),
    datasets: [
      {
        label: "Wake-up (hh:mm)",
        data: recent30.map((e) => { const m = toMin(e.wakeUpAt); return m === null ? null : m / 60; }),
        borderColor: "rgba(128, 0, 0, 1)",
        backgroundColor: "rgba(128, 0, 0, 0.08)",
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        spanGaps: true,
      },
      {
        label: `Target (${TARGET_WAKE})`,
        data: recent30.map(() => targetWakeMin / 60),
        borderColor: "#c9a24d",
        borderDash: [6, 4],
        pointRadius: 0,
        fill: false,
      },
    ],
  };
  const wakeTick = (v: number | string) => {
    const n = Number(v);
    return `${String(Math.floor(n)).padStart(2, "0")}:${Math.round((n % 1) * 60).toString().padStart(2, "0")}`;
  };

  const dur = sleepDuration(form.sleepAt, form.wakeUpAt);

  if (loading) return <div className="text-center py-12 text-theme-muted">Loading your sadhana...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-theme-primary">My Sadhana</h1>
          <p className="text-sm text-theme-secondary mt-1">Chanting, hearing, reading, service, and rest — private to you.</p>
        </div>
        <div className="bg-white rounded-xl card-shadow border border-theme px-4 py-2 text-center">
          <div className="text-[11px] text-theme-muted font-medium">Current streak</div>
          <div className="font-display text-2xl font-bold text-theme-primary">{streak} day{streak === 1 ? "" : "s"}</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* ================= Daily entry form ================= */}
        <div className="bg-white rounded-xl card-shadow p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold text-theme-primary">Daily Entry</h3>
            <input type="date" value={date} max={localDate()} onChange={(e) => setDate(e.target.value)}
              className="px-3 py-1.5 border border-theme rounded-lg theme-focus text-sm" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-theme-secondary mb-1">Wake-up time</label>
              <input type="time" value={form.wakeUpAt} onChange={(e) => setForm({ ...form, wakeUpAt: e.target.value })}
                className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" />
              <p className="text-[10px] text-theme-muted mt-0.5">Ideal: {TARGET_WAKE} for mangalarti</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-theme-secondary mb-1">Sleep time (last night)</label>
              <input type="time" value={form.sleepAt} onChange={(e) => setForm({ ...form, sleepAt: e.target.value })}
                className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" />
              {dur !== null && <p className="text-[10px] text-theme-muted mt-0.5">Slept {fmtMin(dur)}</p>}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-theme-secondary mb-1">Chanting rounds (japa)</label>
            <div className="flex items-center gap-3">
              <input type="number" min={0} max={500} value={form.chantingRounds || ""} placeholder="0"
                onChange={(e) => setForm({ ...form, chantingRounds: Number(e.target.value) || 0 })}
                className="w-28 px-3 py-2 border border-theme rounded-lg theme-focus text-sm" />
              <div className="flex-1 h-2 rounded-full bg-theme-muted overflow-hidden">
                <div className="h-full bg-theme-accent transition-all" style={{ width: `${Math.min(100, (form.chantingRounds / TARGET_ROUNDS) * 100)}%` }} />
              </div>
              <span className="text-xs text-theme-muted whitespace-nowrap">/ {TARGET_ROUNDS}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-theme-secondary mb-1">Hearing (minutes)</label>
              <input type="number" min={0} value={form.hearingMinutes || ""} placeholder="0"
                onChange={(e) => setForm({ ...form, hearingMinutes: Number(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" />
              <p className="text-[10px] text-theme-muted mt-0.5">Bhagavatam class, satsang, katha</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-theme-secondary mb-1">Reading (minutes)</label>
              <input type="number" min={0} value={form.readingMinutes || ""} placeholder="0"
                onChange={(e) => setForm({ ...form, readingMinutes: Number(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-theme-secondary mb-1">Reading from</label>
            <select value={form.readingBook} onChange={(e) => setForm({ ...form, readingBook: e.target.value })}
              className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm">
              <option value="">Select a book...</option>
              {SADHANA_BOOKS.map((b) => <option key={b} value={b}>{b}</option>)}
              <option value="Other">Other / free text (use notes)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-theme-secondary mb-1">Service (minutes)</label>
              <input type="number" min={0} value={form.serviceMinutes || ""} placeholder="0"
                onChange={(e) => setForm({ ...form, serviceMinutes: Number(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-theme-secondary mb-1">Service detail</label>
              <input type="text" value={form.serviceNote} placeholder="e.g. book distribution, kitchen seva"
                onChange={(e) => setForm({ ...form, serviceNote: e.target.value })}
                className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-theme-secondary mb-1">Notes (optional)</label>
            <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm resize-y"
              placeholder="Reflections, realizations, obstacles..." />
          </div>

          <div className="flex items-center gap-3">
            <button onClick={handleSave} disabled={saving}
              className="btn-primary text-sm px-5 py-2 rounded-lg disabled:opacity-50">
              {saving ? "Saving..." : byDate.has(date) ? "Update Entry" : "Save Entry"}
            </button>
            {message && <span className="text-sm text-theme-secondary">{message}</span>}
          </div>
        </div>

        {/* ================= Averages ================= */}
        <div className="bg-white rounded-xl card-shadow p-6">
          <h3 className="font-display text-lg font-semibold text-theme-primary mb-4">Averages (all logged days)</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Metric label="Chanting" value={avgRounds !== null ? `${avgRounds.toFixed(1)} rounds` : "—"} target={`target ${TARGET_ROUNDS}`} met={(avgRounds ?? 0) >= TARGET_ROUNDS} />
            <Metric label="Wake-up" value={avgWakeMin !== null ? fmtMin(avgWakeMin).replace("h ", ":").replace("m", "") : "—"} target={`target ${TARGET_WAKE}`} met={avgWakeMin !== null && avgWakeMin <= targetWakeMin} />
            <Metric label="Hearing" value={avgHearing !== null ? fmtMin(Math.round(avgHearing)) : "—"} target="daily class" met={null} />
            <Metric label="Reading" value={avgReading !== null ? fmtMin(Math.round(avgReading)) : "—"} target="daily reading" met={null} />
            <Metric label="Service" value={avgService !== null ? fmtMin(Math.round(avgService)) : "—"} target="daily seva" met={null} />
            <Metric label="Sleep" value={avgSleepDur !== null ? fmtMin(Math.round(avgSleepDur)) : "—"} target="rest for early rise" met={null} />
          </div>
          <div className="mt-4 text-xs text-theme-muted border-t border-theme pt-3">
            The ideal devotee's day: rise {TARGET_WAKE} · 16 rounds before 7am · guru puja & class · service through the day · evening reading & satsang · early rest.
          </div>
        </div>
      </div>

      {/* ================= Charts ================= */}
      {entries.length > 0 && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl card-shadow p-6">
            <h3 className="font-display text-lg font-semibold text-theme-primary mb-4">Chanting — last 30 days</h3>
            <Chart type="bar" data={roundsChart} options={{ responsive: true, plugins: { legend: { display: true, labels: { boxWidth: 12, font: { size: 10 } } } }, scales: { y: { beginAtZero: true }, x: { grid: { display: false } } } }} />
          </div>
          <div className="bg-white rounded-xl card-shadow p-6">
            <h3 className="font-display text-lg font-semibold text-theme-primary mb-4">Wake-up time — last 30 days</h3>
            <Line data={wakeChart} options={{ responsive: true, plugins: { legend: { display: true, labels: { boxWidth: 12, font: { size: 10 } } } }, scales: { y: { reverse: false, min: 0, max: 12, ticks: { callback: wakeTick } }, x: { grid: { display: false } } } }} />
          </div>
        </div>
      )}

      {/* ================= History ================= */}
      {entries.length > 0 && (
        <div className="bg-white rounded-xl card-shadow overflow-hidden">
          <div className="px-5 py-3 border-b border-theme">
            <h3 className="font-display text-lg font-semibold text-theme-primary">Recent entries</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-theme-muted text-theme-secondary">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">Date</th>
                  <th className="px-3 py-2.5 text-left font-medium">Wake</th>
                  <th className="px-3 py-2.5 text-left font-medium">Sleep</th>
                  <th className="px-3 py-2.5 text-right font-medium">Rounds</th>
                  <th className="px-3 py-2.5 text-right font-medium">Hearing</th>
                  <th className="px-3 py-2.5 text-left font-medium">Reading</th>
                  <th className="px-3 py-2.5 text-left font-medium">Service</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-muted">
                {entries.slice(0, 14).map((e) => (
                  <tr key={e.entryDate} onClick={() => setDate(e.entryDate)}
                    className="hover:bg-theme-page transition cursor-pointer">
                    <td className="px-3 py-2.5 font-medium text-theme-primary">{e.entryDate}</td>
                    <td className="px-3 py-2.5 text-theme-secondary">{e.wakeUpAt || "—"}</td>
                    <td className="px-3 py-2.5 text-theme-secondary">{e.sleepAt || "—"}</td>
                    <td className="px-3 py-2.5 text-right text-theme-primary font-medium">{e.chantingRounds || "—"}</td>
                    <td className="px-3 py-2.5 text-right text-theme-secondary">{e.hearingMinutes ? `${e.hearingMinutes}m` : "—"}</td>
                    <td className="px-3 py-2.5 text-theme-secondary">{e.readingBook ? `${e.readingBook} (${e.readingMinutes}m)` : e.readingMinutes ? `${e.readingMinutes}m` : "—"}</td>
                    <td className="px-3 py-2.5 text-theme-secondary">{e.serviceNote ? `${e.serviceNote} (${e.serviceMinutes}m)` : e.serviceMinutes ? `${e.serviceMinutes}m` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {entries.length === 0 && (
        <div className="bg-white rounded-xl card-shadow p-8 text-center text-sm text-theme-muted">
          No entries yet — fill in today's sadhana above and press Save Entry.
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, target, met }: { label: string; value: string; target: string; met: boolean | null }) {
  return (
    <div className="border border-theme rounded-lg p-3">
      <div className="text-[11px] text-theme-muted font-medium">{label}</div>
      <div className="font-display text-lg font-bold text-theme-primary">{value}</div>
      <div className={`text-[10px] mt-0.5 ${met === true ? "text-green-600" : met === false ? "text-amber-600" : "text-theme-muted"}`}>{target}</div>
    </div>
  );
}
