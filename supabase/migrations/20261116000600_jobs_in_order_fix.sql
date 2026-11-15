-- Fix for 20261116000500: jobs.service_date is a generated column, and a
-- generated column is still NULL inside a BEFORE trigger, so the "earlier
-- job still open" search matched nothing. Work the day out from the booked
-- start time in IST instead, exactly as service_date itself is derived.

create or replace function public.jobs_one_at_a_time()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_prev record;
  v_day  date := (new.scheduled_start at time zone 'Asia/Kolkata')::date;
begin
  if new.status is not distinct from old.status
     or new.status not in ('CHECKED_IN', 'EN_ROUTE', 'ON_SITE')
     or public.app_role() is distinct from 'supervisor' then
    return new;
  end if;

  select j.job_number, c.name as client_name
    into v_prev
    from public.jobs j
    left join public.clients c on c.id = j.client_id
   where j.assigned_supervisor_id = new.assigned_supervisor_id
     and j.service_date = v_day
     and j.id <> new.id
     and (j.scheduled_start, j.created_at) < (new.scheduled_start, new.created_at)
     and j.status not in ('COMPLETED', 'CANCELLED', 'NO_SHOW', 'DRAFT')
   order by j.scheduled_start, j.created_at
   limit 1;

  if found then
    raise exception 'Finish % first (%). The next job opens once it is approved.',
      coalesce(v_prev.client_name, 'the earlier job'), v_prev.job_number
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;
