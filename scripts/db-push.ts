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

// directSql returns the Neon tagged-template function; we wrap a raw string
// as a single-statement template with no interpolations to run DDL parsed
// from schema.sql. NEVER pass user input through this path.
async function runRaw(sqlFn: ReturnType<typeof directSql>, stmt: string): Promise<void> {
  await sqlFn({ raw: [stmt], cooked: [stmt] } as unknown as TemplateStringsArray);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, "..", "db", "schema.sql");

function splitStatements(sqlText: string): string[] {
  const stmts: string[] = [];
  let buf = "";
  let inDollar = false;
  for (let i = 0; i < sqlText.length; i++) {
    const ch = sqlText[i];
    buf += ch;
    // Track $$ ... $$ blocks (function bodies / DO blocks).
    if (ch === "$" && sqlText[i + 1] === "$") {
      inDollar = !inDollar;
      buf += "$";
      i++;
      continue;
    }
    if (ch === ";" && !inDollar) {
      const trimmed = buf.trim();
      if (trimmed && !trimmed.startsWith("--")) stmts.push(trimmed);
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
