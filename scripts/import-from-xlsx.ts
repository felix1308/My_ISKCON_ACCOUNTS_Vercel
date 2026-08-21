// ============================================================================
// import-from-xlsx — import reference data missing from the DB using the
// MyISKCONAccounts.xlsx snapshot of the legacy Google Sheets database.
//
// Prerequisites:
//   python3 scripts/extract_xlsx.py     (writes /tmp/xlsx_refdata.json)
//
// Run with:
//   node --env-file=.env.local node_modules/.bin/tsx scripts/import-from-xlsx.ts
//
// Import order: centers -> temples (+center.temple_id backfill) -> departments
// -> department_heads -> payment_gateways (legacy-XOR verified) -> bank_accounts
// -> users (legacy_sha256) -> donors (dedupe by normalized mobile, PAN/email
// encrypted) -> qr_scans.
//
// ALL steps are idempotent: rows whose id/key already exist are skipped.
// Failed inserts are logged (row id) and the script continues.
// ============================================================================

import { readFileSync } from "node:fs";
import { directSql } from "../lib/db-direct";
import { getEnv } from "../lib/env";
import { encrypt, decrypt } from "../lib/crypto";
import { generateId } from "../lib/ids";

const JSON_PATH = "/tmp/xlsx_refdata.json";

type Row = Record<string, unknown>;

interface XlsxData {
  "Centers": Row[];
  "Temples": Row[];
  "Departments": Row[];
  "Department Heads": Row[];
  "Payment Gateways": Row[];
  "Bank Accounts": Row[];
  "Users": Row[];
  "Donors": Row[];
  "QR Scans": Row[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Case-insensitive column lookup with fallback names. */
function get(row: Row, ...names: string[]): string {
  const lower = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) lower.set(k.trim().toLowerCase(), v);
  for (const n of names) {
    const v = lower.get(n.trim().toLowerCase());
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function toBool(v: unknown, defaultVal = true): boolean {
  if (v === undefined || v === null || v === "") return defaultVal;
  const s = String(v).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return defaultVal;
}

function toBoolRaw(row: Row, name: string, defaultVal = true): boolean {
  const lower = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) lower.set(k.trim().toLowerCase(), v);
  return toBool(lower.get(name.toLowerCase()), defaultVal);
}

/** Parse a timestamp string; fall back to `fallback` when unparseable. */
function toTs(v: string, fallback: string): string {
  if (!v) return fallback;
  // openpyxl str(datetime) yields "YYYY-MM-DD HH:MM:SS" — Postgres accepts it,
  // but normalize to ISO to be safe.
  const s = v.includes("T") ? v : v.replace(" ", "T");
  const t = Date.parse(s);
  return isNaN(t) ? fallback : new Date(t).toISOString();
}

function normalizeMobile(m: unknown): string {
  return String(m ?? "").replace(/\D/g, "").slice(-10);
}

// Retry wrapper — Neon HTTP connections can drop under load. Retry with backoff.
async function withRetry<T>(fn: () => Promise<T>, retries = 5, baseDelay = 1000): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt < retries - 1 && (/fetch failed|connect timeout|ECONNRESET|socket hang up|ETIMEDOUT/i.test(msg))) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.error(`  [retry ${attempt + 1}/${retries}] ${msg.split("\n")[0]} — waiting ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
  throw new Error("unreachable");
}

function errMsg(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split("\n")[0];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  getEnv();
  const write = directSql();
  const data = JSON.parse(readFileSync(JSON_PATH, "utf8")) as XlsxData;
  const ts = new Date().toISOString();
  const summary: Array<[string, number, number, number]> = []; // [table, inserted, skipped, failed]

  // directSql's tagged-template function also exposes .query() for plain SQL
  // strings (table identifiers can't be parameterized in tagged templates).
  const raw = write as unknown as { query: (text: string, params?: unknown[]) => Promise<unknown[]> };
  const count = async (table: string): Promise<Set<string>> => {
    const rows = (await withRetry(() => raw.query(`SELECT id FROM ${table}`, []))) as Array<{ id: string }>;
    return new Set(rows.map((r) => String(r.id)));
  };

  // -------------------------------------------------------------------------
  // 1. centers — insert xlsx center ids missing in DB
  // -------------------------------------------------------------------------
  {
    const existing = await count("centers");
    let ins = 0, skip = 0, fail = 0;
    for (const r of data["Centers"] ?? []) {
      const id = get(r, "id", "centerId");
      if (!id) { console.error("  [centers] row without id — skipped:", JSON.stringify(r).slice(0, 120)); skip++; continue; }
      if (existing.has(id)) { skip++; continue; }
      try {
        await withRetry(() => write`
          INSERT INTO centers (id, name, city, state, is_active, temple_id, created_at, updated_at)
          VALUES (${id}, ${get(r, "name")}, ${get(r, "city")}, ${get(r, "state")},
                  ${toBoolRaw(r, "isActive")}, ${get(r, "templeId") || null},
                  ${toTs(get(r, "createdAt"), ts)}, ${toTs(get(r, "updatedAt"), ts)})
        `);
        existing.add(id);
        ins++;
      } catch (e) { fail++; console.error(`  [centers] insert failed id=${id}: ${errMsg(e)}`); }
    }
    summary.push(["centers", ins, skip, fail]);
  }

  // -------------------------------------------------------------------------
  // 2. temples — insert all missing, then backfill centers.temple_id from xlsx
  // -------------------------------------------------------------------------
  {
    const existing = await count("temples");
    let ins = 0, skip = 0, fail = 0;
    for (const r of data["Temples"] ?? []) {
      const id = get(r, "id", "templeId");
      if (!id) { console.error("  [temples] row without id — skipped:", JSON.stringify(r).slice(0, 120)); skip++; continue; }
      if (existing.has(id)) { skip++; continue; }
      try {
        await withRetry(() => write`
          INSERT INTO temples (id, name, city, state, is_active, created_at, updated_at)
          VALUES (${id}, ${get(r, "name")}, ${get(r, "city")}, ${get(r, "state")},
                  ${toBoolRaw(r, "isActive")},
                  ${toTs(get(r, "createdAt"), ts)}, ${toTs(get(r, "updatedAt"), ts)})
        `);
        existing.add(id);
        ins++;
      } catch (e) { fail++; console.error(`  [temples] insert failed id=${id}: ${errMsg(e)}`); }
    }
    summary.push(["temples", ins, skip, fail]);

    // Backfill: UPDATE existing centers set temple_id where xlsx assigns one.
    let upd = 0, updFail = 0;
    for (const r of data["Centers"] ?? []) {
      const cid = get(r, "id", "centerId");
      const tid = get(r, "templeId");
      if (!cid || !tid) continue;
      try {
        await withRetry(() => write`UPDATE centers SET temple_id = ${tid} WHERE id = ${cid}`);
        upd++;
      } catch (e) { updFail++; console.error(`  [centers] temple_id backfill failed id=${cid}: ${errMsg(e)}`); }
    }
    console.log(`  centers temple_id backfill: ${upd} updated, ${updFail} failed`);
  }

  // -------------------------------------------------------------------------
  // 3. departments + department_heads — insert missing by id
  // -------------------------------------------------------------------------
  {
    const existing = await count("departments");
    let ins = 0, skip = 0, fail = 0;
    for (const r of data["Departments"] ?? []) {
      const id = get(r, "id", "departmentId");
      if (!id) { skip++; continue; }
      if (existing.has(id)) { skip++; continue; }
      try {
        await withRetry(() => write`
          INSERT INTO departments (id, name, type, center_id, temple_id, description, is_active, created_at, updated_at)
          VALUES (${id}, ${get(r, "name")}, ${get(r, "type")},
                  ${get(r, "centerId") || null}, ${get(r, "templeId") || null},
                  ${get(r, "description")}, ${toBoolRaw(r, "isActive")},
                  ${toTs(get(r, "createdAt"), ts)}, ${toTs(get(r, "updatedAt"), ts)})
        `);
        existing.add(id);
        ins++;
      } catch (e) { fail++; console.error(`  [departments] insert failed id=${id}: ${errMsg(e)}`); }
    }
    summary.push(["departments", ins, skip, fail]);
  }
  {
    const existing = await count("department_heads");
    let ins = 0, skip = 0, fail = 0;
    for (const r of data["Department Heads"] ?? []) {
      const id = get(r, "id");
      if (!id) { skip++; continue; }
      if (existing.has(id)) { skip++; continue; }
      try {
        await withRetry(() => write`
          INSERT INTO department_heads (id, name, role, phone, temple_id, center_id, is_active, created_at, updated_at)
          VALUES (${id}, ${get(r, "name")}, ${get(r, "role")}, ${get(r, "phone", "mobile")},
                  ${get(r, "templeId") || null}, ${get(r, "centerId") || null},
                  ${toBoolRaw(r, "isActive")},
                  ${toTs(get(r, "createdAt"), ts)}, ${toTs(get(r, "updatedAt"), ts)})
        `);
        existing.add(id);
        ins++;
      } catch (e) { fail++; console.error(`  [department_heads] insert failed id=${id}: ${errMsg(e)}`); }
    }
    summary.push(["department_heads", ins, skip, fail]);
  }

  // -------------------------------------------------------------------------
  // 4. payment_gateways — verify legacy-XOR decrypts to rzp_* BEFORE insert.
  //    If verification fails, STOP (do not write bad secrets).
  // -------------------------------------------------------------------------
  {
    const existing = await count("payment_gateways");
    let ins = 0, skip = 0, fail = 0;
    for (const r of data["Payment Gateways"] ?? []) {
      const id = get(r, "id");
      if (!id) { skip++; continue; }
      if (existing.has(id)) { skip++; continue; }
      const secretEnc = get(r, "razorpayKeySecretEnc", "razorpay_key_secret_enc", "keySecretEnc");
      if (secretEnc) {
        let plain = "";
        try {
          plain = decrypt(secretEnc); // decrypt() has the legacy XOR fallback
        } catch (e) {
          console.error(`FATAL: decrypt failed for payment gateway id=${id}: ${errMsg(e)}`);
          console.error("STOPPING as instructed — no gateway rows inserted.");
          process.exit(1);
        }
        // Razorpay key SECRETS are plain alphanumeric (24-32 chars) — only key
        // IDs carry the rzp_ prefix. Validate: keyId has rzp_ prefix, decrypted
        // secret is printable ASCII of plausible length.
        const keyId = get(r, "razorpayKeyId", "razorpay_key_id", "keyId");
        const plausible = plain.length >= 16 && plain.length <= 64 && /^[\x20-\x7e]+$/.test(plain);
        if (!keyId.startsWith("rzp_") || !plausible) {
          console.error(`FATAL: gateway id=${id} failed validation (keyId=${JSON.stringify(keyId.slice(0, 12))}…, secretLen=${plain.length}).`);
          console.error("STOPPING as instructed — no gateway rows inserted.");
          process.exit(1);
        }
        console.log(`  [payment_gateways] id=${id}: legacy decrypt OK (${plain.length}-char secret) — storing ciphertext as-is`);
      }
      try {
        await withRetry(() => write`
          INSERT INTO payment_gateways (id, name, razorpay_key_id, razorpay_key_secret_enc, is_active, created_at, updated_at)
          VALUES (${id}, ${get(r, "name")}, ${get(r, "razorpayKeyId", "razorpay_key_id", "keyId")},
                  ${secretEnc}, ${toBoolRaw(r, "isActive")},
                  ${toTs(get(r, "createdAt"), ts)}, ${toTs(get(r, "updatedAt"), ts)})
        `);
        existing.add(id);
        ins++;
      } catch (e) { fail++; console.error(`  [payment_gateways] insert failed id=${id}: ${errMsg(e)}`); }
    }
    summary.push(["payment_gateways", ins, skip, fail]);
  }

  // -------------------------------------------------------------------------
  // 5. bank_accounts — insert missing by id (FK -> payment_gateways, centers)
  // -------------------------------------------------------------------------
  {
    const existing = await count("bank_accounts");
    const centerRows = await withRetry(() => write`SELECT id FROM centers`) as unknown as Array<{ id: string }>;
    const validCenters = new Set(centerRows.map((c) => String(c.id)));
    let ins = 0, skip = 0, fail = 0;
    for (const r of data["Bank Accounts"] ?? []) {
      const id = get(r, "id");
      if (!id) { skip++; continue; }
      if (existing.has(id)) { skip++; continue; }
      let centerId = get(r, "centerId") || null;
      if (centerId && !validCenters.has(centerId)) {
        console.log(`  [bank_accounts] id=${id}: center '${centerId}' not in DB — remapping to center_bangalore`);
        centerId = "center_bangalore";
      }
      try {
        await withRetry(() => write`
          INSERT INTO bank_accounts (id, name, account_number, bank_name, center_id, payment_gateway_id, is_active, created_at, updated_at)
          VALUES (${id}, ${get(r, "name")}, ${get(r, "accountNumber", "account_number")},
                  ${get(r, "bankName", "bank_name")}, ${centerId},
                  ${get(r, "paymentGatewayId", "payment_gateway_id") || null},
                  ${toBoolRaw(r, "isActive")},
                  ${toTs(get(r, "createdAt"), ts)}, ${toTs(get(r, "updatedAt"), ts)})
        `);
        existing.add(id);
        ins++;
      } catch (e) { fail++; console.error(`  [bank_accounts] insert failed id=${id}: ${errMsg(e)}`); }
    }
    summary.push(["bank_accounts", ins, skip, fail]);
  }

  // -------------------------------------------------------------------------
  // 6. users — insert missing by username; legacy salted SHA-256 hash kept
  //    with password_scheme='legacy_sha256' (login auto-upgrades to bcrypt).
  // -------------------------------------------------------------------------
  {
    const rows = await withRetry(() => write`SELECT id, username FROM users`) as unknown as Array<{ id: string; username: string }>;
    const byUsername = new Set(rows.map((r) => String(r.username).toLowerCase()));
    const byId = new Set(rows.map((r) => String(r.id)));
    let ins = 0, skip = 0, fail = 0;
    for (const r of data["Users"] ?? []) {
      const username = get(r, "username");
      if (!username) { skip++; continue; }
      if (byUsername.has(username.toLowerCase())) { skip++; continue; }
      let id = get(r, "id");
      if (!id || byId.has(id)) id = generateId("user");
      const permissions = get(r, "permissions") || "{}";
      // Legacy cashbooks may be a comma-separated string (e.g. "Cash_Yatra_NND")
      // rather than JSON — normalize to a JSON array.
      let cashbooks = get(r, "cashbooks") || "[]";
      try { JSON.parse(cashbooks); } catch {
        cashbooks = JSON.stringify(cashbooks.split(",").map((s: string) => s.trim()).filter(Boolean));
      }
      try {
        await withRetry(() => write`
          INSERT INTO users (id, username, password_hash, password_scheme, role,
                             center_id, temple_id, department_id, permissions, cashbooks,
                             created_by, is_active, created_at, updated_at)
          VALUES (${id}, ${username}, ${get(r, "passwordHash", "password_hash")}, 'legacy_sha256',
                  ${get(r, "role") || "volunteer"},
                  ${get(r, "centerId") || null}, ${get(r, "templeId") || null},
                  ${get(r, "departmentId") || null},
                  ${permissions}::jsonb, ${cashbooks}::jsonb,
                  ${get(r, "createdBy", "created_by")}, ${toBoolRaw(r, "isActive")},
                  ${toTs(get(r, "createdAt"), ts)}, ${toTs(get(r, "updatedAt"), ts)})
        `);
        byUsername.add(username.toLowerCase());
        byId.add(id);
        ins++;
      } catch (e) { fail++; console.error(`  [users] insert failed username=${username}: ${errMsg(e)}`); }
    }
    summary.push(["users", ins, skip, fail]);
  }

  // -------------------------------------------------------------------------
  // 7. donors — dedupe by normalized mobile (strip non-digits, last 10).
  //    PAN/email encrypted with AES-256-GCM (encrypt() handles empty strings).
  // -------------------------------------------------------------------------
  {
    const centerRows = await withRetry(() => write`SELECT id FROM centers`) as unknown as Array<{ id: string }>;
    const validCenters = new Set(centerRows.map((r) => String(r.id)));
    const donorRows = await withRetry(() => write`SELECT id, mobile FROM donors`) as unknown as Array<{ id: string; mobile: string }>;
    const mobileSet = new Set<string>();
    const idSet = new Set(donorRows.map((r) => String(r.id)));
    for (const d of donorRows) {
      const m = normalizeMobile(d.mobile);
      if (m) mobileSet.add(m);
    }

    let ins = 0, skip = 0, fail = 0;
    const donors = data["Donors"] ?? [];
    for (let i = 0; i < donors.length; i++) {
      const r = donors[i];
      const mobile = get(r, "mobile", "phone");
      const mob = normalizeMobile(mobile);
      if (mob && mobileSet.has(mob)) { skip++; continue; }

      let id = get(r, "id", "donorId");
      if (!id || idSet.has(id)) id = generateId("donor");

      let centerId = get(r, "centerId");
      if (!centerId || !validCenters.has(centerId)) centerId = "center_bangalore";

      const pan = get(r, "pan").toUpperCase();
      const email = get(r, "email");
      const whatsapp = get(r, "whatsapp") || mobile;

      try {
        await withRetry(() => write`
          INSERT INTO donors
            (id, name, spiritual_name, indian_passport, pan, mobile, whatsapp, email,
             flat, road, po, area, pincode, district, state, country, tally_name,
             center_id, password_hash, password_scheme, created_by, created_at, updated_at)
          VALUES
            (${id}, ${get(r, "name")}, ${get(r, "spiritualName", "spiritual_name")},
             ${toBoolRaw(r, "indianPassport", false)},
             ${encrypt(pan)}, ${mobile}, ${whatsapp}, ${encrypt(email)},
             ${get(r, "flat")}, ${get(r, "road")}, ${get(r, "po")}, ${get(r, "area")},
             ${get(r, "pincode")}, ${get(r, "district")}, ${get(r, "state")},
             ${get(r, "country") || "India"}, ${get(r, "tallyName", "tally_name")},
             ${centerId}, '', 'bcrypt', 'xlsx-import',
             ${toTs(get(r, "createdAt"), ts)}, ${toTs(get(r, "updatedAt"), ts)})
        `);
        if (mob) mobileSet.add(mob);
        idSet.add(id);
        ins++;
      } catch (e) {
        fail++;
        console.error(`  [donors] insert failed id=${id} mobile=${mob}: ${errMsg(e)}`);
      }
      if ((i + 1) % 250 === 0) {
        console.log(`  ...donors processed ${i + 1}/${donors.length} (${ins} inserted, ${skip} skipped, ${fail} failed)`);
      }
    }
    summary.push(["donors", ins, skip, fail]);
  }

  // -------------------------------------------------------------------------
  // 8. qr_scans — insert missing by id
  // -------------------------------------------------------------------------
  {
    const existing = await count("qr_scans");
    let ins = 0, skip = 0, fail = 0;
    for (const r of data["QR Scans"] ?? []) {
      const id = get(r, "id");
      if (!id) { skip++; continue; }
      if (existing.has(id)) { skip++; continue; }
      const itemIndex = parseInt(get(r, "itemIndex", "item_index") || "0", 10);
      try {
        await withRetry(() => write`
          INSERT INTO qr_scans (id, booking_id, item_index, type, scanned_at, scanned_by)
          VALUES (${id}, ${get(r, "bookingId", "booking_id") || null},
                  ${isNaN(itemIndex) ? 0 : itemIndex}, ${get(r, "type")},
                  ${toTs(get(r, "scannedAt", "scanned_at"), ts)}, ${get(r, "scannedBy", "scanned_by")})
        `);
        existing.add(id);
        ins++;
      } catch (e) { fail++; console.error(`  [qr_scans] insert failed id=${id}: ${errMsg(e)}`); }
    }
    summary.push(["qr_scans", ins, skip, fail]);
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log("\n================ IMPORT SUMMARY ================");
  console.log("table              inserted   skipped   failed");
  for (const [table, i, s, f] of summary) {
    console.log(`  ${table.padEnd(18)} ${String(i).padStart(6)} ${String(s).padStart(9)} ${String(f).padStart(7)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
