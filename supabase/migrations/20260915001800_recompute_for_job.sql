-- ============================================================================
-- Cleanify Ops — 18. Let the booking screen resolve its own deadline
--
-- recompute_day() is service_role only, so after creating a job the sales rep
-- had to wait for the next pg_cron tick — up to a minute of "still being
-- calculated" on the screen where they most want the answer.
--
-- This is a deliberately narrow way through: it recomputes ONLY the day of a
-- job the caller is already allowed to see, and nothing else. The blast radius
-- is one supervisor-day.
--
-- On the Maps-billing worry that made recompute_day privileged in the first
-- place: travel_lookup reads through the (origin cell, dest cell, weekday,
-- hour) cache, so calling this repeatedly for the same day costs nothing after
-- the first. The coalescing queue still protects the background path.
-- ============================================================================
set search_path = public, extensions;

create or replace function public.recompute_for_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_sup  uuid;
  v_date date;
begin
  if not public.can_see_job(p_job_id) then
    raise exception 'Not your job' using errcode = 'insufficient_privilege';
  end if;

  select assigned_supervisor_id, service_date
    into v_sup, v_date
    from public.jobs where id = p_job_id;

  if v_sup is null or v_date is null then
    return jsonb_build_object('skipped', 'job is unassigned');
  end if;

  return public.recompute_day(v_sup, v_date);
end;
$fn$;

grant execute on function public.recompute_for_job(uuid) to authenticated;
