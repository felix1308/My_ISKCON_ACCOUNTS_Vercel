"use client";

import { useState, useMemo } from "react";
import { useAllData, byType } from "@/lib/use-all-data";
import { useAuth } from "@/lib/auth-context";
import { callApi } from "@/lib/client";

interface EventRecord {
  __backendId: string; id: string; title: string; description: string;
  eventDate: string; eventTime: string; venue: string; price: number;
  capacity: number; departmentId: string; centerId: string; isActive: boolean;
}
interface EventBooking {
  __backendId: string; id: string; eventId: string; donorId: string;
  quantity: number; totalAmount: number; paymentStatus: string;
  paymentMode: string; remarks: string; bookedBy: string; createdAt: string;
}
interface DonorRecord { __backendId: string; name: string; mobile: string; }
interface DeptRecord { id: string; name: string; type: string; }

export default function EventsPage() {
  const { data, loading, reload } = useAllData();
  const { user, isSuperuser } = useAuth();
  const isStaff = isSuperuser || user?.role === "admin" || user?.role === "volunteer";

  const events = byType<EventRecord>(data, "event");
  const eventBookings = byType<EventBooking>(data, "event_booking");
  const donors = byType<DonorRecord>(data, "donor");
  const departments = byType<DeptRecord>(data, "department");

  // ---- State ----
  const [deptFilter, setDeptFilter] = useState("all");
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventRecord | null>(null);
  const [eventForm, setEventForm] = useState({ title: "", description: "", eventDate: "", eventTime: "", venue: "", price: "0", capacity: "0" });
  const [savingEvent, setSavingEvent] = useState(false);

  // Staff bookings state
  const [bookingSearch, setBookingSearch] = useState("");
  const [bookingStatusFilter, setBookingStatusFilter] = useState("all");

  // Walk-in state
  const [walkinForm, setWalkinForm] = useState({ eventId: "", donorSearch: "", donorId: "", donorName: "", quantity: "1", paymentMode: "cash", paymentStatus: "paid", remarks: "" });
  const [walkinError, setWalkinError] = useState("");
  const [walkinSaving, setWalkinSaving] = useState(false);

  // Booking modal state (donor self-booking)
  const [bookingModal, setBookingModal] = useState<{ event: EventRecord; quantity: number } | null>(null);
  const [bookingError, setBookingError] = useState("");
  const [bookingPaying, setBookingPaying] = useState(false);

  const fmtINR = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  const donorName = (id: string) => donors.find((d) => d.__backendId === id)?.name || "—";

  function countBookedSeats(eventId: string) {
    return eventBookings
      .filter((b) => b.eventId === eventId && b.paymentStatus !== "cancelled")
      .reduce((s, b) => s + (b.quantity || 0), 0);
  }

  // ---- Filtered events ----
  const filteredEvents = useMemo(() => {
    let list = events.filter((e) => e.isActive !== false);
    if (deptFilter !== "all") {
      list = list.filter((e) => {
        const dept = departments.find((d) => d.id === e.departmentId);
        return dept?.type?.toLowerCase() === deptFilter;
      });
    }
    return list.sort((a, b) => String(a.eventDate || "").localeCompare(String(b.eventDate || "")));
  }, [events, deptFilter, departments]);

  // ---- My bookings (for donors) ----
  const myBookings = useMemo(() => {
    if (!user?.donorId && !user?.isDonor) return [];
    return eventBookings.filter((b) => b.donorId === user?.donorId || b.bookedBy === user?.backendId);
  }, [eventBookings, user]);

  // ---- Staff: all bookings filtered ----
  const staffBookings = useMemo(() => {
    let list = [...eventBookings];
    if (bookingStatusFilter !== "all") list = list.filter((b) => b.paymentStatus === bookingStatusFilter);
    if (bookingSearch.trim()) {
      const q = bookingSearch.toLowerCase();
      list = list.filter((b) => {
        const dn = donorName(b.donorId).toLowerCase();
        const ev = events.find((e) => (e.__backendId || e.id) === b.eventId)?.title?.toLowerCase() || "";
        return dn.includes(q) || ev.includes(q);
      });
    }
    return list.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }, [eventBookings, bookingStatusFilter, bookingSearch, events, donors]);

  // ---- Donor search for walk-in ----
  const walkinDonorResults = useMemo(() => {
    if (!walkinForm.donorSearch.trim() || walkinForm.donorSearch.length < 2) return [];
    const q = walkinForm.donorSearch.toLowerCase();
    return donors.filter((d) => d.name?.toLowerCase().includes(q) || d.mobile?.includes(q)).slice(0, 10);
  }, [walkinForm.donorSearch, donors]);

  // ---- Event CRUD ----
  function openNewEvent() {
    setEditingEvent(null);
    setEventForm({ title: "", description: "", eventDate: "", eventTime: "", venue: "", price: "0", capacity: "0" });
    setShowEventForm(true);
  }
  function openEditEvent(e: EventRecord) {
    setEditingEvent(e);
    setEventForm({
      title: e.title, description: e.description || "", eventDate: String(e.eventDate || "").split("T")[0],
      eventTime: e.eventTime || "", venue: e.venue || "", price: String(e.price || 0), capacity: String(e.capacity || 0),
    });
    setShowEventForm(true);
  }
  async function handleSaveEvent() {
    setSavingEvent(true);
    const payload = {
      title: eventForm.title, description: eventForm.description, eventDate: eventForm.eventDate,
      eventTime: eventForm.eventTime, venue: eventForm.venue, price: Number(eventForm.price) || 0,
      capacity: Number(eventForm.capacity) || 0,
    };
    if (editingEvent) {
      await callApi("updateEvent", { eventId: editingEvent.__backendId || editingEvent.id, ...payload });
    } else {
      await callApi("createEvent", payload);
    }
    setSavingEvent(false); setShowEventForm(false); reload();
  }
  async function deleteEvent(e: EventRecord) {
    if (!confirm(`Delete event "${e.title}"?`)) return;
    await callApi("deleteEvent", { eventId: e.__backendId || e.id });
    reload();
  }

  // ---- Donor self-booking ----
  function openBookingModal(e: EventRecord) {
    setBookingModal({ event: e, quantity: 1 }); setBookingError("");
  }
  async function handleDonorBooking() {
    if (!bookingModal) return;
    setBookingPaying(true); setBookingError("");
    const { event, quantity } = bookingModal;
    const price = event.price || 0;
    const totalAmount = price * quantity;
    try {
      if (price === 0) {
        // Free event — book directly
        const res = await callApi("createEventBooking", {
          eventId: event.__backendId || event.id, quantity, totalAmount: 0,
          paymentStatus: "paid", paymentMode: "free",
        });
        if (!res.isOk) throw new Error((res as { error?: string }).error || "Booking failed");
      } else {
        // Paid — create pending booking
        const res = await callApi("createEventBooking", {
          eventId: event.__backendId || event.id, quantity, totalAmount,
          paymentStatus: "pending", paymentMode: "online",
        });
        if (!res.isOk) throw new Error((res as { error?: string }).error || "Booking failed");
        // TODO: Razorpay checkout integration
        // For now, mark as pending — admin can update payment status
      }
      setBookingModal(null); reload();
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : "Booking failed");
    }
    setBookingPaying(false);
  }

  // ---- Walk-in registration ----
  async function handleWalkinSubmit() {
    if (!walkinForm.eventId || !walkinForm.donorId) {
      setWalkinError("Select an event and donor"); return;
    }
    setWalkinSaving(true); setWalkinError("");
    const evt = events.find((e) => (e.__backendId || e.id) === walkinForm.eventId);
    const totalAmount = (evt?.price || 0) * (Number(walkinForm.quantity) || 1);
    const res = await callApi("createEventBooking", {
      eventId: walkinForm.eventId, donorId: walkinForm.donorId,
      quantity: Number(walkinForm.quantity) || 1, totalAmount,
      paymentStatus: walkinForm.paymentStatus, paymentMode: walkinForm.paymentMode,
      remarks: walkinForm.remarks,
    });
    setWalkinSaving(false);
    if (!res.isOk) { setWalkinError((res as { error?: string }).error || "Failed"); return; }
    setWalkinForm({ eventId: "", donorSearch: "", donorId: "", donorName: "", quantity: "1", paymentMode: "cash", paymentStatus: "paid", remarks: "" });
    reload();
  }

  // ---- Cancel booking ----
  async function cancelBooking(b: EventBooking) {
    if (!confirm("Cancel this booking?")) return;
    await callApi("cancelEventBooking", { bookingId: b.__backendId || b.id });
    reload();
  }

  if (loading) return <div className="text-center py-12 text-theme-muted">Loading events...</div>;

  // ========== DONOR VIEW ==========
  if (user?.isDonor) {
    return (
      <div className="space-y-6">
        {/* Header + filters */}
        <div>
          <h2 className="font-display text-2xl font-bold text-theme-primary">Upcoming Events</h2>
          <p className="text-sm text-theme-secondary mt-1">Browse and register for events</p>
          <div className="flex gap-2 mt-3">
            {["all", "yatra", "seminar"].map((f) => (
              <button key={f} onClick={() => setDeptFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${deptFilter === f ? "bg-theme-muted text-theme-primary border border-theme-strong" : "border border-theme text-theme-secondary hover:bg-theme-page"}`}>
                {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Events grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredEvents.map((e) => {
            const booked = countBookedSeats(e.__backendId || e.id);
            const remaining = e.capacity > 0 ? e.capacity - booked : null;
            const soldOut = remaining !== null && remaining <= 0;
            return (
              <div key={e.__backendId || e.id} className="seva-card bg-white rounded-xl card-shadow border border-theme p-5 transition">
                <h3 className="font-display font-semibold text-theme-primary">{e.title}</h3>
                {e.description && <p className="text-sm text-theme-secondary mt-1">{e.description}</p>}
                <div className="mt-3 space-y-1 text-sm text-theme-secondary">
                  <div>📅 {String(e.eventDate || "").split("T")[0]} {e.eventTime && `at ${e.eventTime}`}</div>
                  {e.venue && <div>📍 {e.venue}</div>}
                  <div>🎟️ {e.price > 0 ? fmtINR(e.price) : "Free"} {remaining !== null && `· ${remaining} seats left`}</div>
                </div>
                <button onClick={() => openBookingModal(e)} disabled={soldOut}
                  className={`mt-3 w-full py-2 rounded-lg text-sm font-medium transition ${soldOut ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "btn-primary"}`}>
                  {soldOut ? "Sold Out" : "Book Now"}
                </button>
              </div>
            );
          })}
          {filteredEvents.length === 0 && <div className="col-span-full text-center py-8 text-theme-muted">No upcoming events</div>}
        </div>

        {/* My registrations */}
        {myBookings.length > 0 && (
          <div className="bg-white rounded-xl card-shadow p-5">
            <h3 className="font-display text-lg font-semibold text-theme-primary mb-3">My Event Registrations</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-theme-muted text-theme-secondary">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Event</th>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 text-center font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-theme-muted">
                  {myBookings.map((b) => {
                    const evt = events.find((e) => (e.__backendId || e.id) === b.eventId);
                    return (
                      <tr key={b.__backendId || b.id} className="hover:bg-theme-page">
                        <td className="px-3 py-2 text-theme-primary">{evt?.title || "—"}</td>
                        <td className="px-3 py-2 text-theme-secondary">{String(evt?.eventDate || "").split("T")[0]}</td>
                        <td className="px-3 py-2 text-right">{b.quantity}</td>
                        <td className="px-3 py-2 text-right">{fmtINR(b.totalAmount || 0)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${b.paymentStatus === "paid" ? "bg-green-100 text-green-700" : b.paymentStatus === "cancelled" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}>
                            {b.paymentStatus}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Booking modal */}
        {bookingModal && (
          <div className="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4">
            <div className="bg-white rounded-xl card-shadow p-6 w-full max-w-md">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-display text-lg font-semibold text-theme-primary">Book Event</h3>
                <button onClick={() => setBookingModal(null)} className="text-theme-muted hover:text-theme-primary">&times;</button>
              </div>
              <div className="bg-theme-page rounded-lg p-3 mb-4 text-sm">
                <p className="font-medium text-theme-primary">{bookingModal.event.title}</p>
                <p className="text-theme-secondary">{String(bookingModal.event.eventDate || "").split("T")[0]} {bookingModal.event.venue && `· ${bookingModal.event.venue}`}</p>
                <p className="text-theme-accent font-medium mt-1">{bookingModal.event.price > 0 ? `${fmtINR(bookingModal.event.price)} per seat` : "Free"}</p>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-theme-secondary mb-1">Number of Seats</label>
                  <input type="number" min={1} max={10} value={bookingModal.quantity}
                    onChange={(e) => setBookingModal({ ...bookingModal, quantity: Math.max(1, Number(e.target.value) || 1) })}
                    className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" />
                </div>
                <div className="text-lg font-bold text-theme-primary">
                  Total: {fmtINR((bookingModal.event.price || 0) * bookingModal.quantity)}
                </div>
                {bookingError && <div className="text-sm text-red-600 bg-red-50 rounded p-2">{bookingError}</div>}
                <button onClick={handleDonorBooking} disabled={bookingPaying}
                  className="btn-primary w-full py-2.5 rounded-lg text-sm font-medium">
                  {bookingPaying ? "Processing..." : bookingModal.event.price > 0 ? "Book & Pay" : "Register (Free)"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ========== STAFF / ADMIN VIEW ==========
  return (
    <div className="space-y-6">
      {/* Event Management */}
      <div className="bg-white rounded-xl card-shadow p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-display text-xl font-semibold text-theme-primary">Event Management</h3>
            <p className="text-sm text-theme-secondary">Create and manage events for your center</p>
          </div>
          <button onClick={openNewEvent} className="btn-primary text-sm px-4 py-2 rounded-lg flex items-center gap-1">
            <span className="text-lg leading-none">+</span> New Event
          </button>
        </div>

        {/* Event form */}
        {showEventForm && (
          <div className="bg-theme-page rounded-lg p-4 mb-4 space-y-3 border border-theme">
            <h4 className="font-semibold text-theme-primary">{editingEvent ? "Edit Event" : "New Event"}</h4>
            <div className="grid grid-cols-2 gap-3">
              <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm col-span-2" placeholder="Event Title *" value={eventForm.title} onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })} />
              <textarea className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm col-span-2" rows={2} placeholder="Description" value={eventForm.description} onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })} />
              <input type="date" className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" value={eventForm.eventDate} onChange={(e) => setEventForm({ ...eventForm, eventDate: e.target.value })} />
              <input type="time" className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" value={eventForm.eventTime} onChange={(e) => setEventForm({ ...eventForm, eventTime: e.target.value })} />
              <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Venue / Location" value={eventForm.venue} onChange={(e) => setEventForm({ ...eventForm, venue: e.target.value })} />
              <input type="number" className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Price (₹)" min={0} value={eventForm.price} onChange={(e) => setEventForm({ ...eventForm, price: e.target.value })} />
              <input type="number" className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Capacity (0 = unlimited)" min={0} value={eventForm.capacity} onChange={(e) => setEventForm({ ...eventForm, capacity: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <button onClick={handleSaveEvent} disabled={savingEvent} className="btn-primary text-sm px-4 py-2 rounded-lg">{savingEvent ? "Saving..." : "Save Event"}</button>
              <button onClick={() => setShowEventForm(false)} className="text-sm px-4 py-2 border border-theme rounded-lg text-theme-secondary">Cancel</button>
            </div>
          </div>
        )}

        {/* Events list */}
        <div className="space-y-2">
          {events.map((e) => {
            const booked = countBookedSeats(e.__backendId || e.id);
            return (
              <div key={e.__backendId || e.id} className="flex items-center justify-between bg-theme-page rounded-lg px-4 py-3">
                <div>
                  <span className="font-medium text-theme-primary">{e.title}</span>
                  <span className="text-sm text-theme-muted ml-2">{String(e.eventDate || "").split("T")[0]} · {e.price > 0 ? fmtINR(e.price) : "Free"} · {booked} booked</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openEditEvent(e)} className="text-xs text-theme-accent hover:underline">Edit</button>
                  <button onClick={() => deleteEvent(e)} className="text-xs text-red-600 hover:underline">Delete</button>
                </div>
              </div>
            );
          })}
          {events.length === 0 && <p className="text-center text-theme-muted py-4">No events yet.</p>}
        </div>
      </div>

      {/* Event Registrations Table */}
      <div className="bg-white rounded-xl card-shadow p-5">
        <h3 className="font-display text-lg font-semibold text-theme-primary mb-3">Event Registrations</h3>
        <div className="flex gap-2 mb-3 flex-wrap">
          <input type="text" placeholder="Search donor..." value={bookingSearch} onChange={(e) => setBookingSearch(e.target.value)}
            className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm w-48" />
          <select value={bookingStatusFilter} onChange={(e) => setBookingStatusFilter(e.target.value)}
            className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm">
            <option value="all">All Statuses</option>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        {staffBookings.length === 0 ? (
          <p className="text-center text-theme-muted py-4">No registrations found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-theme-muted text-theme-secondary">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Event</th>
                  <th className="px-3 py-2 text-left font-medium">Donor</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 text-left font-medium">Mode</th>
                  <th className="px-3 py-2 text-center font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-muted">
                {staffBookings.slice(0, 100).map((b) => {
                  const evt = events.find((e) => (e.__backendId || e.id) === b.eventId);
                  return (
                    <tr key={b.__backendId || b.id} className="hover:bg-theme-page">
                      <td className="px-3 py-2 text-theme-primary">{evt?.title || "—"}</td>
                      <td className="px-3 py-2 text-theme-secondary">{donorName(b.donorId)}</td>
                      <td className="px-3 py-2 text-right">{b.quantity}</td>
                      <td className="px-3 py-2 text-right">{fmtINR(b.totalAmount || 0)}</td>
                      <td className="px-3 py-2 text-theme-secondary capitalize">{b.paymentMode || "—"}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${b.paymentStatus === "paid" ? "bg-green-100 text-green-700" : b.paymentStatus === "cancelled" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}>
                          {b.paymentStatus}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {b.paymentStatus !== "cancelled" && (
                          <button onClick={() => cancelBooking(b)} className="text-xs text-red-600 hover:underline">Cancel</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Walk-in Registration */}
      <div className="bg-white rounded-xl card-shadow p-5">
        <h3 className="font-display text-lg font-semibold text-theme-primary mb-3">Walk-in Registration</h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <select className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" value={walkinForm.eventId} onChange={(e) => setWalkinForm({ ...walkinForm, eventId: e.target.value })}>
            <option value="">Select Event *</option>
            {events.map((e) => <option key={e.__backendId || e.id} value={e.__backendId || e.id}>{e.title}</option>)}
          </select>
          <div className="relative">
            <input type="text" className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Search donor by name/mobile..." value={walkinForm.donorSearch}
              onChange={(e) => setWalkinForm({ ...walkinForm, donorSearch: e.target.value, donorId: "", donorName: "" })} />
            {walkinDonorResults.length > 0 && !walkinForm.donorId && (
              <div className="absolute z-10 top-full left-0 right-0 bg-white border border-theme rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {walkinDonorResults.map((d) => (
                  <button key={d.__backendId} className="w-full text-left px-3 py-2 text-sm hover:bg-theme-page transition"
                    onClick={() => setWalkinForm({ ...walkinForm, donorId: d.__backendId, donorName: d.name, donorSearch: d.name })}>
                    {d.name} <span className="text-theme-muted">({d.mobile})</span>
                  </button>
                ))}
              </div>
            )}
            {walkinForm.donorName && <p className="text-xs text-green-600 mt-1">Selected: {walkinForm.donorName}</p>}
          </div>
          <input type="number" min={1} className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Qty" value={walkinForm.quantity} onChange={(e) => setWalkinForm({ ...walkinForm, quantity: e.target.value })} />
          <select className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" value={walkinForm.paymentMode} onChange={(e) => setWalkinForm({ ...walkinForm, paymentMode: e.target.value })}>
            <option value="cash">Cash</option><option value="upi">UPI</option><option value="cheque">Cheque</option><option value="online">Online</option>
          </select>
          <select className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" value={walkinForm.paymentStatus} onChange={(e) => setWalkinForm({ ...walkinForm, paymentStatus: e.target.value })}>
            <option value="paid">Paid</option><option value="pending">Pending</option>
          </select>
          <input className="px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Remarks (optional)" value={walkinForm.remarks} onChange={(e) => setWalkinForm({ ...walkinForm, remarks: e.target.value })} />
        </div>
        {walkinError && <div className="text-sm text-red-600 mt-2">{walkinError}</div>}
        <button onClick={handleWalkinSubmit} disabled={walkinSaving} className="btn-primary mt-3 text-sm px-4 py-2 rounded-lg">
          {walkinSaving ? "Saving..." : "Record Registration"}
        </button>
      </div>
    </div>
  );
}
