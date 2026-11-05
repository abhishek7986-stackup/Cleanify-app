import Link from "next/link";

const TABS = [
  { key: "payments", href: "/sales/payments", label: "Payments" },
  { key: "payouts", href: "/sales/payouts", label: "Monday payout" },
  { key: "team", href: "/sales/team", label: "Team %" },
] as const;

export function OfficeTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="Payment sections" className="grid grid-cols-3 gap-2">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={`tap flex items-center justify-center rounded-xl border-2 px-1 text-center text-sm font-semibold ${
            t.key === active ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-600"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
