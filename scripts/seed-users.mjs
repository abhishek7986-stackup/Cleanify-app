#!/usr/bin/env node
/**
 * Creates the three test staff accounts.
 *
 * Auth users must go through the Admin API rather than raw SQL — it hashes the
 * password and writes the `auth.identities` row that newer Supabase versions
 * require for sign-in to work at all.
 *
 *   node --env-file=.env.local scripts/seed-users.mjs
 *
 * Idempotent: re-running updates the existing accounts instead of failing.
 */

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DOMAIN = process.env.NEXT_PUBLIC_STAFF_EMAIL_DOMAIN ?? "cleanify.internal";

// The depot is where the supervisor starts the day, and the ENTIRE check-in
// deadline is derived from the travel time between it and the first job. A
// wrong depot means every deadline is wrong, so this is worth setting properly.
const DEPOT_LAT = Number(process.env.SEED_DEPOT_LAT ?? 17.4401);
const DEPOT_LNG = Number(process.env.SEED_DEPOT_LNG ?? 78.3489);
const DEPOT_ADDRESS = process.env.SEED_DEPOT_ADDRESS ?? "Cleanify depot (PLACEHOLDER — change me)";

if (!URL || URL.includes("placeholder")) {
  console.error("NEXT_PUBLIC_SUPABASE_URL is missing or still the placeholder.");
  process.exit(1);
}
if (!SERVICE_KEY) {
  console.error(
    "SUPABASE_SERVICE_ROLE_KEY is not set.\n" +
      "Find it in Supabase → Project Settings → API → service_role.\n" +
      "It bypasses RLS entirely — keep it out of version control and never\n" +
      "prefix it with NEXT_PUBLIC_.",
  );
  process.exit(1);
}

const STAFF = [
  {
    username: "admin",
    full_name: "Cleanify Admin",
    role: "admin",
    phone: "+919000000001",
    password: process.env.SEED_ADMIN_PASSWORD ?? "CleanifyAdmin#2026",
  },
  {
    username: "priya",
    full_name: "Priya (Sales)",
    role: "sales_rep",
    phone: "+919000000002",
    password: process.env.SEED_SALES_PASSWORD ?? "CleanifySales#2026",
  },
  {
    username: "ravi",
    full_name: "Ravi (Supervisor)",
    role: "supervisor",
    phone: "+919000000003",
    password: process.env.SEED_SUPERVISOR_PASSWORD ?? "CleanifySuper#2026",
    base_lat: DEPOT_LAT,
    base_lng: DEPOT_LNG,
    base_address: DEPOT_ADDRESS,
  },
];

const supabase = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** The Admin API has no "get by email", so page through until we find them. */
async function findUserByEmail(email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function upsertStaff(person) {
  const email = `${person.username}@${DOMAIN}`;
  let user = await findUserByEmail(email);

  if (user) {
    const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
      password: person.password,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: person.password,
      // No inbox exists for @cleanify.internal, so confirm on creation or
      // nobody can ever sign in.
      email_confirm: true,
      user_metadata: { full_name: person.full_name },
    });
    if (error) throw error;
    user = data.user;
  }

  const { error: rpcError } = await supabase.rpc("admin_upsert_staff", {
    p_user_id: user.id,
    p_full_name: person.full_name,
    p_role: person.role,
    p_phone: person.phone,
    p_base_lat: person.base_lat ?? null,
    p_base_lng: person.base_lng ?? null,
    p_base_address: person.base_address ?? null,
    p_is_active: true,
  });
  if (rpcError) throw new Error(`profile for ${email}: ${rpcError.message}`);

  return { email, id: user.id, ...person };
}

const results = [];
for (const person of STAFF) {
  try {
    results.push(await upsertStaff(person));
    console.log(`  ok   ${person.username.padEnd(8)} ${person.role}`);
  } catch (err) {
    console.error(`  FAIL ${person.username.padEnd(8)} ${err.message}`);
    process.exitCode = 1;
  }
}

if (results.length) {
  console.log("\n  Sign in at /login with the username only — the form appends");
  console.log(`  @${DOMAIN} for you.\n`);
  console.table(
    results.map((r) => ({ username: r.username, role: r.role, password: r.password })),
  );
  console.log(
    "\n  These are DEVELOPMENT credentials. Change every password before this\n" +
      "  reaches anyone outside your team.\n",
  );
  console.log(
    "  If sign-in works but everything looks empty or forbidden, the Custom\n" +
      "  Access Token hook is not registered — role lives in the JWT, and every\n" +
      "  RLS policy reads it from there.\n",
  );
  if (DEPOT_ADDRESS.includes("PLACEHOLDER")) {
    console.log(
      `  Depot is set to the placeholder ${DEPOT_LAT}, ${DEPOT_LNG}. Every\n` +
        "  check-in deadline is computed from it, so set SEED_DEPOT_LAT /\n" +
        "  SEED_DEPOT_LNG to your real depot before testing timings.\n",
    );
  }
}
