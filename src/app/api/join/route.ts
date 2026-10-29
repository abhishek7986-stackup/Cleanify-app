import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * New staff sign-up: creates an INACTIVE supervisor account with its ID
 * documents. An admin approves it from Users before it can do anything.
 *
 * Public by necessity (the person has no account yet), so it is careful:
 *   - every field is validated here, never trusted from the form;
 *   - documents are checked by their first bytes, not their name or the type
 *     the browser claims, and stored in a private bucket under a server-chosen
 *     path;
 *   - a simple per-address limit stops one device creating accounts in a loop;
 *   - if anything fails after the login is created, the login is deleted
 *     again, so the person can simply try once more.
 */

const DOMAIN = process.env.NEXT_PUBLIC_STAFF_EMAIL_DOMAIN ?? "cleanify.internal";
const MAX_BYTES = 10 * 1024 * 1024;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const attempts = new Map<string, number[]>();

type DocKind = "AADHAAR_FRONT" | "AADHAAR_BACK" | "DRIVING_LICENCE";

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function sniff(bytes: Uint8Array): { mime: string; ext: string } | null {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return { mime: "image/webp", ext: "webp" };
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { mime: "application/pdf", ext: "pdf" };
  return null;
}

// Counts only attempts that get as far as creating a login, so someone
// correcting typos in the form is never locked out.
function recentCreations(key: string): number[] {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  attempts.set(key, recent);
  return recent;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("The form could not be read. Try again.");
  }

  // Bots fill every field; people never see this one.
  if (String(form.get("website") ?? "") !== "") return NextResponse.json({ ok: true });

  const fullName = String(form.get("full_name") ?? "").trim().replace(/\s+/g, " ");
  const digits = String(form.get("phone") ?? "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  const address = String(form.get("address") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const hasLicence = String(form.get("has_licence") ?? "") === "yes";

  if (fullName.length < 2 || fullName.length > 80) return fail("Enter your full name.");
  if (!/^[6-9]\d{9}$/.test(digits)) return fail("Enter a 10-digit Indian mobile number.");
  if (address.length < 8 || address.length > 300) return fail("Enter your full address.");
  if (password.length < 8 || password.length > 72) return fail("The password needs at least 8 characters.");

  const wanted: { field: string; kind: DocKind; name: string }[] = [
    { field: "aadhaar_front", kind: "AADHAAR_FRONT", name: "your Aadhaar card" },
    hasLicence
      ? { field: "licence", kind: "DRIVING_LICENCE", name: "your driving licence" }
      : { field: "aadhaar_back", kind: "AADHAAR_BACK", name: "the back of your Aadhaar card" },
  ];

  const docs: { kind: DocKind; bytes: Uint8Array; mime: string; ext: string }[] = [];
  for (const w of wanted) {
    const file = form.get(w.field);
    if (!(file instanceof File) || file.size === 0) return fail(`Add a photo of ${w.name}.`);
    if (file.size > MAX_BYTES) return fail(`The photo of ${w.name} is over 10 MB. Take a new photo.`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniff(bytes);
    if (!type) return fail(`The file for ${w.name} must be a photo (JPG or PNG) or a PDF.`);
    docs.push({ kind: w.kind, bytes, ...type });
  }

  const recent = recentCreations(ip);
  if (recent.length >= MAX_PER_WINDOW) {
    return fail("Too many accounts created from this device. Try again in an hour.", 429);
  }
  recent.push(Date.now());

  const admin = createAdminClient();
  const phone = `+91${digits}`;

  // The mobile number is the username: they sign in with it.
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email: `${digits}@${DOMAIN}`,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, signup: "self" },
  });
  if (userErr || !created.user) {
    const taken = /already|registered|exists/i.test(userErr?.message ?? "");
    return fail(
      taken
        ? "This mobile number already has an account. Sign in instead, or ask the office to reset your password."
        : "Your account could not be created. Try again in a minute.",
      taken ? 409 : 500,
    );
  }
  const userId = created.user.id;

  const uploaded: string[] = [];
  const undo = async () => {
    if (uploaded.length) await admin.storage.from("staff-documents").remove(uploaded).catch(() => {});
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  };

  try {
    const { error: profileErr } = await admin.rpc("admin_upsert_staff", {
      p_user_id: userId,
      p_full_name: fullName,
      p_role: "supervisor",
      p_phone: phone,
      p_is_active: false,
    });
    if (profileErr) throw profileErr;

    const { data: app, error: appErr } = await admin
      .from("staff_applications")
      .insert({ user_id: userId, full_name: fullName, phone, address, has_licence: hasLicence })
      .select("id")
      .single();
    if (appErr || !app) throw appErr ?? new Error("application not saved");

    for (const d of docs) {
      const path = `applications/${app.id}/${d.kind.toLowerCase()}-${crypto.randomUUID()}.${d.ext}`;
      const up = await admin.storage
        .from("staff-documents")
        .upload(path, d.bytes, { contentType: d.mime, upsert: false });
      if (up.error) throw up.error;
      uploaded.push(path);
      const { error: docErr } = await admin.from("staff_documents").insert({
        application_id: app.id,
        kind: d.kind,
        storage_path: path,
        mime_type: d.mime,
        bytes: d.bytes.byteLength,
      });
      if (docErr) throw docErr;
    }
  } catch {
    await undo();
    return fail("Your documents could not be saved. Check your signal and try again.", 500);
  }

  return NextResponse.json({ ok: true, username: digits });
}
