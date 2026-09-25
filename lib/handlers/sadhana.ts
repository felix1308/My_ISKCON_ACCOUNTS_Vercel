// ============================================================================
// Sadhana handlers — daily spiritual practice tracking (5 avenues: wake/sleep
// times, chanting rounds, hearing, reading, service).
//
// STRICTLY PRIVATE: every read/write is scoped to the logged-in principal.
// There is intentionally no role check beyond authentication — admins and
// superadmins do NOT get to see other devotees' sadhana.
// ============================================================================

import { sql, sqlTyped } from "../db";
import { resolvePrincipal } from "../context";
import type { ApiResult } from "../types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

function ownerOf(p: { type: string; backendId: string; donorId?: string }) {
  return p.type === "donor_user"
    ? { id: p.donorId ?? "", type: "donor" }
    : { id: p.backendId, type: "user" };
}

const clampInt = (v: unknown, max: number): number => {
  const n = Math.round(Number(v ?? 0));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
};
const str = (v: unknown, max = 500): string => String(v ?? "").trim().slice(0, max);

// ---------------------------------------------------------------------------
// SAVE (upsert own entry for a date)
// ---------------------------------------------------------------------------

export async function saveSadhanaEntry(params: {
  sessionId?: string;
  entry?: Record<string, unknown>;
}, req: Request): Promise<ApiResult> {
  void req;
  const principal = await resolvePrincipal(params.sessionId);
  const owner = ownerOf(principal);
  if (!owner.id) return { isOk: false, error: "No profile linked to this account" };

  const e = params.entry ?? {};
  const entryDate = str(e.entryDate, 10);
  if (!DATE_RE.test(entryDate)) return { isOk: false, error: "Valid entryDate (YYYY-MM-DD) is required" };

  const wakeUpAt = str(e.wakeUpAt, 5);
  const sleepAt = str(e.sleepAt, 5);
  if (wakeUpAt && !TIME_RE.test(wakeUpAt)) return { isOk: false, error: "Wake-up time must be HH:MM" };
  if (sleepAt && !TIME_RE.test(sleepAt)) return { isOk: false, error: "Sleep time must be HH:MM" };

  const id = `sad_${owner.id}_${entryDate}`;

  // Chanting sittings: [{time:"05:30", rounds:4}, ...]. When present, the
  // daily total is the sum of sittings; otherwise the plain total is used.
  const sessionsIn = Array.isArray(e.chantingSessions) ? e.chantingSessions : [];
  const sessions = sessionsIn.slice(0, 24).map((s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    const time = str(o.time, 5);
    return { time: TIME_RE.test(time) ? time : "", rounds: clampInt(o.rounds, 500) };
  }).filter((s) => s.rounds > 0);
  const chantingRounds = sessions.length > 0
    ? sessions.reduce((sum, s) => sum + s.rounds, 0)
    : clampInt(e.chantingRounds, 500);

  const vals = {
    wakeUpAt,
    sleepAt,
    chantingRounds,
    chantingSessions: JSON.stringify(sessions),
    hearingMinutes: clampInt(e.hearingMinutes, 1440),
    readingMinutes: clampInt(e.readingMinutes, 1440),
    readingBook: str(e.readingBook, 200),
    serviceMinutes: clampInt(e.serviceMinutes, 1440),
    serviceNote: str(e.serviceNote, 200),
    notes: str(e.notes, 1000),
  };

  await sql`
    INSERT INTO sadhana_entries
      (id, principal_id, principal_type, entry_date, wake_up_at, sleep_at,
       chanting_rounds, chanting_sessions, hearing_minutes, reading_minutes, reading_book,
       service_minutes, service_note, notes)
    VALUES
      (${id}, ${owner.id}, ${owner.type}, ${entryDate}, ${vals.wakeUpAt}, ${vals.sleepAt},
       ${vals.chantingRounds}, ${vals.chantingSessions}::jsonb, ${vals.hearingMinutes}, ${vals.readingMinutes}, ${vals.readingBook},
       ${vals.serviceMinutes}, ${vals.serviceNote}, ${vals.notes})
    ON CONFLICT (principal_id, principal_type, entry_date) DO UPDATE SET
      wake_up_at = EXCLUDED.wake_up_at,
      sleep_at = EXCLUDED.sleep_at,
      chanting_rounds = EXCLUDED.chanting_rounds,
      chanting_sessions = EXCLUDED.chanting_sessions,
      hearing_minutes = EXCLUDED.hearing_minutes,
      reading_minutes = EXCLUDED.reading_minutes,
      reading_book = EXCLUDED.reading_book,
      service_minutes = EXCLUDED.service_minutes,
      service_note = EXCLUDED.service_note,
      notes = EXCLUDED.notes,
      updated_at = now()
  `;
  return { isOk: true, id };
}

// ---------------------------------------------------------------------------
// GET OWN ENTRIES (optional date range; newest first; capped)
// ---------------------------------------------------------------------------

export async function getSadhanaEntries(params: {
  sessionId?: string;
  from?: string;
  to?: string;
}, req: Request): Promise<ApiResult> {
  void req;
  const principal = await resolvePrincipal(params.sessionId);
  const owner = ownerOf(principal);
  if (!owner.id) return { isOk: false, error: "No profile linked to this account" };

  const from = str(params.from, 10);
  const to = str(params.to, 10);

  const rows = await sqlTyped<Record<string, unknown>>`
    SELECT entry_date, wake_up_at, sleep_at, chanting_rounds, chanting_sessions, hearing_minutes,
           reading_minutes, reading_book, service_minutes, service_note, notes,
           created_at, updated_at
    FROM sadhana_entries
    WHERE principal_id = ${owner.id} AND principal_type = ${owner.type}
      AND (${from === ""} OR entry_date >= ${from})
      AND (${to === ""} OR entry_date <= ${to})
    ORDER BY entry_date DESC
    LIMIT 400
  `;

  const entries = rows.map((r) => ({
    entryDate: r.entry_date,
    wakeUpAt: r.wake_up_at,
    sleepAt: r.sleep_at,
    chantingRounds: r.chanting_rounds,
    chantingSessions: Array.isArray(r.chanting_sessions) ? r.chanting_sessions : [],
    hearingMinutes: r.hearing_minutes,
    readingMinutes: r.reading_minutes,
    readingBook: r.reading_book,
    serviceMinutes: r.service_minutes,
    serviceNote: r.service_note,
    notes: r.notes,
    updatedAt: r.updated_at,
  }));

  return { isOk: true, entries };
}
