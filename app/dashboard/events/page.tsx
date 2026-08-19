"use client";

import { useAllData, byType } from "@/lib/use-all-data";

interface EventRecord {
  id: string; title: string; description: string; eventDate: string;
  eventTime: string; venue: string; price: number; capacity: number;
}

export default function EventsPage() {
  const { data, loading } = useAllData();
  const events = byType<EventRecord>(data, "event");
  const fmtINR = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  if (loading) return <div className="text-center py-12 text-gray-400">Loading events...</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-800">Events ({events.length})</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {events.map((e) => (
          <div key={e.id} className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-800">{e.title}</h3>
            {e.description && <p className="text-sm text-gray-500 mt-1">{e.description}</p>}
            <div className="mt-3 space-y-1 text-sm text-gray-600">
              <div>📅 {String(e.eventDate || "—").split("T")[0]} {e.eventTime && `at ${e.eventTime}`}</div>
              {e.venue && <div>📍 {e.venue}</div>}
              {e.price > 0 && <div>🎟️ {fmtINR(e.price)} {e.capacity > 0 && `· ${e.capacity} seats`}</div>}
            </div>
          </div>
        ))}
        {events.length === 0 && <div className="col-span-full text-center py-8 text-gray-400">No active events</div>}
      </div>
    </div>
  );
}
