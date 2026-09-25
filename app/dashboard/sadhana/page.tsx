"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { callApi } from "@/lib/client";
import { SADHANA_BOOKS } from "@/lib/sadhana-books";
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  Title, Tooltip, Legend,
  type ChartData,
} from "chart.js";
import { Bar } from "react-chartjs-2";

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

function localDate(d = new Date()): string {
  return d.toLocaleDateString("en-CA"); // YYYY-MM-DD, local calendar (devotees log early IST)
}
function toMin(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function fmtDur(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m}m`;
}
function sleepDuration(sleepAt: string, wakeUpAt: string): number | null {
  const s = toMin(sleepAt), w = toMin(wakeUpAt);
  if (s === null || w === null) return null;
  return s > w ? 1440 - s + w : w - s;
}

const TARGET_ROUNDS = 16;
const TARGET_WAKE = "04:00";
const LOTUS = "/iskcon-logo.png";

const QUOTES = [
  "Chant Hare Krishna and be happy.",
  "The holy name is the sound incarnation of the Lord.",
  "Books are the basis; purity is the force; preaching is the essence.",
  "Utility is the principle.",
  "Chanting is not of this world — it is the vibration of the spiritual sky.",
];

const EMPTY: Omit<SadhanaEntry, "entryDate"> = {
  wakeUpAt: "", sleepAt: "", chantingRounds: 0, hearingMinutes: 0,
  readingMinutes: 0, readingBook: "", serviceMinutes: 0, serviceNote: "", notes: "",
};

export default function SadhanaPortal() {
  const router = useRouter();
  const [exiting, setExiting] = useState(false);
  const [entries, setEntries] = useState<SadhanaEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(localDate());
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState("");
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)]);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const exitPortal = useCallback(() => {
    if (exiting) return;
    setExiting(true);
    exitTimer.current = setTimeout(() => router.push("/dashboard"), 300);
  }, [exiting, router]);

  // ESC exits the portal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") exitPortal(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); if (exitTimer.current) clearTimeout(exitTimer.current); };
  }, [exitPortal]);

  const load = useCallback(async () => {
    const res = await callApi("getSadhanaEntries", {});
    if (res.isOk) setEntries((res as { entries?: SadhanaEntry[] }).entries ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const existing = entries.find((e) => e.entryDate === date);
    setForm(existing ? { ...EMPTY, ...existing } : { ...EMPTY });
    setError("");
  }, [date, entries]);

  async function handleSave() {
    setSaving(true); setError(""); setSavedFlash(false);
    const res = await callApi("saveSadhanaEntry", { entry: { entryDate: date, ...form } });
    setSaving(false);
    if (res.isOk) { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1200); await load(); }
    else setError((res as { error?: string }).error || "Save failed");
  }

  // ---- Metrics ----
  const byDate = useMemo(() => new Map(entries.map((e) => [e.entryDate, e])), [entries]);
  const streak = useMemo(() => {
    let n = 0;
    const d = new Date();
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
      out.push(byDate.get(key) ?? { entryDate: key, ...EMPTY });
    }
    return out;
  }, [byDate]);

  const avgOf = (fn: (e: SadhanaEntry) => number | null): number | null => {
    const vals = entries.map(fn).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const avgRounds = avgOf((e) => e.chantingRounds || null);
  const avgWakeMin = avgOf((e) => toMin(e.wakeUpAt));
  const avgHearing = avgOf((e) => e.hearingMinutes || null);
  const avgReading = avgOf((e) => e.readingMinutes || null);
  const avgService = avgOf((e) => e.serviceMinutes || null);
  const avgSleep = avgOf((e) => sleepDuration(e.sleepAt, e.wakeUpAt));

  const roundsChart: ChartData<"bar", (number | null)[], string> = {
    labels: recent30.map((e) => e.entryDate.slice(5)),
    datasets: [{
      label: "Rounds",
      data: recent30.map((e) => e.chantingRounds),
      backgroundColor: "rgba(201, 162, 77, 0.75)",
      hoverBackgroundColor: "rgba(232, 200, 119, 0.95)",
      borderRadius: 4,
    }, {
      label: `Target (${TARGET_ROUNDS})`,
      data: recent30.map(() => TARGET_ROUNDS),
      backgroundColor: "rgba(245, 233, 218, 0.18)",
      borderRadius: 4,
    }],
  };

  const dur = sleepDuration(form.sleepAt, form.wakeUpAt);
  const roundPct = Math.min(1, form.chantingRounds / TARGET_ROUNDS);
  const RING_R = 56;
  const RING_C = 2 * Math.PI * RING_R;

  const step = (field: "chantingRounds" | "hearingMinutes" | "readingMinutes" | "serviceMinutes", delta: number, max: number) => {
    setForm((f) => ({ ...f, [field]: Math.max(0, Math.min(max, (f[field] || 0) + delta)) }));
  };

  return (
    <div className={`sadhana-portal ${exiting ? "portal-exiting" : ""}`}>
      {/* floating diya sparks */}
      <div className="portal-particles" aria-hidden>
        {Array.from({ length: 14 }).map((_, i) => (
          <span key={i} style={{
            left: `${(i * 73) % 100}%`,
            animationDuration: `${9 + (i * 37) % 8}s`,
            animationDelay: `${(i * 61) % 10}s`,
          }} />
        ))}
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 relative">
        {/* ===== Header ===== */}
        <div className="flex items-center justify-between mb-6 portal-rise" style={{ ["--i" as string]: 0 }}>
          <button onClick={exitPortal} className="portal-btn-ghost flex items-center gap-2" title="Back to Accounts (Esc)">
            <span className="text-lg leading-none">←</span> Exit to Accounts
          </button>
          <div className="text-center">
            <span className="text-xs tracking-[0.35em] uppercase" style={{ color: "#c9a24d" }}>Daily Practice</span>
          </div>
          <div className="flex items-center gap-2 text-sm" style={{ color: "#e8c877" }}>
            <span className="portal-flame text-xl">🪔</span>
            <span className="font-bold">{streak}</span>
            <span className="opacity-70 text-xs">day streak</span>
          </div>
        </div>

        {/* ===== Title ===== */}
        <div className="text-center mb-8 portal-rise" style={{ ["--i" as string]: 1 }}>
          <img src={LOTUS} alt="ISKCON lotus" className="portal-lotus mx-auto mb-3" style={{ width: 84, height: "auto" }} />
          <h1 className="font-display text-4xl font-bold" style={{ color: "#f5e9da" }}>Sadhana</h1>
          <p className="font-display italic mt-2 text-sm" style={{ color: "rgba(232,200,119,0.85)" }}>&ldquo;{quote}&rdquo;</p>
        </div>

        {loading ? (
          <div className="text-center py-16 opacity-70 text-sm">Entering your sacred space…</div>
        ) : (
          <>
            {/* ===== Date selector ===== */}
            <div className="flex justify-center mb-6 portal-rise" style={{ ["--i" as string]: 2 }}>
              <input type="date" value={date} max={localDate()} onChange={(e) => setDate(e.target.value)}
                className="portal-input text-center" style={{ width: 180 }} />
            </div>

            {/* ===== The 5 avenues ===== */}
            <div className="grid md:grid-cols-2 gap-4 mb-4">

              {/* Chanting — progress ring */}
              <div className="portal-card p-6 portal-rise" style={{ ["--i" as string]: 3 }}>
                <div className="flex items-center gap-6">
                  <div className="relative" style={{ width: 128, height: 128 }}>
                    <svg width="128" height="128" className={roundPct >= 1 ? "ring-complete" : ""}>
                      <circle cx="64" cy="64" r={RING_R} fill="none" stroke="rgba(201,162,77,0.18)" strokeWidth="9" />
                      <circle cx="64" cy="64" r={RING_R} fill="none" stroke="#c9a24d" strokeWidth="9"
                        strokeLinecap="round"
                        strokeDasharray={RING_C}
                        strokeDashoffset={RING_C * (1 - roundPct)}
                        transform="rotate(-90 64 64)"
                        style={{ transition: "stroke-dashoffset 0.5s cubic-bezier(0.22,1,0.36,1)" }} />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="font-display text-3xl font-bold" style={{ color: "#e8c877" }}>{form.chantingRounds}</span>
                      <span className="text-[10px] opacity-70">of {TARGET_ROUNDS}</span>
                    </div>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-display text-xl font-bold" style={{ color: "#f5e9da" }}>Chanting</h3>
                    <p className="text-xs opacity-60 mb-3">Rounds of the Hare Krishna maha-mantra</p>
                    <div className="flex items-center gap-2">
                      <button className="portal-stepper" onClick={() => step("chantingRounds", -1, 500)} aria-label="fewer rounds">−</button>
                      <input type="number" min={0} className="portal-input text-center" style={{ width: 64 }}
                        value={form.chantingRounds || ""} placeholder="0"
                        onChange={(e) => setForm({ ...form, chantingRounds: Math.max(0, Number(e.target.value) || 0) })} />
                      <button className="portal-stepper" onClick={() => step("chantingRounds", 1, 500)} aria-label="more rounds">+</button>
                    </div>
                    {roundPct >= 1 && <p className="text-xs mt-2 font-medium" style={{ color: "#e8c877" }}>All 16 rounds complete — Haribol!</p>}
                  </div>
                </div>
              </div>

              {/* Rest — wake & sleep */}
              <div className="portal-card p-6 portal-rise" style={{ ["--i" as string]: 4 }}>
                <h3 className="font-display text-xl font-bold mb-1" style={{ color: "#f5e9da" }}>Rest</h3>
                <p className="text-xs opacity-60 mb-4">Rise in brahma-muhurta · sleep early</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] mb-1 opacity-70">Wake-up</label>
                    <input type="time" value={form.wakeUpAt} onChange={(e) => setForm({ ...form, wakeUpAt: e.target.value })} className="portal-input" />
                    <p className="text-[10px] mt-1 opacity-50">ideal {TARGET_WAKE}</p>
                  </div>
                  <div>
                    <label className="block text-[11px] mb-1 opacity-70">Sleep (last night)</label>
                    <input type="time" value={form.sleepAt} onChange={(e) => setForm({ ...form, sleepAt: e.target.value })} className="portal-input" />
                    {dur !== null && <p className="text-[10px] mt-1" style={{ color: "#e8c877" }}>slept {fmtDur(dur)}</p>}
                  </div>
                </div>
              </div>

              {/* Hearing */}
              <div className="portal-card p-6 portal-rise" style={{ ["--i" as string]: 5 }}>
                <h3 className="font-display text-xl font-bold mb-1" style={{ color: "#f5e9da" }}>Hearing</h3>
                <p className="text-xs opacity-60 mb-4">Bhagavatam class, satsang, katha</p>
                <div className="flex items-center gap-2">
                  <button className="portal-stepper" onClick={() => step("hearingMinutes", -15, 1440)} aria-label="less hearing">−</button>
                  <input type="number" min={0} className="portal-input text-center" style={{ width: 76 }}
                    value={form.hearingMinutes || ""} placeholder="0"
                    onChange={(e) => setForm({ ...form, hearingMinutes: Math.max(0, Number(e.target.value) || 0) })} />
                  <button className="portal-stepper" onClick={() => step("hearingMinutes", 15, 1440)} aria-label="more hearing">+</button>
                  <span className="text-xs opacity-60">minutes</span>
                </div>
              </div>

              {/* Reading */}
              <div className="portal-card p-6 portal-rise" style={{ ["--i" as string]: 6 }}>
                <h3 className="font-display text-xl font-bold mb-1" style={{ color: "#f5e9da" }}>Reading</h3>
                <p className="text-xs opacity-60 mb-3">Srila Prabhupada's books</p>
                <select value={form.readingBook} onChange={(e) => setForm({ ...form, readingBook: e.target.value })} className="portal-input mb-2">
                  <option value="">Which book today?</option>
                  {SADHANA_BOOKS.map((b) => <option key={b} value={b}>{b}</option>)}
                  <option value="Other">Other (note below)</option>
                </select>
                <div className="flex items-center gap-2">
                  <button className="portal-stepper" onClick={() => step("readingMinutes", -10, 1440)} aria-label="less reading">−</button>
                  <input type="number" min={0} className="portal-input text-center" style={{ width: 76 }}
                    value={form.readingMinutes || ""} placeholder="0"
                    onChange={(e) => setForm({ ...form, readingMinutes: Math.max(0, Number(e.target.value) || 0) })} />
                  <button className="portal-stepper" onClick={() => step("readingMinutes", 10, 1440)} aria-label="more reading">+</button>
                  <span className="text-xs opacity-60">minutes</span>
                </div>
              </div>

              {/* Service — full width */}
              <div className="portal-card p-6 md:col-span-2 portal-rise" style={{ ["--i" as string]: 7 }}>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex-1 min-w-48">
                    <h3 className="font-display text-xl font-bold mb-1" style={{ color: "#f5e9da" }}>Service</h3>
                    <p className="text-xs opacity-60 mb-3">Book distribution, deity service, temple seva, day job offered to Krishna</p>
                    <input type="text" value={form.serviceNote} placeholder="What was your service today?"
                      onChange={(e) => setForm({ ...form, serviceNote: e.target.value })} className="portal-input" />
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="portal-stepper" onClick={() => step("serviceMinutes", -30, 1440)} aria-label="less service">−</button>
                    <input type="number" min={0} className="portal-input text-center" style={{ width: 84 }}
                      value={form.serviceMinutes || ""} placeholder="0"
                      onChange={(e) => setForm({ ...form, serviceMinutes: Math.max(0, Number(e.target.value) || 0) })} />
                    <button className="portal-stepper" onClick={() => step("serviceMinutes", 30, 1440)} aria-label="more service">+</button>
                    <span className="text-xs opacity-60">minutes</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ===== Notes + save ===== */}
            <div className="portal-card p-6 mb-6 portal-rise" style={{ ["--i" as string]: 8 }}>
              <label className="block text-[11px] mb-1 opacity-70">Reflections (optional)</label>
              <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="portal-input resize-y mb-4" placeholder="A realization, a struggle, a gratitude..." />
              <div className="flex items-center gap-4">
                <button onClick={handleSave} disabled={saving} className={`portal-btn-gold ${savedFlash ? "portal-saved" : ""}`}>
                  {saving ? "Offering…" : byDate.has(date) ? "Update this day" : "Offer this day"}
                </button>
                {savedFlash && <span className="text-sm font-medium" style={{ color: "#e8c877" }}>Offered ✓</span>}
                {error && <span className="text-sm text-red-300">{error}</span>}
              </div>
            </div>

            {/* ===== Averages ===== */}
            {entries.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6 portal-rise" style={{ ["--i" as string]: 9 }}>
                <Stat label="Chanting" value={avgRounds !== null ? avgRounds.toFixed(1) : "—"} unit="rounds" ok={(avgRounds ?? 0) >= TARGET_ROUNDS} />
                <Stat label="Wake-up" value={avgWakeMin !== null ? `${String(Math.floor(avgWakeMin / 60)).padStart(2, "0")}:${String(Math.round(avgWakeMin % 60)).padStart(2, "0")}` : "—"} unit="avg" ok={avgWakeMin !== null && avgWakeMin <= (toMin(TARGET_WAKE) ?? 0)} />
                <Stat label="Hearing" value={avgHearing !== null ? fmtDur(Math.round(avgHearing)) : "—"} unit="avg" ok={null} />
                <Stat label="Reading" value={avgReading !== null ? fmtDur(Math.round(avgReading)) : "—"} unit="avg" ok={null} />
                <Stat label="Service" value={avgService !== null ? fmtDur(Math.round(avgService)) : "—"} unit="avg" ok={null} />
                <Stat label="Sleep" value={avgSleep !== null ? fmtDur(Math.round(avgSleep)) : "—"} unit="avg" ok={null} />
              </div>
            )}

            {/* ===== Chart ===== */}
            {entries.length > 1 && (
              <div className="portal-card p-6 mb-6 portal-rise" style={{ ["--i" as string]: 10 }}>
                <h3 className="font-display text-lg font-bold mb-4" style={{ color: "#f5e9da" }}>Chanting — last 30 days</h3>
                <Bar data={roundsChart} options={{
                  responsive: true,
                  plugins: { legend: { display: true, labels: { boxWidth: 12, font: { size: 10 }, color: "rgba(245,233,218,0.75)" } } },
                  scales: {
                    y: { beginAtZero: true, ticks: { color: "rgba(245,233,218,0.6)" }, grid: { color: "rgba(245,233,218,0.08)" } },
                    x: { ticks: { color: "rgba(245,233,218,0.6)" }, grid: { display: false } },
                  },
                }} />
              </div>
            )}

            {/* ===== Timeline ===== */}
            {entries.length > 0 && (
              <div className="portal-card p-6 mb-10 portal-rise" style={{ ["--i" as string]: 11 }}>
                <h3 className="font-display text-lg font-bold mb-4" style={{ color: "#f5e9da" }}>Recent days</h3>
                <div className="space-y-2">
                  {entries.slice(0, 14).map((e) => (
                    <button key={e.entryDate} onClick={() => { setDate(e.entryDate); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                      className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 text-left px-3 py-2 rounded-lg transition hover:bg-black/25"
                      style={{ border: "1px solid rgba(201,162,77,0.12)" }}>
                      <span className="font-display font-bold text-sm" style={{ color: "#e8c877" }}>{e.entryDate}</span>
                      <Chip>🙏 {e.chantingRounds || 0}</Chip>
                      {e.wakeUpAt && <Chip>⏰ {e.wakeUpAt}</Chip>}
                      {e.hearingMinutes > 0 && <Chip>👂 {fmtDur(e.hearingMinutes)}</Chip>}
                      {e.readingMinutes > 0 && <Chip>📖 {fmtDur(e.readingMinutes)}{e.readingBook ? ` · ${e.readingBook}` : ""}</Chip>}
                      {e.serviceMinutes > 0 && <Chip>🤲 {fmtDur(e.serviceMinutes)}{e.serviceNote ? ` · ${e.serviceNote}` : ""}</Chip>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {entries.length === 0 && (
              <div className="text-center text-sm opacity-60 pb-10">Your book of practice is empty — offer today above to begin.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, unit, ok }: { label: string; value: string; unit: string; ok: boolean | null }) {
  return (
    <div className="portal-card p-3 text-center">
      <div className="text-[10px] uppercase tracking-wider opacity-60">{label}</div>
      <div className="font-display text-lg font-bold" style={{ color: ok === true ? "#8fd18f" : ok === false ? "#e8c877" : "#f5e9da" }}>{value}</div>
      <div className="text-[10px] opacity-50">{unit}</div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "rgba(201,162,77,0.14)", color: "#e8d9bc" }}>
      {children}
    </span>
  );
}
