import Link from "next/link";
import type { Profile } from "@/lib/domain/database";
import { SignOutButton } from "./SignOutButton";
import { QueueChip } from "./QueueChip";

/**
 * A visible "signed in as" chip is not decoration. Field staff share phones,
 * and a shared handset that silently attributes a check-in to the wrong
 * supervisor poisons the audit trail this whole app exists to produce.
 */
export function AppShell({
  profile,
  title,
  nav,
  children,
}: {
  profile: Profile;
  title: string;
  nav?: { href: string; label: string }[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 pb-3 pt-[calc(var(--safe-top)+0.75rem)]">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-slate-900">{title}</h1>
            <p className="truncate text-xs text-slate-500">
              Signed in as {profile.full_name} · {roleLabel(profile.role)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <QueueChip />
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">{children}</main>

      {nav && nav.length > 0 ? (
        <nav className="sticky bottom-0 border-t border-slate-200 bg-white/95 backdrop-blur">
          <ul className="mx-auto flex w-full max-w-3xl pb-[var(--safe-bottom)]">
            {nav.map((item) => (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  className="tap flex items-center justify-center px-2 text-sm font-medium text-slate-700"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}

function roleLabel(role: Profile["role"]): string {
  return role === "admin" ? "Admin" : role === "sales_rep" ? "Sales" : "Supervisor";
}
