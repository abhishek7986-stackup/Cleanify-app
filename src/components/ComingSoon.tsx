import Link from "next/link";

/**
 * An honest placeholder. A dead link that 404s is worse than one that says
 * what is coming and what to do in the meantime.
 */
export function ComingSoon({
  title,
  milestone,
  what,
  meanwhile,
  backHref,
}: {
  title: string;
  milestone: string;
  what: string;
  meanwhile?: string;
  backHref: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
      <p className="inline-block rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {milestone}
      </p>
      <h2 className="mt-3 text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-balance text-slate-600">{what}</p>
      {meanwhile ? (
        <p className="mx-auto mt-3 max-w-sm text-balance text-sm text-slate-500">{meanwhile}</p>
      ) : null}
      <Link
        href={backHref}
        className="tap mt-5 inline-flex items-center justify-center rounded-xl border-2 border-slate-300 px-6 font-semibold text-slate-700"
      >
        Go back
      </Link>
    </div>
  );
}
