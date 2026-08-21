"use client";

export default function ImportantNoticePage() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="bg-white rounded-xl card-shadow p-6">
        <h3 className="font-display text-2xl font-semibold text-theme-primary flex items-center gap-2">
          📋 Important Notice
        </h3>
        <p className="text-theme-secondary mt-1">
          Terms &amp; Conditions — Donation Receipt &amp; 80G Certificate
        </p>
      </div>

      {/* Terms & Conditions */}
      <div className="bg-white rounded-xl card-shadow p-6">
        <h4 className="font-display text-lg font-semibold text-theme-primary mb-4">Terms &amp; Conditions</h4>
        <ul className="space-y-3 text-sm text-theme-secondary">
          <li className="flex gap-2">
            <span className="text-theme-accent font-bold">•</span>
            <span>The donation receipt is only an acknowledgment of the contribution and <strong>cannot be used for 80G tax exemption claims</strong>.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-theme-accent font-bold">•</span>
            <span>For claiming 80G deductions, <strong>Form 10BE</strong> will be issued by the Income Tax Department based on data uploaded by ISKCON.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-theme-accent font-bold">•</span>
            <span>Form 10BE for each financial year will be available by <strong>31st May of the next financial year</strong> on the IT portal.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-theme-accent font-bold">•</span>
            <span><strong>PAN is compulsory</strong> for generating Form 10BE. Without a valid PAN, 80G benefits cannot be claimed.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-theme-accent font-bold">•</span>
            <span>Form 10BE <strong>will not be issued for cash donations</strong>. Only non-cash payments (cheque, online, UPI) qualify.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-theme-accent font-bold">•</span>
            <span>ISKCON&apos;s 80G registration: <strong>URN AAATI0017PF20219</strong>, valid till <strong>March 31, 2026</strong>.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-theme-accent font-bold">•</span>
            <span>If you find any errors in your donation records, please contact the centre immediately for corrections.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-theme-accent font-bold">•</span>
            <span>All donation data is subject to verification. ISKCON reserves the right to correct or update records before uploading to the IT portal.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-theme-accent font-bold">•</span>
            <span>Donors are advised to <strong>verify their PAN details and address</strong> in the profile section to ensure accurate 80G filing.</span>
          </li>
        </ul>
      </div>

      {/* Gratitude */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl card-shadow p-6 text-center">
        <p className="font-display text-lg font-semibold text-amber-800">Thank you for your generous support!</p>
        <p className="text-amber-700 mt-2 italic">
          Hare Krishna Hare Krishna, Krishna Krishna Hare Hare<br />
          Hare Rama Hare Rama, Rama Rama Hare Hare
        </p>
        <p className="text-amber-600 text-sm mt-2">Chant and be happy.</p>
      </div>

      {/* Login & Contact */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl card-shadow p-6">
        <h4 className="font-display text-lg font-semibold text-blue-800 mb-3">Login &amp; Contact Information</h4>
        <div className="text-sm text-blue-700 space-y-2">
          <p>To view your donation history, use your <strong>Login ID</strong> (or PAN number) and password to log in.</p>
          <p>📧 Email: <a href="mailto:iccabhilekhah@gmail.com" className="underline hover:text-blue-900">iccabhilekhah@gmail.com</a></p>
          <p>📱 WhatsApp: <a href="tel:+918073222508" className="underline hover:text-blue-900">+91 80732 22508</a></p>
        </div>
      </div>

      {/* 80G Eligibility */}
      <div className="bg-green-50 border border-green-200 rounded-xl card-shadow p-6">
        <h4 className="font-display text-lg font-semibold text-green-800 mb-3">80G Eligibility Criteria</h4>
        <ol className="text-sm text-green-700 space-y-2 list-none">
          <li><strong>A.</strong> The following details are mandatory for 80G: Full Name, Complete Address with PIN code, Contact Number, and PAN Number.</li>
          <li><strong>B.</strong> Donation must be through non-cash mode only (cheque, online transfer, UPI, etc.).</li>
        </ol>
      </div>

      {/* Disclaimer */}
      <div className="bg-red-50 border border-red-200 rounded-xl card-shadow p-6">
        <h4 className="font-display text-lg font-semibold text-red-800 mb-2">Disclaimer</h4>
        <p className="text-sm text-red-700">
          If you notice any duplicate or incorrect entries in your donation history, please note that these are due to technical issues during data migration. Such entries will be reviewed and corrected before any data is uploaded to the IT portal.
        </p>
      </div>
    </div>
  );
}
