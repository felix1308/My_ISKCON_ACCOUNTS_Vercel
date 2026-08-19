// Vercel Cron: hourly session cleanup. Authorized via CRON_SECRET bearer token.

import { NextResponse } from "next/server";
import { cleanupExpiredSessions } from "@/lib/sessions";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const env = getEnv();
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!env.CRON_SECRET || token !== env.CRON_SECRET) {
    return NextResponse.json({ isOk: false, error: "Unauthorized" }, { status: 401 });
  }
  const removed = await cleanupExpiredSessions();
  return NextResponse.json({ isOk: true, removed });
}
