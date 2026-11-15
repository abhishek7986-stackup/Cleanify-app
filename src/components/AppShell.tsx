import Link from "next/link";
import type { Profile } from "@/lib/domain/database";
import { SignOutButton } from "./SignOutButton";
import { QueueChip } from "./QueueChip";
import { BottomNav } from "./BottomNav";

/**
 * A visible "signed in as" chip is not decoration. Field staff share phones,
 * and a shared handset that silently attributes a check-in to the wrong
 * supervisor poisons the audit trail this whole app exists to produce.
 *
 * `back` turns the screen into a focused task (check-in, check-out): a back
 * arrow in place of the tab bar, so nothing else competes with the one job.
 */
export function AppShell({
  profile,
  title,
  nav,
  back,
  children,
}: {
  profile: Profile;
  title: string;
  nav?: { href: string; label: string }[];
  back?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 bg-canvas/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 pb-2.5 pt-[calc(var(--safe-top)+0.625rem)]">
          {back ? (
            <Link
              href={back}
              aria-label="Back"
              className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-slate-700 active:bg-slate-100"
            >
              <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m15 5-7 7 7 7" />
              </svg>
            </Link>
          ) : null}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[1.375rem] font-bold tracking-tight text-slate-950">{title}</h1>
            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
              <span
                className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-brand-900 text-[9px] font-bold text-white"
                aria-hidden
              >
                {initials(profile.full_name)}
              </span>
              <span className="truncate">
                {profile.full_name} · {roleLabel(profile)}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <QueueChip />
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">{children}</main>

      {nav && nav.length > 0 && !back ? <BottomNav items={nav} /> : null}
    </div>
  );
}

function initials(name: string): string {
  const parts = name.replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function roleLabel({ role, is_super_admin }: Profile): string {
  if (is_super_admin) return "Super admin";
  return role === "admin" ? "Admin" : role === "sales_rep" ? "Sales" : "Supervisor";
}
