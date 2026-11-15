"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The tab bar along the bottom, like a phone app: an icon over each label, and
 * the current tab picked out. The most specific matching tab wins, so
 * /sales/payments lights Payments rather than Today (/sales).
 */
export function BottomNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname() ?? "";
  const active = items
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav className="sticky bottom-0 z-30 border-t border-slate-900/[0.06] bg-white/90 backdrop-blur-md">
      <ul className="mx-auto flex w-full max-w-3xl pb-[var(--safe-bottom)]">
        {items.map((item) => {
          const on = item.href === active;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={`flex min-h-[3.75rem] flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-semibold ${
                  on ? "text-brand-700" : "text-slate-500"
                }`}
              >
                <span
                  className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${
                    on ? "bg-brand-100" : ""
                  }`}
                >
                  <NavIcon label={item.label} />
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const PATHS: Record<string, React.ReactNode> = {
  today: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  roadmap: (
    <>
      <path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4Z" />
      <path d="M9 4v13M15 6.5v13" />
    </>
  ),
  history: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  payments: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18" />
      <path d="M16 15h2" />
    </>
  ),
  "new job": (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  approvals: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6L12 3Z" />
      <path d="m8.8 12 2.2 2.2 4.2-4.4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8" />
      <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.6c1.6.6 2.7 2.2 3 4.4" />
    </>
  ),
};

function NavIcon({ label }: { label: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[label.toLowerCase()] ?? <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}
