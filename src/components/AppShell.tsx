import Link from "next/link";
import type { Profile } from "@/lib/domain/database";
import { SignOutButton } from "./SignOutButton";
import { QueueChip } from "./QueueChip";
import { BottomNav } from "./BottomNav";
import { LocationSharer } from "./LocationSharer";

/**
 * The app bar: deep teal, white type, like a delivery-partner app's shift bar.
 *
 * A visible "signed in as" line is not decoration. Field staff share phones,
 * and a shared handset that silently attributes a check-in to the wrong
 * supervisor poisons the audit trail this whole app exists to produce.
 *
 * `status` is an optional strip under the title (the supervisor's shift state).
 * `action` is the fixed bar above the tabs naming the one next step.
 * `back` turns the screen into a focused task (check-in, a job): a back arrow
 * in place of the tab bar, so nothing else competes with the one job.
 */
export function AppShell({
  profile,
  title,
  nav,
  back,
  status,
  action,
  children,
}: {
  profile: Profile;
  title: string;
  nav?: { href: string; label: string }[];
  back?: string;
  status?: React.ReactNode;
  /** The one next step, fixed above the tab bar (the delivery-app action bar). */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 bg-brand-950 text-white">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-1 px-2 pb-2 pt-[calc(var(--safe-top)+0.5rem)]">
          {back ? (
            <Link
              href={back}
              aria-label="Back"
              className="flex size-12 shrink-0 items-center justify-center rounded-full text-white active:bg-white/10"
            >
              <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M19 12H5M11 18l-6-6 6-6" />
              </svg>
            </Link>
          ) : (
            <span className="w-2 shrink-0" aria-hidden />
          )}
          <div className="min-w-0 flex-1 py-1">
            <h1 className="truncate text-[1.25rem] font-semibold leading-tight tracking-[-0.01em]">{title}</h1>
            <p className="mt-0.5 flex min-w-0 items-center gap-2 text-[0.8125rem] text-white/75">
              <span className="truncate">
                {profile.full_name} · {roleLabel(profile)}
              </span>
              {/* Supervisors only: shares position with the office while on duty. */}
              {profile.role === "supervisor" ? <LocationSharer /> : null}
            </p>
          </div>
          <div className="flex shrink-0 items-center">
            <QueueChip />
            <SignOutButton />
          </div>
        </div>
        {status ? <div className="mx-auto w-full max-w-3xl px-4 pb-3">{status}</div> : null}
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">{children}</main>

      {action || (nav && nav.length > 0 && !back) ? (
        <div className="sticky bottom-0 z-30">
          {action ? (
            <div className="border-t border-brand-950/10 bg-white px-4 py-3 shadow-[0_-4px_16px_rgb(11_53_50/0.06)]">
              <div className="mx-auto w-full max-w-3xl">{action}</div>
            </div>
          ) : null}
          {nav && nav.length > 0 && !back ? <BottomNav items={nav} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function roleLabel({ role, is_super_admin }: Profile): string {
  if (is_super_admin) return "Super admin";
  return role === "admin" ? "Admin" : role === "sales_rep" ? "Sales" : "Supervisor";
}
