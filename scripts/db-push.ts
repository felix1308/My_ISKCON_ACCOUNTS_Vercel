// ============================================================================
// db-push — applies db/schema.sql against DATABASE_URL_DIRECT (or DATABASE_URL).
// Run with:  npm run db:push
//
// This is a one-shot admin script, not part of the runtime. It splits schema.sql
// into individual statements and runs them in order so CREATE TABLE / CREATE
// INDEX / CREATE OR REPLACE FUNCTION / DO $$ ... $$ blocks all execute cleanly.
// ============================================================================

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { directSql } from "../lib/db-direct";
import { getEnv } from "../lib/env";

// directSql returns the Neon tagged-template function, which also exposes
// a .query() method for conventional SQL strings with $1/$2 placeholders.
// We use it here with no params to run DDL parsed from schema.sql.
// NEVER pass user input through this path.
async function runRaw(sqlFn: ReturnType<typeof directSql>, stmt: string): Promise<void> {
  await (sqlFn as unknown as { query: (text: string, params?: unknown[]) => Promise<unknown[]> })
    .query(stmt, []);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, "..", "db", "schema.sql");

function splitStatements(sqlText: string): string[] {
  // Strip -- single-line comments first, then split on semicolons.
  // This avoids semicolons inside comments breaking the splitter, and
  // prevents comment-prefixed statements from being skipped.
  const lines = sqlText.split("\n");
  const cleaned: string[] = [];
  let inDollar = false;
  for (const line of lines) {
    // Track $$ ... $$ blocks — don't strip comments inside function bodies.
    if (line.includes("$$")) inDollar = !inDollar;
    if (!inDollar && line.trimStart().startsWith("--")) continue;
    cleaned.push(line);
  }
  const text = cleaned.join("\n");

  const stmts: string[] = [];
  let buf = "";
  let inDollar2 = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    buf += ch;
    if (ch === "$" && text[i + 1] === "$") {
      inDollar2 = !inDollar2;
      buf += "$";
      i++;
      continue;
    }
    if (ch === ";" && !inDollar2) {
      const trimmed = buf.trim();
      if (trimmed) stmts.push(trimmed);
      buf = "";
    }
  }
  if (buf.trim()) stmts.push(buf.trim());
  return stmts;
}

async function main() {
  getEnv(); // validate env
  const sql = directSql();
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  const stmts = splitStatements(schema);
  console.log(`Applying ${stmts.length} statements from db/schema.sql...`);
  let ok = 0, fail = 0;
  for (const stmt of stmts) {
    try {
      await runRaw(sql, stmt);
      ok++;
    } catch (e) {
      // CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS make most
      // reruns idempotent, but log anything that fails for visibility.
      const msg = e instanceof Error ? e.message : String(e);
      // Ignore "already exists" since we use IF NOT EXISTS everywhere.
      if (/already exists|does not exist/i.test(msg)) {
        // still counts as OK for idempotency
        ok++;
        continue;
      }
      console.error("  FAIL:", msg.split("\n")[0]);
      fail++;
    }
  }
  console.log(`Done: ${ok} ok, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
