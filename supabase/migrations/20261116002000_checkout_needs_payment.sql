-- Check-out also waits for money: every finished job of the day must have its
-- payment marked (UPI with proof, or cash) before the supervisor can leave.
-- If a customer has not paid, the office sorts it out; the supervisor cannot
-- close the day with a job's money unaccounted for.
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
