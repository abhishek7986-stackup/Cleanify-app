-- Live location while a supervisor is on the clock.
--
-- While the app is open, the supervisor's phone reports where it is about once
-- a minute. It is accepted ONLY between that day's depot check-in and
-- check-out, so nothing is collected off duty. The office sees each
-- supervisor's latest position on the "Team now" map.
--
-- A web app cannot report when it is closed or the phone is locked; the map
-- says how long ago each position was, so a stale one is obvious.
-- Pings older than 30 days are deleted.

create table if not exists public.location_pings (
  id            bigint generated always as identity primary key,
  supervisor_id uuid not null references public.profiles(id) on delete cascade,
  roster_id     uuid not null references public.day_rosters(id) on delete cascade,
  lat           double precision not null check (lat between -90 and 90),
  lng           double precision not null check (lng between -180 and 180),
  accuracy_m    numeric,
  recorded_at   timestamptz not null default now()
);

create index if not exists location_pings_latest_idx
  on public.location_pings (supervisor_id, recorded_at desc);

alter table public.location_pings enable row level security;

drop policy if exists location_pings_read on public.location_pings;
create policy location_pings_read on public.location_pings
  for select to authenticated
  using (public.is_admin() or public.is_sales_rep() or supervisor_id = auth.uid());

revoke all on public.location_pings from anon, authenticated;
grant select on public.location_pings to authenticated;

-- The phone's report. Returns whether it was kept, so the screen can say
-- "sharing" only when it really is.
create or replace function public.report_location(
  p_lat        double precision,
  p_lng        double precision,
  p_accuracy_m numeric default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_roster uuid;
  v_last   timestamptz;
begin
  if public.app_role() is distinct from 'supervisor' then
    return false;
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    return false;
  end if;

  -- On duty: today's (IST) check-in is in, check-out is not.
  select r.id into v_roster
    from public.day_rosters r
   where r.supervisor_id = v_uid
     and r.roster_date = (now() at time zone 'Asia/Kolkata')::date
     and r.voided_at is null
     and r.submitted_at is not null
     and r.checked_out_at is null
   limit 1;
  if v_roster is null then
    return false;
  end if;

  -- At most one every 45 seconds, however often the phone asks.
  select max(recorded_at) into v_last from public.location_pings where supervisor_id = v_uid;
  if v_last is not null and v_last > now() - interval '45 seconds' then
    return true;
  end if;

  insert into public.location_pings (supervisor_id, roster_id, lat, lng, accuracy_m)
  values (v_uid, v_roster, p_lat, p_lng, p_accuracy_m);

  -- Housekeeping, cheap with the index: nothing older than 30 days.
  delete from public.location_pings
   where supervisor_id = v_uid and recorded_at < now() - interval '30 days';
  return true;
end;
$fn$;

revoke execute on function public.report_location(double precision, double precision, numeric) from public, anon;
grant execute on function public.report_location(double precision, double precision, numeric) to authenticated;

-- For the office: every supervisor with a check-in today, their latest
-- position (if any), and whether they are still on duty.
create or replace function public.team_locations()
returns table (
  supervisor_id uuid,
  full_name     text,
  lat           double precision,
  lng           double precision,
  accuracy_m    numeric,
  recorded_at   timestamptz,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  jobs_total    int,
  jobs_done     int
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not (public.is_admin() or public.is_sales_rep()) then
    raise exception 'Only calling staff or an admin can see the team map' using errcode = 'insufficient_privilege';
  end if;

  return query
  select r.supervisor_id, p.full_name,
         lp.lat, lp.lng, lp.accuracy_m, lp.recorded_at,
         r.submitted_at, r.checked_out_at,
         (select count(*)::int from public.jobs j
           where j.assigned_supervisor_id = r.supervisor_id and j.service_date = r.roster_date
             and j.status not in ('CANCELLED','NO_SHOW','DRAFT')),
         (select count(*)::int from public.jobs j
           where j.assigned_supervisor_id = r.supervisor_id and j.service_date = r.roster_date
             and j.status = 'COMPLETED')
    from public.day_rosters r
    join public.profiles p on p.id = r.supervisor_id
    left join lateral (
      select l.lat, l.lng, l.accuracy_m, l.recorded_at
        from public.location_pings l
       where l.supervisor_id = r.supervisor_id and l.roster_id = r.id
       order by l.recorded_at desc
       limit 1
    ) lp on true
   where r.roster_date = (now() at time zone 'Asia/Kolkata')::date
     and r.voided_at is null
     and r.submitted_at is not null
   order by p.full_name;
end;
$fn$;

revoke execute on function public.team_locations() from public, anon;
grant execute on function public.team_locations() to authenticated;
