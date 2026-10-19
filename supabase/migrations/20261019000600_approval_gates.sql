-- ============================================================================
-- Cleanify Ops — 24. Approval gates for the supervisor's day
-- ============================================================================
-- How the field team actually works:
--
--   depot photos  -> APPROVED -> location unlocked, Start trip / I've reached
--   reached site  -> before photos + tank details -> APPROVED -> start cleaning
--   cleaned       -> after photos + note           -> APPROVED by admin -> done
--
-- "Reached" records where the supervisor really was but never blocks: the
-- client's shared pin is often wrong and the address gets fixed over the
-- phone. The distance is kept so an admin can see it.
--
-- Approvals live on the job as two small review records (before / after)
-- rather than as new statuses, so the status machine and every report built
-- on it stay unchanged.
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- columns
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists arrived_location        extensions.geography(point, 4326),
  add column if not exists arrived_accuracy_m      numeric,
  add column if not exists arrived_distance_m      numeric,
  add column if not exists before_review           public.approval_status,
  add column if not exists before_submitted_at     timestamptz,
  add column if not exists before_reviewed_by      uuid references public.profiles(id),
  add column if not exists before_reviewed_at      timestamptz,
  add column if not exists before_rejection_reason text,
  add column if not exists after_review            public.approval_status,
  add column if not exists after_submitted_at      timestamptz,
  add column if not exists after_reviewed_by       uuid references public.profiles(id),
  add column if not exists after_reviewed_at       timestamptz,
  add column if not exists after_rejection_reason  text;

comment on column public.jobs.before_review is
  'null = before photos not sent yet. PENDING / APPROVED / REJECTED after.';

-- Approvers list what is waiting; keep that an index lookup.
create index if not exists jobs_before_pending_idx on public.jobs (before_submitted_at)
  where before_review = 'PENDING';
create index if not exists jobs_after_pending_idx on public.jobs (after_submitted_at)
  where after_review = 'PENDING';

-- Starting work now needs the before photos approved.
update public.job_status_transitions
   set guard = 'before_approved',
       note  = 'Before photos and tank details approved by sales or admin.'
 where from_status = 'ON_SITE' and to_status = 'IN_PROGRESS';

update public.job_status_transitions
   set note = 'Done by review_site_photos() when an admin approves the after photos.'
 where from_status = 'IN_PROGRESS' and to_status = 'COMPLETED';

-- ---------------------------------------------------------------------------
-- advance_job_status: new guards, and "reached" records the location.
-- ---------------------------------------------------------------------------
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
    if coalesce(trim(coalesce(p_meta ->> 'completion_note', v_job.completion_note, '')), '') = '' then
      raise exception 'A completion note is required' using errcode = 'check_violation';
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

-- ---------------------------------------------------------------------------
-- update_unit_details — the supervisor corrects tank details on site.
-- Supervisors have no UPDATE on details (column grant), so it goes through
-- here; the existing trigger still validates against the pinned schema.
-- ---------------------------------------------------------------------------
create or replace function public.update_unit_details(p_item_id uuid, p_details jsonb)
returns public.job_line_items
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_job  public.jobs;
  v_item public.job_line_items;
begin
  select j.* into v_job from public.jobs j
    join public.job_line_items li on li.job_id = j.id
   where li.id = p_item_id
   for update of j;
  if not found then
    raise exception 'Item not found' using errcode = 'no_data_found';
  end if;
  if v_job.assigned_supervisor_id is distinct from v_uid and not public.is_admin() then
    raise exception 'Only the assigned supervisor can do that' using errcode = 'insufficient_privilege';
  end if;
  if v_job.status <> 'ON_SITE' or v_job.before_review = 'APPROVED' then
    raise exception 'Details can only be changed on site, before the photos are approved'
      using errcode = 'check_violation';
  end if;

  update public.job_line_items set details = p_details where id = p_item_id
  returning * into v_item;

  insert into public.job_events (job_id, actor_id, actor_role, event_type, payload)
  values (v_job.id, v_uid, public.app_role(), 'unit.details_updated',
          jsonb_build_object('item_id', p_item_id, 'details', p_details));

  return v_item;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- submit_site_photos — supervisor sends before or after photos for review.
-- ---------------------------------------------------------------------------
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
    if coalesce(trim(p_note), '') = '' then
      raise exception 'Write what was done' using errcode = 'check_violation';
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
       set after_review = 'PENDING', after_submitted_at = now(), completion_note = trim(p_note),
           after_reviewed_by = null, after_reviewed_at = null, after_rejection_reason = null
     where id = p_job_id returning * into v_job;
  end if;

  insert into public.job_events (job_id, actor_id, actor_role, event_type, payload)
  values (p_job_id, v_uid, public.app_role(), 'photos.' || p_stage || '.submitted',
          jsonb_build_object('note', p_note));

  return v_job;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- review_site_photos — before: sales rep or admin. after: admin only, and
-- approving the after photos completes the job.
-- ---------------------------------------------------------------------------
create or replace function public.review_site_photos(
  p_job_id  uuid,
  p_stage   text,
  p_approve boolean,
  p_reason  text default null
)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_job public.jobs;
begin
  if p_stage = 'before' and not (public.is_sales_rep() or public.is_admin()) then
    raise exception 'Only sales or admin can review before photos' using errcode = 'insufficient_privilege';
  end if;
  if p_stage = 'after' and not public.is_admin() then
    raise exception 'Only an admin can approve the finished work' using errcode = 'insufficient_privilege';
  end if;
  if p_stage not in ('before', 'after') then
    raise exception 'Stage must be before or after' using errcode = 'invalid_parameter_value';
  end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then
    raise exception 'A rejection needs a reason' using errcode = 'check_violation';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'Job not found' using errcode = 'no_data_found';
  end if;
  if (p_stage = 'before' and v_job.before_review is distinct from 'PENDING')
     or (p_stage = 'after' and v_job.after_review is distinct from 'PENDING') then
    raise exception 'Nothing waiting for review' using errcode = 'no_data_found';
  end if;

  if p_stage = 'before' then
    update public.jobs
       set before_review = case when p_approve then 'APPROVED' else 'REJECTED' end::public.approval_status,
           before_reviewed_by = v_uid, before_reviewed_at = now(),
           before_rejection_reason = case when p_approve then null else trim(p_reason) end
     where id = p_job_id returning * into v_job;
  elsif p_approve then
    update public.jobs
       set after_review = 'APPROVED', after_reviewed_by = v_uid, after_reviewed_at = now(),
           after_rejection_reason = null,
           status = 'COMPLETED', completed_at = now(), actual_end_at = now()
     where id = p_job_id returning * into v_job;
    insert into public.job_events (job_id, actor_id, actor_role, event_type, from_status, to_status, payload)
    values (p_job_id, v_uid, 'admin', 'status.changed', 'IN_PROGRESS', 'COMPLETED',
            jsonb_build_object('via', 'after_photos_approved'));
    perform public.cancel_pending_notifications(p_job_id, null, null);
  else
    update public.jobs
       set after_review = 'REJECTED', after_reviewed_by = v_uid, after_reviewed_at = now(),
           after_rejection_reason = trim(p_reason)
     where id = p_job_id returning * into v_job;
  end if;

  insert into public.job_events (job_id, actor_id, actor_role, event_type, payload)
  values (p_job_id, v_uid, public.app_role(),
          'photos.' || p_stage || case when p_approve then '.approved' else '.rejected' end,
          jsonb_build_object('reason', p_reason));

  return v_job;
end;
$fn$;

revoke all on function public.update_unit_details(uuid, jsonb) from public, anon;
revoke all on function public.submit_site_photos(uuid, text, text) from public, anon;
revoke all on function public.review_site_photos(uuid, text, boolean, text) from public, anon;
grant execute on function public.update_unit_details(uuid, jsonb) to authenticated;
grant execute on function public.submit_site_photos(uuid, text, text) to authenticated;
grant execute on function public.review_site_photos(uuid, text, boolean, text) to authenticated;
