// ============================================================================
// patch-10be-remarks — backfills "10beUrl:<url>" into booking remarks from
// donors_with_transactions.json. The JSON has direct Drive links (tenBeUrl)
// for some transactions, but migrate-from-json.ts never wrote them into
// remarks (bulk.ts does for API imports; the migration missed it).
//
// Match key: voucherNo + donor mobile (same as crosscheck-empty-txns).
// Idempotent: skips bookings whose remarks already contain 10beUrl.
//
// Run: node --env-file=.env.local node_modules/.bin/tsx scripts/patch-10be-remarks.ts
// ============================================================================

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { directSql } from "../lib/db-direct";
import { getEnv } from "../lib/env";

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, "donors_with_transactions.json");

function normalizeMobile(m: unknown): string {
  return String(m ?? "").replace(/\D/g, "").slice(-10);
}

async function main() {
  getEnv();
  const sql = directSql();
  const data = JSON.parse(readFileSync(JSON_PATH, "utf8")) as {
    donors: Array<{ mobile?: string; transactions?: Array<{ voucherNo?: string; tenBeUrl?: string }> }>;
  };

  const urlByKey = new Map<string, string>(); // `${mobile}|${voucherNo}` -> url
  for (const d of data.donors) {
    const mob = normalizeMobile(d.mobile);
    if (!mob) continue;
    for (const t of d.transactions ?? []) {
      const v = (t.voucherNo ?? "").trim();
      const u = (t.tenBeUrl ?? "").trim();
      if (v && u) urlByKey.set(`${mob}|${v}`, u);
    }
  }
  console.log(`Found ${urlByKey.size} tenBeUrl entries in JSON`);

  const rows = await sql`
    SELECT b.id, b.remarks, d.mobile
    FROM bookings b JOIN donors d ON d.id = b.donor_id
    WHERE b.remarks LIKE 'voucherNo:%' AND b.remarks NOT LIKE '%10beUrl:%'
  `;
  console.log(`Bookings with voucher but no 10beUrl: ${rows.length}`);

  let patched = 0;
  for (const r of rows) {
    const m = String(r.remarks).match(/^voucherNo:([^\s|]+)/);
    if (!m) continue;
    const key = `${normalizeMobile(r.mobile)}|${m[1]}`;
    const url = urlByKey.get(key);
    if (!url) continue;
    await sql`UPDATE bookings SET remarks = ${String(r.remarks) + " | 10beUrl:" + url} WHERE id = ${r.id}`;
    patched++;
  }
  console.log(`Patched: ${patched}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
