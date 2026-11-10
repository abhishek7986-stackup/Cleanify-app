/**
 * Money and week helpers shared by the payment screens. The real rules and
 * amounts live in the database (see the 20261105000100 migration); nothing here
 * decides what anyone is owed.
 */

/** Matches the cutoff in jobs_awaiting_payment(): jobs finished earlier have no payment. */
export const PAYMENTS_START_AT = "2026-11-05T00:00:00+05:30";

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

export function rupees(value: number | string | null | undefined): string {
  return `₹${inr.format(Number(value ?? 0))}`;
}

function parts(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  const d = parts(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the week holding this YYYY-MM-DD. */
export function mondayOf(date: string): string {
  return addDays(date, -((parts(date).getUTCDay() + 6) % 7));
}

export function shortDate(date: string): string {
  return parts(date).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function weekLabel(monday: string): string {
  return `${shortDate(monday)} to ${shortDate(addDays(monday, 6))}`;
}

/** What the customer's UPI app reads from the QR, with the amount filled in. */
export function upiLink(args: { id: string; name: string; amount: number; jobNumber: string }): string {
  const q = [
    `pa=${encodeURIComponent(args.id).replace("%40", "@")}`,
    `pn=${encodeURIComponent(args.name)}`,
    `am=${args.amount.toFixed(2)}`,
    "cu=INR",
    `tn=${encodeURIComponent(args.jobNumber)}`,
  ];
  return `upi://pay?${q.join("&")}`;
}

/**
 * The weekly slip a worker or supervisor gets on WhatsApp. They have no login,
 * so this message is their record of what they were paid and when the next
 * hike comes. Same figures as the Monday payout card.
 */
export function salarySlip(args: {
  name: string;
  week: string;
  percentNow: number;
  jobCount: number;
  salary: number;
  cashHeld: number;
  broughtForward: number;
  net: number;
  settled: { amount: number; method: string | null; on: string | null; left: number } | null;
  nextRise: string | null;
}): string {
  const lines = [
    `Cleanify salary, ${weekLabel(args.week)}`,
    `${args.name}, ${args.percentNow}% now`,
    `${args.jobCount} ${args.jobCount === 1 ? "job" : "jobs"}, salary ${rupees(args.salary)}`,
  ];
  if (args.cashHeld > 0) lines.push(`Cash you collected: ${rupees(args.cashHeld)}`);
  if (args.broughtForward > 0) lines.push(`Still owed to you from earlier weeks: ${rupees(args.broughtForward)}`);
  if (args.broughtForward < 0) lines.push(`Still to return from earlier weeks: ${rupees(-args.broughtForward)}`);
  lines.push(
    args.net > 0
      ? `Company pays you: ${rupees(args.net)}`
      : args.net < 0
        ? `You return to company: ${rupees(-args.net)}`
        : "Nothing to hand over this week",
  );
  if (args.settled) {
    const s = args.settled;
    if (s.amount !== 0) {
      const how = s.method && s.method !== "none" ? ` by ${s.method === "upi" ? "UPI" : s.method}` : "";
      lines.push(`${s.amount > 0 ? "Paid" : "Returned"} ${rupees(Math.abs(s.amount))}${how}${s.on ? ` on ${s.on}` : ""}.`);
    }
    if (s.left > 0) lines.push(`${rupees(s.left)} still owed to you, added to next week.`);
    if (s.left < 0) lines.push(`${rupees(-s.left)} still to return, added to next week.`);
  }
  if (args.nextRise) lines.push(`From ${shortDate(args.nextRise)} your percentage goes up to ${args.percentNow + 1}%.`);
  return lines.join("\n");
}

/** wa.me wants the number as digits with the country code and no plus sign. */
export function whatsappLink(phone: string, text: string): string | null {
  const digits = phone.replace(/\D/g, "");
  const number = digits.length === 10 ? `91${digits}` : digits;
  if (!/^91[6-9]\d{9}$/.test(number)) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/**
 * For showing on the Team screen only; public.pay_percent() is what pays. The
 * next rise is the anniversary of the joining date, so a preview of a percentage
 * is only ever a label.
 */
export function previewPercent(
  staff: { joined_on: string; start_percent: number; max_percent: number; fixed_percent: number | null },
  on: string,
): { percent: number; nextRise: string | null } {
  const start = Number(staff.start_percent);
  const max = Number(staff.max_percent);
  if (staff.fixed_percent != null) return { percent: Number(staff.fixed_percent), nextRise: null };

  const join = parts(staff.joined_on);
  const now = parts(on);
  let months = (now.getUTCFullYear() - join.getUTCFullYear()) * 12 + now.getUTCMonth() - join.getUTCMonth();
  if (now.getUTCDate() < join.getUTCDate()) months -= 1;
  const percent = Math.max(start, Math.min(max, start + Math.max(0, months)));
  if (percent >= max) return { percent, nextRise: null };

  const next = new Date(join);
  next.setUTCMonth(join.getUTCMonth() + Math.max(0, months) + 1);
  return { percent, nextRise: next.toISOString().slice(0, 10) };
}
