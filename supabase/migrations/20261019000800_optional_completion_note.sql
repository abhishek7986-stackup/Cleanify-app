-- ============================================================================
-- Cleanify Ops — 26. The "work done" note is optional
-- ============================================================================
-- Supervisors send the after photos for approval with or without a note; the
-- photos are the evidence. Removed from submit_site_photos and from the
-- completion guard in advance_job_status, so neither path insists on one.
set search_path = public, extensions;

create or replace function public.submit_site_photos(
  p_job_id uuid,
  p_stage  text,                 -- 'before' | 'after'
  p_note   text default null
)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_job     public.jobs;
  v_kind    public.photo_kind;
  v_missing int;
begin
  if p_stage not in ('before', 'after') then
    raise exception 'Stage must be before or after' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'Job not found' using errcode = 'no_data_found';
  end if;
  if v_job.assigned_supervisor_id is distinct from v_uid and not public.is_admin() then
    raise exception 'Only the assigned supervisor can do that' using errcode = 'insufficient_privilege';
  end if;

  if p_stage = 'before' then
    if v_job.status <> 'ON_SITE' then
      raise exception 'Mark the site reached first' using errcode = 'check_violation';
    end if;
    if v_job.before_review in ('PENDING', 'APPROVED') then
      raise exception 'The before photos are already %', lower(v_job.before_review::text)
        using errcode = 'check_violation';
    end if;
    v_kind := 'SITE_BEFORE';
  else
    if v_job.status <> 'IN_PROGRESS' then
      raise exception 'Start the cleaning first' using errcode = 'check_violation';
    end if;
    if v_job.after_review in ('PENDING', 'APPROVED') then
      raise exception 'The after photos are already %', lower(v_job.after_review::text)
        using errcode = 'check_violation';
    end if;
    v_kind := 'SITE_AFTER';
  end if;

  select count(*) into v_missing from public.job_line_items li
   where li.job_id = p_job_id
     and not exists (select 1 from public.photos p
                      where p.job_line_item_id = li.id and p.kind = v_kind
                        and p.replaced_at is null);
  if v_missing > 0 then
    raise exception '% item(s) still need a % photo', v_missing, p_stage
      using errcode = 'check_violation';
  end if;

  if p_stage = 'before' then
    update public.jobs
       set before_review = 'PENDING', before_submitted_at = now(),
           before_reviewed_by = null, before_reviewed_at = null, before_rejection_reason = null
     where id = p_job_id returning * into v_job;
  else
    update public.job_line_items set is_done = true, done_at = coalesce(done_at, now())
     where job_id = p_job_id and not is_done;
    update public.jobs
       set after_review = 'PENDING', after_submitted_at = now(), completion_note = nullif(trim(p_note), ''),
           after_reviewed_by = null, after_reviewed_at = null, after_rejection_reason = null
     where id = p_job_id returning * into v_job;
  end if;

  insert into public.job_events (job_id, actor_id, actor_role, event_type, payload)
  values (p_job_id, v_uid, public.app_role(), 'photos.' || p_stage || '.submitted',
          jsonb_build_object('note', p_note));

  return v_job;
end;
$fn$;

create or replace function public.advance_job_status(
  p_job_id uuid,
  p_to     public.job_status,
  p_meta   jsonb default '{}'::jsonb
)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_job    public.jobs;
  v_t      record;
  v_role   public.user_role;
  v_uid    uuid := auth.uid();
  v_undone int;
  v_roster record;
  v_point  extensions.geography;
begin
  v_role := public.app_role();
  if v_uid is null or v_role is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'Job not found' using errcode = 'no_data_found';
  end if;

  select * into v_t from public.job_status_transitions
   where from_status = v_job.status and to_status = p_to;
  if not found then
    raise exception 'Illegal transition % -> %', v_job.status, p_to
      using errcode = 'check_violation';
  end if;

  if not (v_role = any (v_t.allowed_roles)) then
    raise exception '% may not move a job from % to %', v_role, v_job.status, p_to
      using errcode = 'insufficient_privilege';
  end if;

  if v_t.requires_assignment and v_job.assigned_supervisor_id is distinct from v_uid
     and v_role <> 'admin' then
    raise exception 'Only the assigned supervisor can do that'
      using errcode = 'insufficient_privilege';
  end if;

  if v_t.requires_ownership and v_job.created_by_sales_rep_id is distinct from v_uid
     and v_role <> 'admin' then
    raise exception 'Only the sales rep who created this job can do that'
      using errcode = 'insufficient_privilege';
  end if;

  -- ----------------------------------------------------------------- guards
  if v_t.guard = 'checkin_complete' then
    select * into v_roster from public.day_rosters
     where supervisor_id = v_job.assigned_supervisor_id
       and roster_date = v_job.service_date
       and voided_at is null;
    if not found or v_roster.submitted_at is null then
      raise exception 'Check in at the depot first' using errcode = 'check_violation';
    end if;
    if v_roster.approval_status <> 'APPROVED' and v_role <> 'admin' then
      raise exception 'Your depot check-in is waiting for approval'
        using errcode = 'check_violation';
    end if;

  elsif v_t.guard = 'before_approved' then
    if v_job.before_review is distinct from 'APPROVED' and v_role <> 'admin' then
      raise exception 'The before photos need approval before you start'
        using errcode = 'check_violation';
    end if;

  elsif v_t.guard = 'completion_ready' then
    if v_job.after_review is distinct from 'APPROVED' then
      raise exception 'The after photos need admin approval' using errcode = 'check_violation';
    end if;
    select count(*) into v_undone from public.job_line_items
     where job_id = p_job_id and is_done = false;
    if v_undone > 0 then
      raise exception '% item(s) on this job are not marked done', v_undone
        using errcode = 'check_violation';
    end if;
  end if;

  -- Where were they when they said "reached"? Recorded, never enforced.
  if p_to = 'ON_SITE' and (p_meta ? 'lat') and (p_meta ? 'lng') then
    begin
      v_point := extensions.st_setsrid(
                   extensions.st_makepoint((p_meta ->> 'lng')::float8, (p_meta ->> 'lat')::float8),
                   4326)::extensions.geography;
    exception when others then
      v_point := null;
    end;
  end if;

  -- ----------------------------------------------------------- side effects
  update public.jobs
     set status = p_to,
         actual_departure_at = case when p_to = 'EN_ROUTE'    then now() else actual_departure_at end,
         arrived_at          = case when p_to = 'ON_SITE'     then now() else arrived_at end,
         arrived_location    = case when p_to = 'ON_SITE'     then v_point else arrived_location end,
         arrived_accuracy_m  = case when p_to = 'ON_SITE'     then (p_meta ->> 'accuracy_m')::numeric
                                    else arrived_accuracy_m end,
         arrived_distance_m  = case when p_to = 'ON_SITE' and v_point is not null
                                    then extensions.st_distance(v_point, site_location)
                                    else arrived_distance_m end,
         actual_start_at     = case when p_to = 'IN_PROGRESS' then now() else actual_start_at end,
         actual_end_at       = case when p_to = 'COMPLETED'   then now() else actual_end_at end,
         completed_at        = case when p_to = 'COMPLETED'   then now() else completed_at end,
         completion_note     = coalesce(p_meta ->> 'completion_note', completion_note)
   where id = p_job_id
   returning * into v_job;

  insert into public.job_events (job_id, actor_id, actor_role, event_type,
                                 from_status, to_status, payload)
  values (p_job_id, v_uid, v_role, 'status.changed',
          v_t.from_status, p_to,
          p_meta || case when p_to = 'ON_SITE' and v_job.arrived_distance_m is not null
                         then jsonb_build_object('distance_from_pin_m', round(v_job.arrived_distance_m))
                         else '{}'::jsonb end);

  if p_to in ('COMPLETED','CANCELLED','NO_SHOW') then
    perform public.cancel_pending_notifications(p_job_id, null, null);
  end if;

  return v_job;
end;
$fn$;
