-- Supervisors work day by day: only today's jobs can be moved forward, paid,
-- or checked out. A past day is closed in the app (the office fixes it), and a
-- later day opens on its own day. Admins and the scheduler are never blocked.

create or replace function public.jobs_today_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  -- service_date is generated, so it is not filled in yet in a BEFORE trigger.
  v_day date := (new.scheduled_start at time zone 'Asia/Kolkata')::date;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if new.status is not distinct from old.status
     or public.app_role() is distinct from 'supervisor' then
    return new;
  end if;
  if v_day < v_today then
    raise exception 'This job was on %. Past days cannot be changed in the app; call the office.', to_char(v_day, 'DD Mon')
      using errcode = 'check_violation';
  end if;
  if v_day > v_today then
    raise exception 'This job is on %. It opens on that day.', to_char(v_day, 'DD Mon')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists jobs_today_only on public.jobs;
create trigger jobs_today_only
  before update of status on public.jobs
  for each row execute function public.jobs_today_only();

-- Marking a payment: today's jobs only, for the supervisor.
create or replace function public.record_job_payment_with_proof(
  p_job_id      uuid,
  p_upi_amount  numeric,
  p_cash_amount numeric,
  p_worker_ids  uuid[] default '{}',
  p_note        text default null,
  p_proof_kind  text default null,
  p_proof_path  text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_day date;
begin
  select service_date into v_day from public.jobs where id = p_job_id;
  if public.app_role() = 'supervisor' and v_day is distinct from (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Payments can only be marked on the day of the job. Call the office to sort out this one.'
      using errcode = 'check_violation';
  end if;
  if coalesce(p_upi_amount, 0) > 0 and p_proof_kind is null then
    raise exception 'Add proof of the UPI payment: a photo, a screenshot, or call the office';
  end if;
  perform public.record_job_payment(p_job_id, p_upi_amount, p_cash_amount, p_worker_ids, p_note);
  if coalesce(p_upi_amount, 0) > 0 then
    perform public.attach_payment_proof(p_job_id, p_proof_kind, p_proof_path);
  end if;
end;
$fn$;

-- The plain version skips the proof, so the app no longer calls it directly;
-- only the function above (and the office's correction) use it.
revoke execute on function public.record_job_payment(uuid, numeric, numeric, uuid[], text) from authenticated;

-- Check-out: today's roster only. A day nobody checked out of stays open, and
-- the office sees it as "did not check out".
create or replace function public.checkout_after_last_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_open   int;
  v_unpaid int;
begin
  if old.checked_out_at is not null or new.checked_out_at is null
     or public.app_role() is distinct from 'supervisor' then
    return new;
  end if;

  if new.roster_date <> (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Check-out is only for today. Call the office about %.', to_char(new.roster_date, 'DD Mon')
      using errcode = 'check_violation';
  end if;

  select count(*) into v_open
    from public.jobs
   where assigned_supervisor_id = new.supervisor_id
     and service_date = new.roster_date
     and status not in ('COMPLETED', 'CANCELLED', 'NO_SHOW', 'DRAFT');
  if v_open > 0 then
    raise exception 'Check out after your last job. % job(s) today still waiting to be finished and approved.', v_open
      using errcode = 'check_violation';
  end if;

  select count(*) into v_unpaid
    from public.jobs j
   where j.assigned_supervisor_id = new.supervisor_id
     and j.service_date = new.roster_date
     and j.service_date >= date '2026-11-05'
     and j.status = 'COMPLETED'
     and not exists (select 1 from public.payments p where p.job_id = j.id and p.voided_at is null);
  if v_unpaid > 0 then
    raise exception 'Mark the payment first. % job(s) today have no payment marked. If the customer has not paid, call the office.', v_unpaid
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;
