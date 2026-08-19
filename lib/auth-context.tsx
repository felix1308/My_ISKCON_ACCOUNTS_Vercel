"use client";

import {
  createContext, useContext, useState, useEffect, useCallback, type ReactNode,
} from "react";
import {
  getStoredSession, setStoredSession, clearStoredSession, callApi,
} from "@/lib/client";
import type { ClientSession, Permissions, Role } from "@/lib/types";

interface AuthUser {
  backendId: string;
  username: string;
  role: Role;
  centerId: string;
  templeId?: string;
  departmentId?: string;
  donorId?: string;
  permissions: Permissions;
  cashbooks: string[] | "*";
  isDonor: boolean;
  superadminDetained?: boolean;
}

interface AuthContextValue {
  session: ClientSession | null;
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  hasPermission: (perm: keyof Permissions) => boolean;
  isSuperuser: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function parseUserFromLoginResult(result: Record<string, unknown>): {
  session: ClientSession;
  user: AuthUser;
} | null {
  const userRaw = result.user as Record<string, unknown> | undefined;
  if (!userRaw || !result.sessionId) return null;

  const permsRaw = userRaw.permissions;
  let permissions: Permissions = {};
  if (permsRaw && typeof permsRaw === "object") {
    permissions = permsRaw as Permissions;
  } else if (typeof permsRaw === "string") {
    try { permissions = JSON.parse(permsRaw); } catch { /* */ }
  }

  const cashbooksRaw = userRaw.cashbooks;
  let cashbooks: string[] | "*" = [];
  if (cashbooksRaw === "*") cashbooks = "*";
  else if (Array.isArray(cashbooksRaw)) cashbooks = cashbooksRaw as string[];
  else if (typeof cashbooksRaw === "string") {
    if (cashbooksRaw.trim() === "*") cashbooks = "*";
    else try { const o = JSON.parse(cashbooksRaw); if (Array.isArray(o)) cashbooks = o; } catch { /* */ }
  }

  const role = (userRaw.role as Role) ?? "volunteer";
  const session: ClientSession = {
    sessionId: result.sessionId as string,
    userId: (userRaw.donorId as string) ?? (userRaw.__backendId as string) ?? "",
    username: userRaw.username as string,
    role,
    centerId: userRaw.centerId as string,
    isDonor: userRaw.type === "donor_user",
    permissions,
    expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
  };

  const user: AuthUser = {
    backendId: userRaw.__backendId as string,
    username: userRaw.username as string,
    role,
    centerId: userRaw.centerId as string,
    templeId: userRaw.templeId as string | undefined,
    departmentId: userRaw.departmentId as string | undefined,
    donorId: userRaw.donorId as string | undefined,
    permissions,
    cashbooks,
    isDonor: userRaw.type === "donor_user",
    superadminDetained: userRaw.superadminDetained as boolean | undefined,
  };

  return { session, user };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ClientSession | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const stored = getStoredSession();
    if (!stored) {
      setSession(null);
      setUser(null);
      setLoading(false);
      return;
    }
    const result = await callApi("validateSession", { sessionId: stored.sessionId });
    if (result.isOk && (result as Record<string, unknown>).user) {
      const u = (result as Record<string, unknown>).user as Record<string, unknown>;
      const sessionEcho = u.session as ClientSession | undefined;
      if (sessionEcho) {
        setSession(sessionEcho);
        setStoredSession(sessionEcho);
      } else {
        setSession(stored);
      }
      const permsRaw = u.permissions;
      let permissions: Permissions = {};
      if (permsRaw && typeof permsRaw === "object") permissions = permsRaw as Permissions;
      else if (typeof permsRaw === "string") try { permissions = JSON.parse(permsRaw); } catch { /* */ }
      setUser({
        backendId: u.__backendId as string,
        username: u.username as string,
        role: u.role as Role,
        centerId: u.centerId as string,
        templeId: u.templeId as string | undefined,
        departmentId: u.departmentId as string | undefined,
        donorId: u.donorId as string | undefined,
        permissions,
        cashbooks: u.cashbooks === "*" ? "*" : Array.isArray(u.cashbooks) ? u.cashbooks as string[] : [],
        isDonor: u.type === "donor_user",
        superadminDetained: u.superadminDetained as boolean | undefined,
      });
    } else {
      clearStoredSession();
      setSession(null);
      setUser(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const result = await callApi("login", { username, password });
    if (!result.isOk) {
      throw new Error((result as { error?: string }).error || "Login failed");
    }
    const parsed = parseUserFromLoginResult(result as Record<string, unknown>);
    if (!parsed) throw new Error("Invalid login response");
    setSession(parsed.session);
    setStoredSession(parsed.session);
    setUser(parsed.user);
  }, []);

  const logout = useCallback(async () => {
    if (session) {
      await callApi("logout", { sessionId: session.sessionId });
    }
    clearStoredSession();
    setSession(null);
    setUser(null);
  }, [session]);

  const hasPermission = useCallback(
    (perm: keyof Permissions) => {
      if (!user) return false;
      if (user.role === "developer" || user.role === "superadmin") return true;
      return user.permissions?.[perm] === true;
    },
    [user]
  );

  const isSuperuser = user?.role === "developer" || user?.role === "superadmin";

  return (
    <AuthContext.Provider
      value={{ session, user, loading, login, logout, refresh, hasPermission, isSuperuser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
