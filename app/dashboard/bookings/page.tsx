"use client";

import { useState, useMemo, useCallback } from "react";
import { useAllData, byType } from "@/lib/use-all-data";
import { useAuth } from "@/lib/auth-context";
import { callApi } from "@/lib/client";

interface BookingRecord {
  __backendId: string; donorId: string; items: Array<{ name?: string; sevaId?: string; amount?: number; quantity?: number; bookingDate?: string }>;
  totalAmount: number; paymentStatus: string; paymentMode: string; bookingDate: string;
  centerId: string; collectedBy: string; remarks: string;
}
interface DonorRecord { __backendId: string; name: string; mobile: string; whatsapp: string; email: string; pan: string; spiritualName: string; flat: string; road: string; po: string; area: string; pincode: string; district: string; state: string; country: string; tallyName: string; centerId: string; indianPassport: boolean; }
interface SevaRecord { id: string; __backendId: string; name: string; description: string; amount: number; centerId: string; isActive: boolean; }
interface CenterRecord { id: string; name: string; }
interface BankRecord { __backendId: string; id: string; name: string; centerId: string; }

interface CartItem {
  sevaId: string; name: string; description: string; amount: number;
  isFlexibleAmount: boolean; quantity: number; bookingDate: string;
}

export default function BookingsPage() {
  const { data, loading, reload } = useAllData();
  const { user, isSuperuser } = useAuth();
  const isDonor = user?.isDonor;

  const donors = byType<DonorRecord>(data, "donor");
  const allSevas = byType<SevaRecord>(data, "seva");
  const centers = byType<CenterRecord>(data, "center");
  const bankAccounts = byType<BankRecord>(data, "bank_account");
  const allBookings = byType<BookingRecord>(data, "booking");

  // ---- Donor search ----
  const [mobileSearch, setMobileSearch] = useState("");
  const [donorDropdownOpen, setDonorDropdownOpen] = useState(false);
  const [selectedDonorId, setSelectedDonorId] = useState("");

  // ---- Donor form ----
  const [donorForm, setDonorForm] = useState({
    name: "", spiritualName: "", indianPassport: false, pan: "", tallyName: "",
    mobile: "", whatsapp: "", email: "",
    flat: "", road: "", po: "", area: "", pincode: "", district: "", state: "", country: "India", centerId: "",
  });
  const [pincodeStatus, setPincodeStatus] = useState("");

  // ---- Seva selection ----
  const [selectedCenterId, setSelectedCenterId] = useState(user?.centerId || "");
  const [cart, setCart] = useState<CartItem[]>([]);

  // ---- Payment ----
  const [paymentMode, setPaymentMode] = useState<"online" | "cash" | "cheque" | "upi">("online");
  const [remarks, setRemarks] = useState("");
  const [upiRef, setUpiRef] = useState("");
  const [chequeBankId, setChequeBankId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const today = new Date().toISOString().split("T")[0];
  const fmtINR = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  // ---- Donor search results ----
  const donorResults = useMemo(() => {
    if (mobileSearch.length < 2) return [];
    const q = mobileSearch.toLowerCase();
    return donors.filter((d) => d.mobile?.includes(q) || d.name?.toLowerCase().includes(q)).slice(0, 10);
  }, [mobileSearch, donors]);

  // ---- Sevas for selected center ----
  const sevasForCenter = useMemo(() => {
    return allSevas.filter((s) => s.isActive !== false && (!s.centerId || s.centerId === "all_centers" || s.centerId === selectedCenterId));
  }, [allSevas, selectedCenterId]);

  // ---- Cart total ----
  const cartTotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + (item.amount || 0) * (item.quantity || 1), 0);
  }, [cart]);

  // ---- Select donor ----
  function selectDonor(d: DonorRecord) {
    setSelectedDonorId(d.__backendId);
    setDonorForm({
      name: d.name || "", spiritualName: d.spiritualName || "", indianPassport: d.indianPassport === true,
      pan: d.pan || "", tallyName: d.tallyName || "", mobile: d.mobile || "",
      whatsapp: d.whatsapp || "", email: d.email || "",
      flat: d.flat || "", road: d.road || "", po: d.po || "", area: d.area || "",
      pincode: d.pincode || "", district: d.district || "", state: d.state || "",
      country: d.country || "India", centerId: d.centerId || "",
    });
    setMobileSearch(d.mobile);
    setDonorDropdownOpen(false);
  }

  // ---- Add seva to cart ----
  function addSeva(seva: SevaRecord) {
    setCart((prev) => {
      const existing = prev.find((c) => c.sevaId === (seva.__backendId || seva.id));
      if (existing) {
        return prev.map((c) => c.sevaId === existing.sevaId ? { ...c, quantity: c.quantity + 1 } : c);
      }
      const amt = seva.amount || 0;
      return [...prev, {
        sevaId: seva.__backendId || seva.id, name: seva.name, description: seva.description || "",
        amount: amt, isFlexibleAmount: amt === 0, quantity: 1, bookingDate: today,
      }];
    });
  }

  function removeSeva(sevaId: string) {
    setCart((prev) => prev.filter((c) => c.sevaId !== sevaId));
  }

  function updateCartItemAmount(sevaId: string, amount: number) {
    setCart((prev) => prev.map((c) => c.sevaId === sevaId ? { ...c, amount } : c));
  }

  function updateCartItemQuantity(sevaId: string, quantity: number) {
    setCart((prev) => prev.map((c) => c.sevaId === sevaId ? { ...c, quantity: Math.max(1, quantity) } : c));
  }

  // ---- Pincode lookup ----
  const lookupPincode = useCallback(async (pin: string) => {
    if (pin.length !== 6) { setPincodeStatus(""); return; }
    setPincodeStatus("Looking up...");
    try {
      const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
      const json = await res.json();
      if (json?.[0]?.Status === "Success" && json[0].PostOffice?.length > 0) {
        const po = json[0].PostOffice[0];
        setDonorForm((f) => ({ ...f, district: po.District || f.district, state: po.State || f.state, country: po.Country || "India" }));
        setPincodeStatus(`${po.District}, ${po.State}`);
      } else { setPincodeStatus("Not found"); }
    } catch { setPincodeStatus("Lookup failed"); }
  }, []);

  // ---- Helper: reset form after successful booking ----
  function resetBookingForm() {
    setCart([]);
    setSelectedDonorId("");
    setDonorForm({ name: "", spiritualName: "", indianPassport: false, pan: "", tallyName: "", mobile: "", whatsapp: "", email: "", flat: "", road: "", po: "", area: "", pincode: "", district: "", state: "", country: "India", centerId: "" });
    setMobileSearch("");
    setRemarks("");
    setUpiRef("");
    setChequeBankId("");
    reload();
  }

  // ---- Helper: create/find donor and return the ID ----
  async function ensureDonorId(): Promise<string | null> {
    if (selectedDonorId) return selectedDonorId;
    const donorResult = await callApi("create", {
      record: { type: "donor", ...donorForm, centerId: donorForm.centerId || undefined },
    });
    if (!donorResult.isOk) {
      setSaveError((donorResult as { error?: string }).error || "Failed to save donor");
      return null;
    }
    const created = (donorResult as { data?: { __backendId?: string } }).data;
    let id = created?.__backendId || "";
    if (!id) {
      await reload();
      const found = donors.find((d) => d.mobile === donorForm.mobile);
      id = found?.__backendId || "";
    }
    if (!id) { setSaveError("Donor created but could not retrieve ID"); return null; }
    return id;
  }

  // ---- Save booking (cash/cheque/upi) ----
  async function handleSaveBooking() {
    if (!donorForm.name || !donorForm.mobile) { setSaveError("Please fill donor name and mobile"); return; }
    if (cart.length === 0) { setSaveError("Please add at least one seva"); return; }
    for (const item of cart) {
      if (item.isFlexibleAmount && (item.amount || 0) < 1) { setSaveError(`Enter an amount for "${item.name}"`); return; }
    }
    setSaving(true); setSaveError("");

    try {
      const finalDonorId = await ensureDonorId();
      if (!finalDonorId) return;

      const isPaidNow = paymentMode === "cash" || paymentMode === "cheque" || paymentMode === "upi";
      const bookingCenterId = selectedCenterId || (isSuperuser ? "all_centers" : user?.centerId || "");
      const finalRemarks = paymentMode === "upi" && upiRef
        ? (remarks ? `${remarks} | UPI ref: ${upiRef}` : `UPI ref: ${upiRef}`) : remarks;

      if (paymentMode === "online") {
        // ---- RAZORPAY FLOW ----
        await handleRazorpayFlow(finalDonorId, bookingCenterId);
        return;
      }

      // ---- CASH / CHEQUE / UPI ----
      const bookingResult = await callApi("create", {
        record: {
          type: "booking", donorId: finalDonorId,
          items: cart.map((c) => ({ sevaId: c.sevaId, name: c.name, description: c.description, amount: c.amount, quantity: c.quantity, bookingDate: c.bookingDate })),
          totalAmount: cartTotal, paymentStatus: isPaidNow ? "paid" : "pending", paymentMode,
          bookingDate: new Date().toISOString(), centerId: bookingCenterId,
          collectedBy: user?.username || "", collectedByCenter: isSuperuser ? "all_centers" : user?.centerId || "",
          chequeBankAccountId: paymentMode === "cheque" ? chequeBankId : "",
          paidAt: isPaidNow ? new Date().toISOString() : "", remarks: finalRemarks,
        },
      });
      if (bookingResult.isOk) resetBookingForm();
      else setSaveError((bookingResult as { error?: string }).error || "Failed to save booking");
    } finally {
      setSaving(false);
    }
  }

  // ---- Razorpay checkout flow ----
  async function handleRazorpayFlow(donorId: string, bookingCenterId: string) {
    // Check Razorpay SDK loaded
    const RazorpayClass = (globalThis as unknown as { Razorpay?: new (opts: Record<string, unknown>) => { open: () => void } }).Razorpay;
    if (!RazorpayClass) {
      setSaveError("Razorpay is still loading. Please wait a moment and try again.");
      setSaving(false);
      return;
    }

    try {
      // Step 1: Create a pending booking
      const bookingResult = await callApi("create", {
        record: {
          type: "booking", donorId,
          items: cart.map((c) => ({ sevaId: c.sevaId, name: c.name, description: c.description, amount: c.amount, quantity: c.quantity, bookingDate: c.bookingDate })),
          totalAmount: cartTotal, paymentStatus: "pending", paymentMode: "online",
          bookingDate: new Date().toISOString(), centerId: bookingCenterId,
          collectedBy: user?.username || "", collectedByCenter: isSuperuser ? "all_centers" : user?.centerId || "",
          remarks: remarks,
        },
      });
      if (!bookingResult.isOk) {
        setSaveError((bookingResult as { error?: string }).error || "Failed to create booking");
        setSaving(false);
        return;
      }
      const bookingId = (bookingResult as { data?: { __backendId?: string } }).data?.__backendId || "";

      // Step 2: Create Razorpay order
      const amountPaise = Math.round(cartTotal * 100);
      const orderResult = await callApi("createRazorpayOrder", {
        amount: amountPaise,
        receipt: bookingId,
        currency: "INR",
        centerId: bookingCenterId,
      });
      if (!orderResult.isOk) {
        setSaveError((orderResult as { error?: string }).error || "Failed to create payment order");
        setSaving(false);
        return;
      }
      const order = orderResult as Record<string, unknown>;
      const paymentGatewayId = (order.paymentGatewayId as string) || "";

      // Step 3: Open Razorpay checkout popup
      setSaving(false); // Allow UI interaction while popup is open
      const rzpOptions: Record<string, unknown> = {
        key: order.keyId,
        amount: order.amount,
        order_id: order.orderId,
        name: "ISKCON Cultural Centre",
        description: "Seva Donation",
        prefill: {
          name: donorForm.name,
          contact: donorForm.mobile,
          email: donorForm.email || undefined,
        },
        handler: function(response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
          // Step 4: Verify payment on server (non-async wrapper to avoid silent failures)
          setSaving(true);
          setSaveError("");
          callApi("verifyRazorpayPayment", {
            orderId: response.razorpay_order_id,
            paymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature,
            bookingId,
            paymentGatewayId,
          }).then((verifyResult) => {
            setSaving(false);
            if (verifyResult.isOk) {
              alert("Payment successful! Booking has been recorded.");
              resetBookingForm();
            } else {
              setSaveError((verifyResult as { error?: string }).error || "Payment verification failed. Your payment was received but booking update failed. Contact admin with Razorpay Payment ID: " + response.razorpay_payment_id);
            }
          }).catch((err) => {
            setSaving(false);
            setSaveError("Payment received but verification failed: " + (err instanceof Error ? err.message : String(err)) + ". Contact admin with Payment ID: " + response.razorpay_payment_id);
          });
        },
        modal: {
          ondismiss: () => {
            // User closed the popup without paying — booking stays as pending
            setSaving(false);
            setSaveError("Payment cancelled. Booking saved as pending.");
          },
        },
      };

      const rzp = new RazorpayClass(rzpOptions);
      rzp.open();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Something went wrong");
      setSaving(false);
    }
  }

  if (loading) return <div className="text-center py-12 text-theme-muted">Loading...</div>;

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* ==================== COLUMN 1: Search & Donor Info ==================== */}
      <div className="lg:col-span-1 space-y-4">
        {/* Donor Search */}
        <div className="bg-white rounded-xl card-shadow p-6">
          <h3 className="font-display text-lg font-semibold text-theme-primary mb-4">Search Donor</h3>
          <div className="relative">
            <div className="flex gap-2">
              <input type="tel" value={mobileSearch}
                onChange={(e) => { setMobileSearch(e.target.value); setDonorDropdownOpen(true); setSelectedDonorId(""); }}
                className="flex-1 px-4 py-2 border border-theme rounded-lg theme-focus outline-none text-sm"
                placeholder="Start typing mobile number..." />
              <button className="btn-primary text-white px-4 py-2 rounded-lg">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              </button>
            </div>
            {donorDropdownOpen && donorResults.length > 0 && (
              <div className="absolute top-full left-0 right-12 mt-1 bg-white border border-theme-strong rounded-lg shadow-lg max-h-48 overflow-y-auto z-20">
                {donorResults.map((d) => (
                  <button key={d.__backendId} onClick={() => selectDonor(d)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-theme-page transition border-b border-theme last:border-0">
                    <span className="font-medium text-theme-primary">{d.name}</span>
                    <span className="text-theme-muted ml-2">{d.mobile}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedDonorId && <p className="text-xs text-green-600 mt-2">Selected: {donorForm.name} ({donorForm.mobile})</p>}
        </div>

        {/* Donor Details Form */}
        <div className="bg-white rounded-xl card-shadow p-6">
          <h3 className="font-display text-lg font-semibold text-theme-primary mb-4">Donor Details</h3>
          <div className="space-y-3">
            <div><label className="block text-xs font-medium text-theme-secondary mb-1">Legal Name *</label>
              <input type="text" value={donorForm.name} onChange={(e) => setDonorForm({ ...donorForm, name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-theme rounded-lg theme-focus outline-none" placeholder="Full name" required /></div>
            <div><label className="block text-xs font-medium text-theme-secondary mb-1">Spiritual Name</label>
              <input type="text" value={donorForm.spiritualName} onChange={(e) => setDonorForm({ ...donorForm, spiritualName: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-theme rounded-lg theme-focus outline-none" placeholder="Initiated name" /></div>
            <div className="flex items-center gap-2 py-1">
              <input type="checkbox" checked={donorForm.indianPassport} onChange={(e) => setDonorForm({ ...donorForm, indianPassport: e.target.checked })} className="w-4 h-4" />
              <label className="text-xs font-medium text-theme-secondary">Indian Passport Holder</label>
            </div>
            <div><label className="block text-xs font-medium text-theme-secondary mb-1">PAN Number</label>
              <input type="text" value={donorForm.pan} onChange={(e) => setDonorForm({ ...donorForm, pan: e.target.value.toUpperCase() })}
                className="w-full px-3 py-2 text-sm border border-theme rounded-lg theme-focus outline-none uppercase" placeholder="ABCDE1234F" maxLength={10} /></div>
            <div><label className="block text-xs font-medium text-theme-secondary mb-1">Tally Name</label>
              <input type="text" value={donorForm.tallyName} onChange={(e) => setDonorForm({ ...donorForm, tallyName: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-theme rounded-lg theme-focus outline-none" placeholder="As in Tally / Excel import" /></div>
            <div><label className="block text-xs font-medium text-theme-secondary mb-1">Mobile Number *</label>
              <input type="tel" value={donorForm.mobile} onChange={(e) => { setDonorForm({ ...donorForm, mobile: e.target.value, whatsapp: e.target.value }); }}
                className="w-full px-3 py-2 text-sm border border-theme rounded-lg theme-focus outline-none" required /></div>
            <div><label className="block text-xs font-medium text-theme-secondary mb-1">WhatsApp Number</label>
              <input type="tel" value={donorForm.whatsapp} onChange={(e) => setDonorForm({ ...donorForm, whatsapp: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-theme rounded-lg theme-focus outline-none" placeholder="Auto-filled from mobile" /></div>
            <div><label className="block text-xs font-medium text-theme-secondary mb-1">Email</label>
              <input type="email" value={donorForm.email} onChange={(e) => setDonorForm({ ...donorForm, email: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-theme rounded-lg theme-focus outline-none" /></div>

            {/* Address */}
            <div className="border-t border-theme pt-3 mt-3">
              <p className="text-xs font-semibold text-theme-secondary mb-2">Address Details</p>
              <div className="space-y-2">
                <input type="text" value={donorForm.flat} onChange={(e) => setDonorForm({ ...donorForm, flat: e.target.value })} placeholder="Flat / Door / Building" className="w-full px-3 py-2 text-sm border border-theme rounded-lg theme-focus outline-none" />
                <input type="text" value={donorForm.road} onChange={(e) => setDonorForm({ ...donorForm, road: e.target.value })} placeholder="Road / Street" className="w-full px-3 py-2 text-sm border border-theme rounded-lg theme-focus outline-none" />
                <input type="text" value={donorForm.po} onChange={(e) => setDonorForm({ ...donorForm, po: e.target.value })} placeholder="Post Office" className="w-full px-3 py-2 text-sm border border-theme rounded-lg theme-focus outline-none" />
                <input type="text" value={donorForm.area} onChange={(e) => setDonorForm({ ...donorForm, area: e.target.value })} placeholder="Area / Locality" className="w-full px-3 py-2 text-sm border border-theme rounded-lg theme-focus outline-none" />
                <div>
                  <input type="text" value={donorForm.pincode} onChange={(e) => { setDonorForm({ ...donorForm, pincode: e.target.value }); if (e.target.value.length === 6) lookupPincode(e.target.value); else setPincodeStatus(""); }}
                    placeholder="Pincode" maxLength={6} className="w-full px-3 py-2 text-sm border border-theme rounded-lg theme-focus outline-none" />
                  {pincodeStatus && <p className="text-xs text-theme-muted mt-1">{pincodeStatus}</p>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={donorForm.district} readOnly placeholder="District" className="w-full px-3 py-2 text-sm border border-theme rounded-lg bg-theme-page text-theme-muted" />
                  <input type="text" value={donorForm.state} readOnly placeholder="State" className="w-full px-3 py-2 text-sm border border-theme rounded-lg bg-theme-page text-theme-muted" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={donorForm.country} readOnly className="w-full px-3 py-2 text-sm border border-theme rounded-lg bg-theme-page text-theme-muted" />
                  <select value={donorForm.centerId} onChange={(e) => setDonorForm({ ...donorForm, centerId: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-theme rounded-lg theme-focus outline-none">
                    <option value="">Center *</option>
                    {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ==================== COLUMN 2: Seva Selection ==================== */}
      <div className="lg:col-span-1">
        <div className="bg-white rounded-xl card-shadow p-6 h-full flex flex-col">
          {/* Center tabs */}
          <div className="mb-3">
            <p className="text-xs font-medium text-theme-secondary mb-2">Select Center</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {centers.map((c) => (
                <button key={c.id} onClick={() => setSelectedCenterId(c.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition border ${selectedCenterId === c.id ? "border-theme-strong bg-theme-page text-theme-primary" : "border-theme text-theme-secondary hover:bg-theme-page"}`}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <h3 className="font-display text-lg font-semibold text-theme-primary mb-3">Select Sevas</h3>

          {/* Quick Seva Grid */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            {sevasForCenter.map((seva) => {
              const amt = seva.amount || 0;
              const cartItem = cart.find((c) => c.sevaId === (seva.__backendId || seva.id));
              const isSelected = !!cartItem;
              return (
                <button key={seva.__backendId || seva.id} onClick={() => addSeva(seva)}
                  className={`p-3 rounded-lg border-2 text-left transition-all ${isSelected ? "border-theme-strong bg-theme-page shadow-md" : "border-theme hover:border-theme-strong hover:bg-theme-page"}`}>
                  <div className="flex justify-between items-start">
                    <span className="font-semibold text-theme-primary text-sm leading-tight">{seva.name}</span>
                    {isSelected && <span className="bg-theme-accent text-white text-xs px-1.5 py-0.5 rounded-full font-bold">{cartItem!.quantity}</span>}
                  </div>
                  <div className="text-theme-secondary font-bold text-sm mt-1">{amt > 0 ? fmtINR(amt) : "Flexible"}</div>
                </button>
              );
            })}
            {sevasForCenter.length === 0 && <p className="col-span-2 text-theme-muted text-sm text-center py-4">No sevas for this center.</p>}
          </div>

          <p className="text-xs text-theme-muted mb-2">Click to add seva. Selected sevas shown below.</p>

          {/* Selected sevas list */}
          <div className="space-y-2 min-h-32 max-h-96 overflow-y-auto flex-1">
            {cart.map((item) => (
              <div key={item.sevaId} className="flex items-center justify-between bg-theme-page rounded-lg px-3 py-2">
                <div className="flex-1">
                  <span className="text-sm font-medium text-theme-primary">{item.name}</span>
                  <div className="flex gap-2 mt-1">
                    <input type="number" min={1} value={item.quantity} onChange={(e) => updateCartItemQuantity(item.sevaId, Number(e.target.value))}
                      className="w-16 px-2 py-1 border border-theme rounded text-xs theme-focus" />
                    {item.isFlexibleAmount && (
                      <input type="number" min={0} value={item.amount || ""} onChange={(e) => updateCartItemAmount(item.sevaId, Number(e.target.value) || 0)}
                        placeholder="₹ Amount" className="w-24 px-2 py-1 border border-theme-strong rounded text-xs theme-focus" />
                    )}
                    <input type="date" value={item.bookingDate} onChange={(e) => setCart((prev) => prev.map((c) => c.sevaId === item.sevaId ? { ...c, bookingDate: e.target.value } : c))}
                      className="px-2 py-1 border border-theme rounded text-xs theme-focus" />
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <span className="text-sm font-medium text-theme-primary">{fmtINR((item.amount || 0) * (item.quantity || 1))}</span>
                  <button onClick={() => removeSeva(item.sevaId)} className="text-red-600 hover:text-red-800 text-lg leading-none">&times;</button>
                </div>
              </div>
            ))}
            {cart.length === 0 && <p className="text-theme-muted text-sm text-center py-6">No sevas selected</p>}
          </div>
        </div>
      </div>

      {/* ==================== COLUMN 3: Cart & Checkout ==================== */}
      <div className="lg:col-span-1">
        <div className="bg-white rounded-xl card-shadow p-6 sticky top-4">
          <h3 className="font-display text-lg font-semibold text-theme-primary mb-4">Booking Summary</h3>

          {/* Cart items */}
          <div className="space-y-2 mb-4 min-h-24 max-h-96 overflow-y-auto">
            {cart.length === 0 ? (
              <p className="text-theme-muted text-sm">No sevas selected</p>
            ) : (
              cart.map((item) => {
                const lineTotal = (item.amount || 0) * (item.quantity || 1);
                return (
                  <div key={item.sevaId} className="flex justify-between items-center text-sm py-2 border-b border-theme">
                    <div className="flex-1">
                      <span className="text-theme-secondary">{item.name}</span>
                      <span className="text-xs text-theme-muted ml-2">(Qty: {item.quantity})</span>
                    </div>
                    <span className="text-theme-primary font-medium">{fmtINR(lineTotal)}</span>
                  </div>
                );
              })
            )}
          </div>

          {/* Total */}
          <div className="border-t border-theme pt-4 mb-4">
            <div className="flex justify-between items-center text-lg font-semibold">
              <span className="text-theme-secondary">Total Amount:</span>
              <span className="text-theme-primary">{fmtINR(cartTotal)}</span>
            </div>
          </div>

          {/* Payment mode tabs (staff only) */}
          {!isDonor && (
            <div className="mb-3">
              <div className="inline-flex rounded-lg border border-theme overflow-hidden text-xs font-semibold">
                {(["cash", "cheque", "online", "upi"] as const).map((mode) => (
                  <button key={mode} onClick={() => setPaymentMode(mode)}
                    className={`px-3 py-1.5 border-r border-theme last:border-0 transition ${paymentMode === mode ? "bg-theme-accent text-white" : "bg-theme-page text-theme-secondary hover:bg-theme-muted"}`}>
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>

              {/* Cash options */}
              {paymentMode === "cash" && (
                <div className="mt-3">
                  <label className="block text-sm font-medium text-theme-secondary mb-1">Cashbook</label>
                  <select className="w-full px-3 py-2 text-sm border border-theme rounded-lg theme-focus outline-none bg-theme-page">
                    <option value="">Select cashbook</option>
                  </select>
                </div>
              )}

              {/* Cheque options */}
              {paymentMode === "cheque" && (
                <div className="mt-3">
                  <label className="block text-sm font-medium text-theme-secondary mb-1">Deposit to account</label>
                  <select value={chequeBankId} onChange={(e) => setChequeBankId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-theme rounded-lg theme-focus outline-none bg-theme-page">
                    <option value="">Select bank account</option>
                    {bankAccounts.map((b) => <option key={b.__backendId || b.id} value={b.__backendId || b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}

              {/* UPI options */}
              {paymentMode === "upi" && (
                <div className="mt-3">
                  <label className="block text-sm font-medium text-theme-secondary mb-1">UPI reference (optional)</label>
                  <input type="text" value={upiRef} onChange={(e) => setUpiRef(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-theme rounded-lg theme-focus outline-none bg-theme-page"
                    placeholder="e.g. UPI transaction ID or last 4 digits" />
                </div>
              )}
            </div>
          )}

          {/* Remarks */}
          <div className="mb-3">
            <label className="block text-sm font-medium text-theme-secondary mb-1">Remarks (optional)</label>
            <textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-theme rounded-lg theme-focus outline-none resize-y"
              placeholder="E.g. In memory of..., for birthday, etc." />
          </div>

          {saveError && <div className="text-sm text-red-600 bg-red-50 rounded p-2 mb-3">{saveError}</div>}

          {/* Submit buttons */}
          <div className="space-y-3">
            {isDonor ? (
              <button onClick={handleSaveBooking} disabled={saving || cart.length === 0}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>
                {saving ? "Processing..." : "Pay with Razorpay"}
              </button>
            ) : (
              <button onClick={handleSaveBooking} disabled={saving || cart.length === 0}
                className={`w-full py-3 rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition ${
                  paymentMode === "cash" ? "bg-green-600 hover:bg-green-700 text-white" :
                  paymentMode === "cheque" ? "bg-amber-600 hover:bg-amber-700 text-white" :
                  paymentMode === "upi" ? "bg-pink-600 hover:bg-pink-700 text-white" :
                  "bg-blue-600 hover:bg-blue-700 text-white"
                }`}>
                {saving ? "Saving..." :
                  paymentMode === "cash" ? "Take Cash" :
                  paymentMode === "cheque" ? "Take Cheque" :
                  paymentMode === "upi" ? "Take UPI" :
                  "Pay with Razorpay"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
