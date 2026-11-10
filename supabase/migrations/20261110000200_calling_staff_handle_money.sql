-- Calling staff (sales_rep) look after all the money: the company UPI ID,
-- checking UPI against the bank, cancelling a wrong payment, and settling or
-- reversing the Monday payout. There is no separate person for this, so the
-- super-admin-only and admin-only gates from 20261105000100 now let calling
-- staff through too. Admins keep every power they had.
--
-- Bodies are unchanged apart from the permission check.


create or replace function public.verify_upi_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_job uuid;
begin
  if not (public.is_admin() or public.is_sales_rep()) then
    raise exception 'Only calling staff or an admin can check payments' using errcode = 'insufficient_privilege';
  end if;
  update public.payments
     set verified_at = now(), verified_by = auth.uid()
   where id = p_payment_id and mode = 'upi' and voided_at is null and verified_at is null
  returning job_id into v_job;
  if v_job is null then
    raise exception 'This payment is already checked or cancelled';
  end if;
  insert into public.job_events (job_id, actor_id, actor_role, event_type, payload)
  values (v_job, auth.uid(), public.app_role(), 'payment.verified',
          jsonb_build_object('payment_id', p_payment_id));
end;
$fn$;

create or replace function public.void_job_payment(p_job_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not (public.is_admin() or public.is_sales_rep()) then
    raise exception 'Only calling staff or an admin can cancel a payment' using errcode = 'insufficient_privilege';
  end if;
  if v_reason is null then
    raise exception 'Give a reason for cancelling';
  end if;
  if not exists (select 1 from public.payments where job_id = p_job_id and voided_at is null) then
    raise exception 'There is no payment to cancel on this job';
  end if;
  if exists (
    select 1
      from public.job_earnings e
      join public.payouts o on o.staff_id = e.staff_id
                           and o.week_start >= e.week_start
                           and o.reversed_at is null
     where e.job_id = p_job_id and e.voided_at is null
  ) then
    raise exception 'That week is already paid out. Reverse the payout first.';
  end if;

  update public.payments
     set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
   where job_id = p_job_id and voided_at is null;
  update public.job_earnings
     set voided_at = now()
   where job_id = p_job_id and voided_at is null;

  insert into public.job_events (job_id, actor_id, actor_role, event_type, payload)
  values (p_job_id, auth.uid(), public.app_role(), 'payment.voided',
          jsonb_build_object('reason', v_reason));
end;
$fn$;

create or replace function public.settle_payout(
  p_staff_id uuid,
  p_week     date,
  p_amount   numeric,
  p_method   text,
  p_note     text default null
)
returns public.payouts
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_week   date := date_trunc('week', p_week::timestamp)::date;
  v_earned numeric;
  v_cash   numeric;
  v_bf     numeric;
  v_net    numeric;
  v_signed numeric;
  v_row    public.payouts;
begin
  if not (public.is_admin() or public.is_sales_rep()) then
    raise exception 'Only calling staff or an admin can settle a payout' using errcode = 'insufficient_privilege';
  end if;
  if v_week >= public.ist_week_start() then
    raise exception 'This week is not over yet. Payouts are for finished weeks.';
  end if;
  if p_method not in ('cash', 'upi', 'bank', 'none') then
    raise exception 'Choose how the money was handed over';
  end if;

  -- Serialises two people settling the same person at once.
  perform 1 from public.pay_staff where id = p_staff_id for update;
  if not found then
    raise exception 'Staff member not found';
  end if;
  if exists (select 1 from public.payouts
              where staff_id = p_staff_id and week_start >= v_week and reversed_at is null) then
    raise exception 'This week or a later one is already settled for this person';
  end if;

  select coalesce(sum(amount), 0) into v_earned from public.job_earnings
   where staff_id = p_staff_id and week_start = v_week and voided_at is null;
  select coalesce(sum(amount), 0) into v_cash from public.payments
   where held_by_staff_id = p_staff_id and mode = 'cash' and week_start = v_week and voided_at is null;
  v_bf  := public.pay_brought_forward(p_staff_id, v_week);
  v_net := v_bf + v_earned - v_cash;

  if p_amount is null or p_amount < 0 then
    raise exception 'Enter the amount handed over';
  end if;
  if p_amount > abs(v_net) then
    raise exception 'That is more than the ₹% due', abs(v_net);
  end if;
  if p_amount = 0 and p_method <> 'none' then
    raise exception 'Enter the amount handed over';
  end if;

  v_signed := case when v_net < 0 then -p_amount else p_amount end;

  insert into public.payouts (staff_id, week_start, brought_forward, earned, cash_held, net_due,
                              settled_amount, carry_forward, method, note, settled_by)
  values (p_staff_id, v_week, v_bf, v_earned, v_cash, v_net,
          v_signed, v_net - v_signed, p_method, nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  returning * into v_row;
  return v_row;
end;
$fn$;

create or replace function public.reverse_payout(p_payout_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.payouts;
begin
  if not (public.is_admin() or public.is_sales_rep()) then
    raise exception 'Only calling staff or an admin can reverse a payout' using errcode = 'insufficient_privilege';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Give a reason for reversing';
  end if;
  select * into v_row from public.payouts where id = p_payout_id and reversed_at is null for update;
  if not found then
    raise exception 'This payout is already reversed';
  end if;
  if exists (select 1 from public.payouts
              where staff_id = v_row.staff_id and week_start > v_row.week_start and reversed_at is null) then
    raise exception 'A later week is settled for this person. Reverse that one first.';
  end if;
  update public.payouts
     set reversed_at = now(), reversed_by = auth.uid(), reverse_reason = trim(p_reason)
   where id = p_payout_id;
end;
$fn$;

create or replace function public.set_upi_details(p_upi_id text, p_payee_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not (public.is_admin() or public.is_sales_rep()) then
    raise exception 'Only calling staff or an admin can change the UPI details' using errcode = 'insufficient_privilege';
  end if;
  if trim(coalesce(p_upi_id, '')) !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception 'That does not look like a UPI ID. It should look like name@bank.';
  end if;
  if nullif(trim(coalesce(p_payee_name, '')), '') is null then
    raise exception 'Enter the name customers should see';
  end if;
  insert into public.app_settings (key, value, description, updated_by, updated_at)
  values ('payments.upi', jsonb_build_object('id', trim(p_upi_id), 'name', trim(p_payee_name)),
          'UPI ID and name shown in the customer QR.', auth.uid(), now())
  on conflict (key) do update
    set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
end;
$fn$;
