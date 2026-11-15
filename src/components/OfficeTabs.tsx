import Link from "next/link";

const TABS = [
  { key: "payments", href: "/sales/payments", label: "Payments" },
  { key: "payouts", href: "/sales/payouts", label: "Monday payout" },
  { key: "team", href: "/sales/team", label: "Team %" },
] as const;

export function OfficeTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="Payment sections" className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-900/[0.05] p-1">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={`flex min-h-11 items-center justify-center rounded-xl px-1 text-center text-sm font-semibold leading-tight ${
            t.key === active ? "bg-white text-slate-900 shadow-[0_1px_2px_rgb(15_23_42/0.08),0_0_0_1px_rgb(15_23_42/0.06)]" : "text-slate-500"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
