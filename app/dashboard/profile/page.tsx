"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { useAllData, byType } from "@/lib/use-all-data";
import { callApi } from "@/lib/client";

interface DonorRecord {
  __backendId: string; name: string; spiritualName: string; indianPassport: boolean;
  mobile: string; whatsapp: string; email: string; pan: string;
  flat: string; road: string; po: string; area: string;
  pincode: string; district: string; state: string; country: string;
}

export default function MyProfilePage() {
  const { user, session } = useAuth();
  const { data, reload } = useAllData();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [pincodeStatus, setPincodeStatus] = useState("");
  const [form, setForm] = useState({
    name: "", spiritualName: "", indianPassport: false,
    mobile: "", whatsapp: "", email: "", pan: "",
    flat: "", road: "", po: "", area: "",
    pincode: "", district: "", state: "", country: "India",
  });

  // Find the current donor's record
  const donorRecord = byType<DonorRecord>(data, "donor").find(
    (d) => d.__backendId === user?.donorId || d.__backendId === user?.backendId
  );

  // Populate form from donor record
  useEffect(() => {
    if (donorRecord) {
      setForm({
        name: donorRecord.name || "",
        spiritualName: donorRecord.spiritualName || "",
        indianPassport: donorRecord.indianPassport === true,
        mobile: donorRecord.mobile || "",
        whatsapp: donorRecord.whatsapp || "",
        email: donorRecord.email || "",
        pan: donorRecord.pan || "",
        flat: donorRecord.flat || "",
        road: donorRecord.road || "",
        po: donorRecord.po || "",
        area: donorRecord.area || "",
        pincode: donorRecord.pincode || "",
        district: donorRecord.district || "",
        state: donorRecord.state || "",
        country: donorRecord.country || "India",
      });
    }
  }, [donorRecord]);

  // Pincode lookup
  const lookupPincode = useCallback(async (pin: string) => {
    if (pin.length !== 6) {
      setPincodeStatus("");
      return;
    }
    setPincodeStatus("Looking up...");
    try {
      const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
      const json = await res.json();
      if (json?.[0]?.Status === "Success" && json[0].PostOffice?.length > 0) {
        const po = json[0].PostOffice[0];
        setForm((f) => ({ ...f, district: po.District || f.district, state: po.State || f.state, country: po.Country || "India" }));
        setPincodeStatus(`${po.District}, ${po.State}`);
      } else {
        setPincodeStatus("Pincode not found");
      }
    } catch {
      setPincodeStatus("Lookup failed");
    }
  }, []);

  function handlePincodeChange(pin: string) {
    setForm({ ...form, pincode: pin });
    if (pin.length === 6) lookupPincode(pin);
    else setPincodeStatus("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!donorRecord) return;
    setSaving(true);
    setStatus("");
    const result = await callApi("update", {
      sessionId: session?.sessionId,
      record: {
        type: "donor",
        __backendId: donorRecord.__backendId,
        name: form.name,
        spiritualName: form.spiritualName,
        indianPassport: form.indianPassport,
        mobile: form.mobile,
        whatsapp: form.whatsapp || form.mobile,
        email: form.email,
        flat: form.flat,
        road: form.road,
        po: form.po,
        area: form.area,
        pincode: form.pincode,
        district: form.district,
        state: form.state,
        country: form.country,
      },
    });
    setSaving(false);
    if (result.isOk) {
      setStatus("Profile saved successfully!");
      reload();
    } else {
      setStatus((result as { error?: string }).error || "Save failed");
    }
  }

  if (!user?.isDonor) {
    return (
      <div className="text-center py-12 text-theme-muted">
        This page is for donor accounts only.
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-xl card-shadow p-6">
        <h3 className="font-display text-xl font-semibold text-theme-primary mb-6">My Profile</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Personal Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-theme-secondary mb-1">Legal Name *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-secondary mb-1">Spiritual Name</label>
              <input type="text" value={form.spiritualName} onChange={(e) => setForm({ ...form, spiritualName: e.target.value })}
                className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" checked={form.indianPassport} onChange={(e) => setForm({ ...form, indianPassport: e.target.checked })}
              className="w-4 h-4" id="mp-indian-passport" />
            <label htmlFor="mp-indian-passport" className="text-sm text-theme-secondary">Indian Passport Holder</label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-theme-secondary mb-1">Mobile Number *</label>
              <input type="tel" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-secondary mb-1">WhatsApp Number</label>
              <input type="tel" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" placeholder="Same as mobile if blank" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-theme-secondary mb-1">Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-secondary mb-1">PAN Number</label>
              <input type="text" value={form.pan} readOnly
                className="w-full px-3 py-2 border border-theme rounded-lg text-sm bg-theme-page text-theme-muted uppercase" />
            </div>
          </div>

          {/* Address Section */}
          <div className="border-t border-theme pt-4 mt-4">
            <h4 className="font-display text-sm font-semibold text-theme-primary mb-3">Address Details</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-theme-secondary mb-1">Flat / Door / Building</label>
                <input type="text" value={form.flat} onChange={(e) => setForm({ ...form, flat: e.target.value })}
                  className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-secondary mb-1">Road / Street</label>
                <input type="text" value={form.road} onChange={(e) => setForm({ ...form, road: e.target.value })}
                  className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-secondary mb-1">Post Office</label>
                <input type="text" value={form.po} onChange={(e) => setForm({ ...form, po: e.target.value })}
                  className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-secondary mb-1">Area / Locality</label>
                <input type="text" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}
                  className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-secondary mb-1">Pincode</label>
                <input type="text" value={form.pincode} onChange={(e) => handlePincodeChange(e.target.value)}
                  className="w-full px-3 py-2 border border-theme rounded-lg theme-focus text-sm" maxLength={6} />
                {pincodeStatus && <p className="text-xs text-theme-muted mt-1">{pincodeStatus}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-secondary mb-1">District</label>
                <input type="text" value={form.district} readOnly
                  className="w-full px-3 py-2 border border-theme rounded-lg text-sm bg-theme-page text-theme-muted" />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-secondary mb-1">State</label>
                <input type="text" value={form.state} readOnly
                  className="w-full px-3 py-2 border border-theme rounded-lg text-sm bg-theme-page text-theme-muted" />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-secondary mb-1">Country</label>
                <input type="text" value={form.country} readOnly
                  className="w-full px-3 py-2 border border-theme rounded-lg text-sm bg-theme-page text-theme-muted" />
              </div>
            </div>
          </div>

          {/* Save */}
          <div className="flex items-center gap-4 pt-2">
            <button type="submit" disabled={saving} className="btn-primary px-6 py-2 rounded-lg text-sm font-medium">
              {saving ? "Saving..." : "Save Changes"}
            </button>
            {status && (
              <span className={`text-sm ${status.includes("success") ? "text-green-600" : "text-red-600"}`}>
                {status}
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
