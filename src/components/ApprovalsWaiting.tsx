import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";

/**
 * The first thing an approver sees when supervisors are blocked on them.
 * Keeps refreshing so a new request shows up without touching the screen.
 */
export function ApprovalsWaiting({ count }: { count: number }) {
  return (
    <>
      <AutoRefresh seconds={20} />
      {count > 0 ? (
        <Link
          href="/sales/approvals"
          className="flex items-center justify-between gap-3 rounded-2xl border-2 border-warn-100 bg-warn-50 p-4"
        >
          <span>
            <span className="block font-semibold text-warn-700">
              {count} waiting for your approval
            </span>
            <span className="block text-sm text-warn-700">Supervisors cannot continue until you approve.</span>
          </span>
          <span aria-hidden className="text-xl text-warn-700">→</span>
        </Link>
      ) : null}
    </>
  );
}
