"use client";

import { useState, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import type { Permissions, Role } from "@/lib/types";

const ISKCON_LOGO = "https://iskconsouthbengaluru.com/wp-content/uploads/sites/7/2022/03/cropped-ISB-vertical-logo-Red-2.png";

interface NavItem {
  label: string;
  href: string;
  emoji?: string;
  perm?: keyof Permissions;
  roles?: Role[];
  adminOnly?: boolean;
  superadminOnly?: boolean;
  donorOnly?: boolean;
}

// Navigation items matching the original myiskcon.html sidebar order
const NAV_ITEMS: NavItem[] = [
  // --- Visible to all ---
  { label: "Dashboard", href: "/dashboard" },
  { label: "Seva", href: "/dashboard/bookings", perm: "booking" },
  { label: "Reports", href: "/dashboard/reports", perm: "reports" },
  { label: "Important Notice", href: "/dashboard/notice", emoji: "📋" },
  // --- Donor only ---
  { label: "My Profile", href: "/dashboard/profile", donorOnly: true },
  // --- All (events) ---
  { label: "Bookings", href: "/dashboard/events", emoji: "🎟️" },
  // --- Admin only ---
  { label: "Sadhana", href: "/dashboard/sadhana", adminOnly: true },
  { label: "Asset Management", href: "/dashboard/assets", adminOnly: true },
  { label: "Ashram Management", href: "/dashboard/ashram", adminOnly: true },
  { label: "Donors", href: "/dashboard/donors", adminOnly: true, perm: "manage_donors" },
  { label: "Manage Sevas", href: "/dashboard/sevas", adminOnly: true, perm: "manage_sevas" },
  // --- Superadmin only ---
  { label: "Dept Heads", href: "/dashboard/dept-heads", superadminOnly: true, emoji: "👥" },
  { label: "Account Manager", href: "/dashboard/users", adminOnly: true, perm: "manage_users" },
  { label: "Manage Access", href: "/dashboard/permissions", superadminOnly: true, emoji: "🔐" },
  { label: "Donor Logins", href: "/dashboard/donor-logins", superadminOnly: true, emoji: "🔑" },
  { label: "Bank Accounts", href: "/dashboard/bank-accounts", superadminOnly: true, emoji: "🏦" },
  { label: "Payment Gateways", href: "/dashboard/payment-gateways", superadminOnly: true, emoji: "💳" },
  { label: "Centers", href: "/dashboard/centers", superadminOnly: true, emoji: "🏛️" },
  { label: "Temples", href: "/dashboard/temples", superadminOnly: true, emoji: "🏯" },
  { label: "Departments", href: "/dashboard/departments", superadminOnly: true, emoji: "🏢" },
  { label: "Validate QR", href: "/dashboard/validate-qr", perm: "validate_qr", emoji: "📱" },
];

/** Scanner roles are QR-only (legacy behavior). */
const SCANNER_ROLES = ["EntryScanner", "SevaScanner", "PrasadamScanner"];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, loading, logout, hasPermission, isSuperuser, session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-theme-page">
        <img
          src={ISKCON_LOGO}
          alt="ISKCON"
          className="loading-logo"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <p className="mt-5 text-sm text-theme-muted">Loading…</p>
      </div>
    );
  }

  if (!user || !session) {
    router.replace("/login");
    return null;
  }

  // Filter nav items based on role and permissions
  const visibleNav = NAV_ITEMS.filter((item) => {
    // Donor-only items
    if (item.donorOnly && !user.isDonor) return false;
    if (item.donorOnly) return true;

    // Non-donor items: hide from donors (except dashboard, seva, reports, notice, events)
    if (user.isDonor) {
      const donorAllowed = ["/dashboard", "/dashboard/bookings", "/dashboard/reports", "/dashboard/notice", "/dashboard/events", "/dashboard/profile"];
      return donorAllowed.includes(item.href);
    }

    // Scanner roles (Entry/Seva/Prasadam) get only QR validation
    if (SCANNER_ROLES.includes(user.role)) return item.href === "/dashboard/validate-qr";

    if (item.superadminOnly && !isSuperuser) return false;
    if (item.adminOnly && user.role === "volunteer" && !isSuperuser) {
      // Volunteers need specific permission
      if (item.perm && !hasPermission(item.perm)) return false;
      if (!item.perm) return false;
    }
    if (item.perm && !hasPermission(item.perm) && !isSuperuser) return false;
    return true;
  });

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  const roleDisplay = user.isDonor
    ? "Devotee"
    : user.role.charAt(0).toUpperCase() + user.role.slice(1);

  return (
    <div className="min-h-screen flex flex-col bg-theme-page">
      {/* Header */}
      <header className="bg-white border-b border-theme px-4 py-3 flex-shrink-0">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              title="Toggle sidebar"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-1.5 rounded-lg text-theme-secondary hover:bg-theme-page hover:text-theme-primary transition"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="w-12 h-12 flex items-center justify-center flex-shrink-0">
              <img
                src={ISKCON_LOGO}
                alt="ISKCON South Bengaluru Logo"
                style={{ maxWidth: "100%", height: "auto", objectFit: "contain" }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-theme-primary">My ISKCON Accounts</h1>
              <p className="text-xs text-theme-muted">{user.username} &middot; {roleDisplay}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-theme-secondary hover:text-theme-primary transition"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* Sidebar + Content */}
      <div className="flex flex-1 min-h-0">
        <nav
          className={`sidebar-nav flex-shrink-0 bg-white border-r border-theme overflow-y-auto py-2 flex flex-col transition-all duration-200 ${
            sidebarCollapsed ? "w-0 opacity-0 overflow-hidden border-none" : "w-52 opacity-100"
          }`}
        >
          {visibleNav.map((item) => {
            const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
            const label = item.emoji ? `${item.emoji} ${item.label}` : item.label;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`tab-btn text-theme-secondary font-medium hover:bg-theme-page transition ${
                  active ? "tab-active" : ""
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        <main className="flex-1 min-w-0 p-4 overflow-auto">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
