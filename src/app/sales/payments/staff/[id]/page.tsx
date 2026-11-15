import { notFound } from "next/navigation";
import { requireRole } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { MoneyView } from "@/components/MoneyView";
import { officeNav } from "@/lib/nav";

export const metadata = { title: "Staff money" };
export const dynamic = "force-dynamic";

/** The office's view of one person's money: the same screen they see. */
export default async function StaffMoneyPage(props: PageProps<"/sales/payments/staff/[id]">) {
  const { id } = await props.params;
  const profile = await requireRole("sales_rep");
  const supabase = await createClient();
  const { data: staff } = await supabase.from("pay_staff").select("id, full_name").eq("id", id).maybeSingle();
  if (!staff) notFound();
  return (
    <AppShell profile={profile} title={staff.full_name} back="/sales/payments" nav={officeNav(profile)}>
      <MoneyView staffId={staff.id} self={false} />
    </AppShell>
  );
}
