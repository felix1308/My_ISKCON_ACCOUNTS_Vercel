"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { callApi } from "@/lib/client";

const ISKCON_LOGO = "/iskcon-logo.png";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Forgot password state
  const [showForgot, setShowForgot] = useState(false);
  const [fpIdentifier, setFpIdentifier] = useState("");
  const [fpNewPassword, setFpNewPassword] = useState("");
  const [fpConfirmPassword, setFpConfirmPassword] = useState("");
  const [fpMessage, setFpMessage] = useState("");
  const [fpLoading, setFpLoading] = useState(false);

  // Signup state
  const [showSignup, setShowSignup] = useState(false);
  const [signupForm, setSignupForm] = useState({ name: "", mobile: "", pan: "", email: "" });
  const [signupMessage, setSignupMessage] = useState("");
  const [signupLoading, setSignupLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username.trim(), password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setFpMessage("");
    if (fpNewPassword !== fpConfirmPassword) {
      setFpMessage("Passwords do not match");
      return;
    }
    if (fpNewPassword.length < 6) {
      setFpMessage("Password must be at least 6 characters");
      return;
    }
    setFpLoading(true);
    try {
      const result = await callApi("resetDonorPassword", {
        identifier: fpIdentifier.trim(),
        newPassword: fpNewPassword,
      });
      if (result.isOk) {
        setFpMessage("Password reset successfully! You can now log in.");
        setFpIdentifier("");
        setFpNewPassword("");
        setFpConfirmPassword("");
      } else {
        setFpMessage((result as { error?: string }).error || "Reset failed");
      }
    } catch {
      setFpMessage("Network error. Please try again.");
    }
    setFpLoading(false);
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setSignupMessage("");
    setSignupLoading(true);
    try {
      const result = await callApi("selfRegister", {
        record: {
          name: signupForm.name.trim(),
          mobile: signupForm.mobile.trim(),
          pan: signupForm.pan.trim().toUpperCase(),
          email: signupForm.email.trim(),
          spiritualName: "",
          indianPassport: true,
          whatsapp: signupForm.mobile.trim(),
          flat: "", road: "", po: "", area: "",
          pincode: "", district: "", state: "", country: "India",
        },
      });
      if (result.isOk) {
        setSignupMessage("Registration submitted! Your default password is your mobile number. An admin will approve your account.");
        setSignupForm({ name: "", mobile: "", pan: "", email: "" });
      } else {
        setSignupMessage((result as { error?: string }).error || "Signup failed");
      }
    } catch {
      setSignupMessage("Network error. Please try again.");
    }
    setSignupLoading(false);
  }

  return (
    <div className="min-h-screen flex flex-col p-4 bg-theme-page">
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-md">
          {/* Logo & Title */}
          <div className="text-center mb-8">
            <div className="w-28 h-28 mx-auto mb-4 flex items-center justify-center">
              <img
                src={ISKCON_LOGO}
                alt="ISKCON South Bengaluru Logo"
                style={{ maxWidth: "100%", height: "auto", objectFit: "contain" }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
            <h1 className="font-display text-3xl font-bold text-theme-primary">My ISKCON Accounts</h1>
            <p className="text-theme-secondary mt-2">Account Management System</p>
          </div>

          {/* Login Card */}
          {!showForgot && !showSignup && (
            <div className="bg-white rounded-2xl card-shadow p-8">
              <h2 className="font-display text-2xl font-semibold text-theme-primary mb-6 text-center">Login</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-theme-secondary mb-1">Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-4 py-3 border border-theme rounded-lg theme-focus outline-none transition"
                    placeholder="Enter username"
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-secondary mb-1">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 border border-theme rounded-lg theme-focus outline-none transition"
                    placeholder="Enter password"
                    required
                  />
                </div>
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2.5">
                    {error}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full font-semibold py-3 rounded-lg transition"
                >
                  {loading ? "Signing in..." : "Sign In"}
                </button>
                <div className="flex justify-between items-center pt-2">
                  <button
                    type="button"
                    onClick={() => { setShowForgot(true); setFpMessage(""); }}
                    className="text-sm text-theme-secondary hover:text-theme-primary underline"
                  >
                    Forgot password?
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowSignup(true); setSignupMessage(""); }}
                    className="text-sm text-theme-secondary hover:text-theme-primary underline"
                  >
                    New here? Sign up
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Forgot Password Card */}
          {showForgot && (
            <div className="bg-white rounded-2xl card-shadow p-8">
              <h2 className="font-display text-xl font-semibold text-theme-primary mb-2 text-center">Reset Password</h2>
              <p className="text-sm text-theme-muted text-center mb-5">
                Enter your registered PAN number or mobile number to reset your donor account password.
              </p>
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-theme-secondary mb-1">PAN Number or Mobile Number</label>
                  <input
                    type="text"
                    value={fpIdentifier}
                    onChange={(e) => setFpIdentifier(e.target.value)}
                    className="w-full px-4 py-3 border border-theme rounded-lg theme-focus outline-none transition"
                    placeholder="e.g. ABCDE1234F or 9876543210"
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-secondary mb-1">New Password</label>
                  <input
                    type="password"
                    value={fpNewPassword}
                    onChange={(e) => setFpNewPassword(e.target.value)}
                    className="w-full px-4 py-3 border border-theme rounded-lg theme-focus outline-none transition"
                    placeholder="At least 6 characters"
                    required
                    minLength={6}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-secondary mb-1">Confirm New Password</label>
                  <input
                    type="password"
                    value={fpConfirmPassword}
                    onChange={(e) => setFpConfirmPassword(e.target.value)}
                    className="w-full px-4 py-3 border border-theme rounded-lg theme-focus outline-none transition"
                    placeholder="Repeat new password"
                    required
                    minLength={6}
                  />
                </div>
                {fpMessage && (
                  <div className={`text-sm rounded-lg px-4 py-2.5 ${
                    fpMessage.includes("successfully")
                      ? "bg-green-50 border border-green-200 text-green-700"
                      : "bg-red-50 border border-red-200 text-red-700"
                  }`}>
                    {fpMessage}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={fpLoading}
                  className="btn-primary w-full font-semibold py-3 rounded-lg transition"
                >
                  {fpLoading ? "Resetting..." : "Reset Password"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForgot(false)}
                  className="block w-full text-center text-sm text-theme-secondary hover:text-theme-primary underline"
                >
                  Back to Login
                </button>
              </form>
            </div>
          )}

          {/* Signup Card */}
          {showSignup && (
            <div className="bg-white rounded-2xl card-shadow p-8">
              <h2 className="font-display text-xl font-semibold text-theme-primary mb-1 text-center">Create Your Account</h2>
              <p className="text-sm text-theme-muted text-center mb-4">
                Register as a devotee to manage your sevas and donations. Your default password will be your mobile number.
              </p>
              <form onSubmit={handleSignup} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-theme-secondary mb-1">Full Name</label>
                  <input
                    type="text"
                    value={signupForm.name}
                    onChange={(e) => setSignupForm({ ...signupForm, name: e.target.value })}
                    className="w-full px-4 py-3 border border-theme rounded-lg theme-focus outline-none transition"
                    placeholder="Your legal name"
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-secondary mb-1">Mobile Number</label>
                  <input
                    type="tel"
                    value={signupForm.mobile}
                    onChange={(e) => setSignupForm({ ...signupForm, mobile: e.target.value })}
                    className="w-full px-4 py-3 border border-theme rounded-lg theme-focus outline-none transition"
                    placeholder="10-digit mobile number"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-secondary mb-1">PAN Number</label>
                  <input
                    type="text"
                    value={signupForm.pan}
                    onChange={(e) => setSignupForm({ ...signupForm, pan: e.target.value })}
                    className="w-full px-4 py-3 border border-theme rounded-lg theme-focus outline-none transition"
                    placeholder="ABCDE1234F"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-secondary mb-1">Email</label>
                  <input
                    type="email"
                    value={signupForm.email}
                    onChange={(e) => setSignupForm({ ...signupForm, email: e.target.value })}
                    className="w-full px-4 py-3 border border-theme rounded-lg theme-focus outline-none transition"
                    placeholder="your@email.com"
                  />
                </div>
                {signupMessage && (
                  <div className={`text-sm rounded-lg px-4 py-2.5 ${
                    signupMessage.includes("submitted") || signupMessage.includes("Registration")
                      ? "bg-green-50 border border-green-200 text-green-700"
                      : "bg-red-50 border border-red-200 text-red-700"
                  }`}>
                    {signupMessage}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={signupLoading}
                  className="btn-primary w-full font-semibold py-3 rounded-lg transition"
                >
                  {signupLoading ? "Registering..." : "Register"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowSignup(false)}
                  className="block w-full text-center text-sm text-theme-secondary hover:text-theme-primary underline"
                >
                  Back to Login
                </button>
              </form>
            </div>
          )}

          {/* Footer */}
          <footer className="mt-8 text-center">
            <p className="font-medium text-sm text-theme-secondary">
              Contact:{" "}
              <a href="mailto:iccabhilekhah@gmail.com" className="text-theme-secondary hover:text-theme-primary underline">iccabhilekhah@gmail.com</a>
              {"  |  "}
              Phone:{" "}
              <a href="tel:+918073222508" className="text-theme-secondary hover:text-theme-primary underline">+91-8073222508</a>
            </p>
            <p className="mt-1 text-theme-secondary text-sm">
              Address: No.1, Samvruddhi Enclave, 3rd Main, Bangalore-560111, India
            </p>
            <p className="mt-3 text-theme-muted text-xs">
              &copy; {new Date().getFullYear()} ISKCON Cultural Centre. All rights reserved.
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}
