-- Calling staff fix a payment the supervisor marked wrongly (₹1,000 typed for
-- ₹2,000 received). One step: the wrong rows are cancelled, never deleted, and
-- the right ones are written with the same collection time and week, so the
-- correction lands in the week the money actually came in. The same people get
-- the same percentages, worked out on the corrected amount.
--
-- Refused once that week is paid out, exactly like cancelling: the Monday
-- figures were built on the old amount. Reverse the payout first.

create or replace function public.correct_job_payment(
  p_job_id      uuid,
  p_upi_amount  numeric,
  p_cash_amount numeric,
  p_reason      text
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid       uuid := auth.uid();
  v_upi       numeric := coalesce(p_upi_amount, 0);
  v_cash      numeric := coalesce(p_cash_amount, 0);
  v_total     numeric;
  v_reason    text := nullif(trim(coalesce(p_reason, '')), '');
  v_old       record;
  v_old_total numeric;
  v_sup       uuid;
  v_earn      jsonb;
begin
  if not (public.is_admin() or public.is_sales_rep()) then
    raise exception 'Only calling staff or an admin can correct a payment' using errcode = 'insufficient_privilege';
  end if;
  if v_reason is null then
    raise exception 'Say why the amount is being changed';
  end if;
  if v_upi < 0 or v_cash < 0 then
    raise exception 'Amounts cannot be negative';
  end if;
  v_total := v_upi + v_cash;
  if v_total <= 0 then
    raise exception 'Enter the amount received';
  end if;

  perform 1 from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'Job not found' using errcode = 'no_data_found';
  end if;

  select min(collected_at) as collected_at, min(week_start) as week_start,
         sum(amount) as total, min(note) as note
    into v_old
    from public.payments
   where job_id = p_job_id and voided_at is null;
  if v_old.total is null then
    raise exception 'There is no payment on this job to correct';
  end if;
  v_old_total := v_old.total;

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

  -- Cash stays with whoever held it before; a job paid only by UPI falls back
  -- to the job's supervisor.
  select coalesce(
           (select held_by_staff_id from public.payments
             where job_id = p_job_id and voided_at is null and mode = 'cash' limit 1),
           (select s.id from public.pay_staff s
              join public.jobs j on j.assigned_supervisor_id = s.profile_id
             where j.id = p_job_id))
    into v_sup;
  if v_cash > 0 and v_sup is null then
    raise exception 'This job has no supervisor on the staff list';
  end if;

  update public.payments
     set voided_at = now(), voided_by = v_uid, void_reason = 'Corrected: ' || v_reason
   where job_id = p_job_id and voided_at is null;

  if v_upi > 0 then
    insert into public.payments (job_id, amount, mode, collected_at, recorded_by, note, week_start)
    values (p_job_id, v_upi, 'upi', v_old.collected_at, v_uid, v_old.note, v_old.week_start);
  end if;
  if v_cash > 0 then
    insert into public.payments (job_id, amount, mode, collected_at, recorded_by, note, week_start, held_by_staff_id)
    values (p_job_id, v_cash, 'cash', v_old.collected_at, v_uid, v_old.note, v_old.week_start, v_sup);
  end if;

  -- Same people, same frozen percentage, new amount. Two statements, so the
  -- old rows have left the one-active-row index before the new ones arrive.
  select coalesce(jsonb_agg(jsonb_build_object('staff_id', staff_id, 'percent', percent, 'week_start', week_start)), '[]')
    into v_earn
    from public.job_earnings
   where job_id = p_job_id and voided_at is null;

  update public.job_earnings
     set voided_at = now()
   where job_id = p_job_id and voided_at is null;

  insert into public.job_earnings (job_id, staff_id, percent, base_amount, amount, week_start)
  select p_job_id, (e ->> 'staff_id')::uuid, (e ->> 'percent')::numeric, v_total,
         round(v_total * (e ->> 'percent')::numeric / 100, 2), (e ->> 'week_start')::date
    from jsonb_array_elements(v_earn) e;

  insert into public.job_events (job_id, actor_id, actor_role, event_type, payload)
  values (p_job_id, v_uid, public.app_role(), 'payment.corrected',
          jsonb_build_object('from', v_old_total, 'upi', v_upi, 'cash', v_cash, 'reason', v_reason));

  return v_total;
end;
$fn$;

revoke execute on function public.correct_job_payment(uuid, numeric, numeric, text) from public, anon;
grant execute on function public.correct_job_payment(uuid, numeric, numeric, text) to authenticated;
