#!/usr/bin/env node
/**
 * Applies supabase/migrations/*.sql in filename order.
 *
 *   npm run db:push            apply everything not yet applied
 *   npm run db:push -- --dry   list what would run
 *   npm run db:status          show applied vs pending
 *
 * Each file runs inside its own transaction, so a failure leaves the database
 * exactly as it was rather than half-migrated. Applied versions are recorded in
 * `supabase_migrations.schema_migrations` — the same table the Supabase CLI
 * uses, so `supabase db push` stays in sync later instead of trying to reapply.
 *
 * On error it maps Postgres's character offset back to a line and column in the
 * source file and prints the surrounding lines. That matters here: none of this
 * SQL has ever run, so the first pass is genuinely a debugging exercise.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "supabase", "migrations");

const DB_URL = process.env.SUPABASE_DB_URL;
if (!DB_URL) {
  console.error(
    "\nSUPABASE_DB_URL is not set in .env.local.\n\n" +
      "Supabase dashboard -> Connect (top bar) -> Session pooler -> copy the URI,\n" +
      "then replace [YOUR-PASSWORD] with your database password.\n\n" +
      "Use the SESSION pooler, not the transaction pooler: migrations need a\n" +
      "session-scoped connection for advisory locks and DDL.\n",
  );
  process.exit(1);
}

const dry = process.argv.includes("--dry");
const statusOnly = process.argv.includes("--status");

function lineFor(sql, position) {
  const upto = sql.slice(0, Math.max(0, position - 1));
  const line = upto.split("\n").length;
  const col = position - (upto.lastIndexOf("\n") + 1);
  return { line, col };
}

function excerpt(sql, line) {
  const lines = sql.split("\n");
  const from = Math.max(0, line - 4);
  const to = Math.min(lines.length, line + 3);
  return lines
    .slice(from, to)
    .map((text, i) => {
      const n = from + i + 1;
      return `${n === line ? " >" : "  "} ${String(n).padStart(4)} | ${text}`;
    })
    .join("\n");
}

const client = new pg.Client({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
  // A few of these files are large; give them room.
  statement_timeout: 120_000,
});

try {
  await client.connect();
} catch (err) {
  console.error(`\nCould not connect: ${err.message}\n`);
  if (/password authentication failed/i.test(err.message)) {
    console.error("The password in SUPABASE_DB_URL is wrong. Reset it in");
    console.error("Supabase -> Project Settings -> Database -> Database password.\n");
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(err.message)) {
    console.error("Host not found — check the URI was copied whole.\n");
  }
  process.exit(1);
}

await client.query(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version    text primary key,
    statements text[],
    name       text
  );
`);

const { rows: done } = await client.query(
  "select version from supabase_migrations.schema_migrations",
);
const applied = new Set(done.map((r) => r.version));

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const pending = files.filter((f) => !applied.has(f.split("_")[0]));

if (statusOnly) {
  for (const f of files) {
    const v = f.split("_")[0];
    console.log(`  ${applied.has(v) ? "applied" : "PENDING"}  ${f}`);
  }
  await client.end();
  process.exit(0);
}

if (pending.length === 0) {
  console.log("\n  Nothing to apply — database is up to date.\n");
  await client.end();
  process.exit(0);
}

console.log(`\n  ${pending.length} migration(s) to apply:\n`);
if (dry) {
  pending.forEach((f) => console.log(`    ${f}`));
  console.log("");
  await client.end();
  process.exit(0);
}

let failed = false;
for (const file of pending) {
  const version = file.split("_")[0];
  const name = file.replace(/^\d+_/, "").replace(/\.sql$/, "");
  const sql = readFileSync(join(DIR, file), "utf8");
  const t0 = Date.now();

  try {
    await client.query("begin");
    await client.query(sql);
    await client.query(
      "insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)",
      [version, name, [sql]],
    );
    await client.query("commit");
    console.log(`  ok    ${file}  (${Date.now() - t0} ms)`);
  } catch (err) {
    await client.query("rollback").catch(() => {});
    failed = true;
    console.error(`\n  FAILED ${file}`);
    console.error(`  ${err.severity ?? "ERROR"}: ${err.message}`);
    if (err.detail) console.error(`  detail: ${err.detail}`);
    if (err.hint) console.error(`  hint:   ${err.hint}`);
    if (err.position) {
      const { line, col } = lineFor(sql, Number(err.position));
      console.error(`  at line ${line}, column ${col}:\n`);
      console.error(excerpt(sql, line));
    }
    console.error("\n  Rolled back. Nothing from this file was applied.\n");
    break;
  }
}

await client.end();
process.exit(failed ? 1 : 0);
