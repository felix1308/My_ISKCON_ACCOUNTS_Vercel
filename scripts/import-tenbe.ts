// ============================================================================
// import-tenbe — one-shot import of the legacy 10BE Drive-URL data maps into
// the ten_be_records table.
//
// Sources (project root, plain JS data maps):
//   ten_be_multifield_map.js  window.TEN_BE_RECORDS = [{pan, voucherNo, date, amount, url}]
//   ten_be_composite_map.js   window.TEN_BE_MAP = { "PAN|VOUCHER": [url, ...] }
//   ten_be_voucher_map.js     window.TEN_BE_VOUCHER_MAP = { "VOUCHER": [url, ...] }
//
// Run with:
//   node --env-file=.env.local node_modules/.bin/tsx scripts/import-tenbe.ts
//
// Idempotent: skips existing (voucher_no, url) combos via ON CONFLICT DO NOTHING
// (backed by the UNIQUE (voucher_no, url) constraint in db/schema.sql).
// ============================================================================

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { directSql } from "../lib/db-direct";
import { getEnv } from "../lib/env";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

interface TenBeRecord {
  pan: string;
  voucherNo: string;
  date: string;
  amount: number | null;
  url: string;
}

/** Evaluate one of the legacy `window.X = ...` data files and return the map. */
function loadJsDataFile<T>(filename: string, globalName: string): T {
  const code = readFileSync(join(ROOT, filename), "utf8");
  const sandbox: Record<string, unknown> = {};
  // eslint-disable-next-line no-new-func
  new Function("window", code)(sandbox);
  const value = sandbox[globalName];
  if (!value) throw new Error(`${globalName} not found in ${filename}`);
  return value as T;
}

function normPan(p: unknown): string {
  return String(p ?? "").trim().toUpperCase();
}
function normVoucher(v: unknown): string {
  return String(v ?? "").trim();
}
function normDate(d: unknown): string {
  const s = String(d ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m1 = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
  return s;
}
function normAmount(a: unknown): number | null {
  if (a === null || a === undefined || a === "") return null;
  const n = parseFloat(String(a));
  return isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function collectRecords(): TenBeRecord[] {
  const records: TenBeRecord[] = [];
  const seen = new Set<string>(); // dedupe by voucher|url

  const push = (r: TenBeRecord) => {
    if (!r.url) return;
    const key = `${r.voucherNo.toLowerCase()}|${r.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    records.push(r);
  };

  // 1. Richest source: full records with pan/voucher/date/amount.
  const multi = loadJsDataFile<
    Array<{ pan?: string; voucherNo?: string; date?: string; amount?: number; url?: string }>
  >("ten_be_multifield_map.js", "TEN_BE_RECORDS");
  for (const r of multi) {
    push({
      pan: normPan(r.pan),
      voucherNo: normVoucher(r.voucherNo),
      date: normDate(r.date),
      amount: normAmount(r.amount),
      url: String(r.url ?? "").trim(),
    });
  }
  console.log(`multifield map: ${multi.length} records`);

  // 2. Composite map: "PAN|VOUCHER" -> [urls] (no date/amount).
  const composite = loadJsDataFile<Record<string, string[]>>(
    "ten_be_composite_map.js", "TEN_BE_MAP"
  );
  let compositeCount = 0;
  for (const [key, urls] of Object.entries(composite)) {
    const [pan, voucher] = key.split("|");
    for (const url of urls ?? []) {
      const before = records.length;
      push({ pan: normPan(pan), voucherNo: normVoucher(voucher), date: "", amount: null, url: String(url).trim() });
      if (records.length > before) compositeCount++;
    }
  }
  console.log(`composite map:  ${compositeCount} new records (${Object.keys(composite).length} keys)`);

  // 3. Voucher-only map: "VOUCHER" -> [urls] (no pan/date/amount).
  const voucherMap = loadJsDataFile<Record<string, string[]>>(
    "ten_be_voucher_map.js", "TEN_BE_VOUCHER_MAP"
  );
  let voucherCount = 0;
  for (const [voucher, urls] of Object.entries(voucherMap)) {
    for (const url of urls ?? []) {
      const before = records.length;
      push({ pan: "", voucherNo: normVoucher(voucher), date: "", amount: null, url: String(url).trim() });
      if (records.length > before) voucherCount++;
    }
  }
  console.log(`voucher map:    ${voucherCount} new records (${Object.keys(voucherMap).length} keys)`);

  return records;
}

async function main() {
  getEnv(); // validate env (DATABASE_URL_DIRECT / DATABASE_URL)
  const sql = directSql();

  const records = collectRecords();
  console.log(`Total deduped records to insert: ${records.length}`);

  let inserted = 0;
  const BATCH = 200;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    // Build one multi-row INSERT per batch, fully parameterized.
    const pans = batch.map((r) => r.pan);
    const vouchers = batch.map((r) => r.voucherNo);
    const dates = batch.map((r) => r.date);
    const amounts = batch.map((r) => r.amount);
    const urls = batch.map((r) => r.url);
    const result = await sql`
      INSERT INTO ten_be_records (pan, voucher_no, txn_date, amount, url)
      SELECT p, v, d, a, u
      FROM unnest(
        ${pans}::text[], ${vouchers}::text[], ${dates}::text[],
        ${amounts}::numeric[], ${urls}::text[]
      ) AS t(p, v, d, a, u)
      ON CONFLICT (voucher_no, url) DO NOTHING
    `;
    void result;
    // Count actual inserts by diffing row count (cheaper than RETURNING parse).
    const cnt = await sql`SELECT count(*)::int AS n FROM ten_be_records`;
    inserted = Number((cnt[0] as { n: number } | undefined)?.n ?? 0);
    console.log(`  batch ${Math.floor(i / BATCH) + 1}: table now has ${inserted} rows`);
  }

  console.log(`\nDone! ten_be_records now contains ${inserted} rows.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
