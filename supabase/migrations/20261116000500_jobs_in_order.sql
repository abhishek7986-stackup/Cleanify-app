-- One job at a time, and check-out only at the end of the day.
--
-- 1. A supervisor cannot set off for, or reach, a job while an earlier job
--    that day (by booked time) is still open. "Finished" means approved
--    (COMPLETED), cancelled, or marked no-show by the office.
-- 2. A supervisor cannot check out while any of today's jobs is still open.
--    (This replaces the earlier rule that allowed checking out with open jobs.)
--
-- Both live in triggers, so every path that moves a job or checks out is
-- covered, not only today's screens. An admin is never blocked: they fix
-- things. To release a stuck supervisor the office cancels the job, marks it
-- no-show, or moves it to another day.

create or replace function public.jobs_one_at_a_time()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_prev record;
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
     and j.service_date = new.service_date
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

drop trigger if exists jobs_one_at_a_time on public.jobs;
create trigger jobs_one_at_a_time
  before update of status on public.jobs
  for each row execute function public.jobs_one_at_a_time();

create or replace function public.checkout_after_last_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_open int;
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
  return new;
end;
$fn$;

drop trigger if exists checkout_after_last_job on public.day_rosters;
create trigger checkout_after_last_job
  before update of checked_out_at on public.day_rosters
  for each row execute function public.checkout_after_last_job();
