import Link from "next/link";

/** The way into the "Team now" map from the office's Today screens. */
export function TeamNowLink() {
  return (
    <Link href="/sales/live" className="card flex items-center gap-3 p-4 active:scale-[0.99]">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-900">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11ZM12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-slate-900">Team now</span>
        <span className="block text-sm text-slate-500">Where each supervisor is, live while on duty</span>
      </span>
      <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m9 5 7 7-7 7" />
      </svg>
    </Link>
  );
}
