// Cross-check: for every transaction with empty txn_date, look up the
// ORIGINAL date in donors_with_transactions.json.bak (matched by donor
// mobile + voucherNo). Restores any that originally had a VALID date.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { directSql } from "../lib/db-direct";
import { getEnv } from "../lib/env";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BAK_PATH = join(__dirname, "donors_with_transactions.json.bak");
const VALID = /^\d{4}-\d{2}-\d{2}$/;

function normalizeMobile(m: unknown): string {
  return String(m ?? "").replace(/\D/g, "").slice(-10);
}

async function main() {
  getEnv();
  const sql = directSql();

  const data = JSON.parse(readFileSync(BAK_PATH, "utf8")) as {
    donors: Array<{ mobile?: string; transactions?: Array<{ voucherNo?: string; date?: string }> }>;
  };
  const origDate = new Map<string, string>(); // `${mobile}|${voucherNo}` -> original date
  for (const d of data.donors) {
    const mob = normalizeMobile(d.mobile);
    if (!mob) continue;
    for (const t of d.transactions ?? []) {
      const v = (t.voucherNo ?? "").trim();
      if (v) origDate.set(`${mob}|${v}`, (t.date ?? "").trim());
    }
  }
  console.log(`Loaded ${origDate.size} voucher keys from .bak`);

  const rows = await sql`
    SELECT t.id, t.voucher_no, d.mobile
    FROM transactions t JOIN donors d ON d.id = t.donor_id
    WHERE t.txn_date = ''
  `;
  console.log(`Empty txns to check: ${rows.length}`);

  let restored = 0, legitGarbage = 0, notFound = 0;
  for (const r of rows) {
    const key = `${normalizeMobile(r.mobile)}|${String(r.voucher_no).trim()}`;
    const orig = origDate.get(key);
    if (orig === undefined) { notFound++; continue; }
    if (VALID.test(orig)) {
      await sql`UPDATE transactions SET txn_date = ${orig} WHERE id = ${r.id}`;
      restored++;
    } else {
      legitGarbage++; // original date was itself garbage/empty — correctly blank
    }
  }
  console.log(`Restored from .bak:        ${restored}`);
  console.log(`Legit garbage (kept ''):   ${legitGarbage}`);
  console.log(`Not found in .bak:         ${notFound}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
