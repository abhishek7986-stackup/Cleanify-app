import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUserId } from "@/lib/data/session";
import { formatIstDate } from "@/lib/domain/checkin-policy";
import { AutoRefresh } from "@/components/AutoRefresh";
import { SignOutButton } from "@/components/SignOutButton";
import { ContinueButton } from "./ContinueButton";

export const metadata = { title: "Your account" };
export const dynamic = "force-dynamic";

/**
 * Where a new applicant (or anyone whose account is switched off) lands after
 * signing in. The proxy sends every inactive account here and nowhere else.
 */
export default async function JoinStatusPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const supabase = await createClient();
  const [{ data: app }, { data: profile }] = await Promise.all([
    supabase
      .from("staff_applications")
      .select("full_name, status, submitted_at, rejection_reason")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("profiles").select("full_name, is_active").eq("id", userId).maybeSingle(),
  ]);

  const status = profile?.is_active ? "APPROVED" : (app?.status ?? "INACTIVE");
  const name = app?.full_name ?? profile?.full_name ?? "";

  return (
    <main className="flex min-h-full flex-col justify-center px-5 py-10">
      <div className="mx-auto w-full max-w-sm space-y-5">
        <h1 className="text-center text-2xl font-semibold text-slate-900">
          {name ? `Hi ${name.split(" ")[0]}` : "Your account"}
        </h1>

        {status === "PENDING" ? (
          <div className="rounded-2xl border border-brand-200 bg-brand-50 p-5">
            <AutoRefresh seconds={20} />
            <p className="flex items-center gap-2 font-semibold text-brand-800">
              <span className="size-2.5 animate-pulse rounded-full bg-brand-600" aria-hidden />
              Waiting for approval
            </p>
            <p className="mt-1 text-sm text-brand-900">
              Your account and documents were received
              {app?.submitted_at ? ` on ${formatIstDate(app.submitted_at)}` : ""}. The office checks your
              documents and switches your account on. This page updates by itself.
            </p>
          </div>
        ) : status === "APPROVED" ? (
          <div className="space-y-3 rounded-2xl border border-ok-100 bg-ok-50 p-5">
            <p className="font-semibold text-ok-700">Your account is approved</p>
            <p className="text-sm text-ok-700">Welcome to Cleanify. You can start using the app now.</p>
            <ContinueButton />
          </div>
        ) : status === "REJECTED" ? (
          <div className="rounded-2xl border border-danger-100 bg-danger-50 p-5">
            <p className="font-semibold text-danger-700">Your account was not approved</p>
            {app?.rejection_reason ? <p className="mt-1 text-sm text-danger-700">{app.rejection_reason}</p> : null}
            <p className="mt-2 text-sm text-danger-700">Please contact the Cleanify office.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="font-semibold text-slate-900">Your account is switched off</p>
            <p className="mt-1 text-sm text-slate-600">Please contact the Cleanify office.</p>
          </div>
        )}

        <div className="flex justify-center">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
