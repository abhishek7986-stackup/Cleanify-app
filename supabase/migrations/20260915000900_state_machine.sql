-- ============================================================================
-- Cleanify Ops — 09. Job state machine and check-in RPCs
--
-- Supervisors get ZERO direct UPDATE on jobs. RLS can express "this row is
-- yours" but it cannot express "you may go from ON_SITE to IN_PROGRESS but not
-- from ASSIGNED to COMPLETED". Every status change goes through one
-- SECURITY DEFINER RPC that locks the row and checks the transition table.
-- ============================================================================
set search_path = public, extensions;

create table public.job_status_transitions (
  from_status         public.job_status not null,
  to_status           public.job_status not null,
  allowed_roles       public.user_role[] not null,
  requires_assignment boolean not null default false,  -- actor is the assigned supervisor
  requires_ownership  boolean not null default false,  -- actor created the job
  guard               text,
  note                text,
  primary key (from_status, to_status)
);

-- ---------------------------------------------------------------------------
-- advance_job_status
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
    if (select count(*) from public.photos
         where roster_id = v_roster.id and kind in ('EQUIPMENT','PPE_SELFIE')) < 2 then
      raise exception 'Both the equipment and PPE photos are required'
        using errcode = 'check_violation';
    end if;

  elsif v_t.guard = 'completion_ready' then
    if coalesce(trim(coalesce(p_meta ->> 'completion_note', v_job.completion_note, '')), '') = '' then
      raise exception 'A completion note is required' using errcode = 'check_violation';
    end if;
    select count(*) into v_undone from public.job_line_items
     where job_id = p_job_id and is_done = false;
    if v_undone > 0 then
      raise exception '% item(s) on this job are not marked done', v_undone
        using errcode = 'check_violation';
    end if;
    -- every unit needs both a before and an after photo
    if exists (
      select 1 from public.job_line_items li
       where li.job_id = p_job_id
         and (select count(distinct p.kind) from public.photos p
               where p.job_line_item_id = li.id
                 and p.kind in ('SITE_BEFORE','SITE_AFTER')) < 2
    ) then
      raise exception 'Every item needs a before and an after photo'
        using errcode = 'check_violation';
    end if;
  end if;

  -- ----------------------------------------------------------- side effects
  update public.jobs
     set status = p_to,
         actual_departure_at = case when p_to = 'EN_ROUTE'    then now() else actual_departure_at end,
         arrived_at          = case when p_to = 'ON_SITE'     then now() else arrived_at end,
         actual_start_at     = case when p_to = 'IN_PROGRESS' then now() else actual_start_at end,
         actual_end_at       = case when p_to = 'COMPLETED'   then now() else actual_end_at end,
         completed_at        = case when p_to = 'COMPLETED'   then now() else completed_at end,
         completion_note     = coalesce(p_meta ->> 'completion_note', completion_note)
   where id = p_job_id
   returning * into v_job;

  insert into public.job_events (job_id, actor_id, actor_role, event_type,
                                 from_status, to_status, payload)
  values (p_job_id, v_uid, v_role, 'status.changed',
          v_t.from_status, p_to, p_meta);

  -- A terminal job must stop generating alerts.
  if p_to in ('COMPLETED','CANCELLED','NO_SHOW') then
    perform public.cancel_pending_notifications(p_job_id, null, null);
  end if;

  return v_job;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- issue_capture_token
--
-- This is what makes camera-only real rather than theatre. A getUserMedia UI
-- proves nothing if the upload endpoint accepts any blob: anyone with dev
-- tools can POST a file from last week. The token is minted when the camera
-- opens, is single-use, and expires in minutes.
-- ---------------------------------------------------------------------------
create or replace function public.issue_capture_token(
  p_kind             public.photo_kind,
  p_roster_id        uuid default null,
  p_job_id           uuid default null,
  p_job_line_item_id uuid default null
)
returns public.capture_tokens
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_tok public.capture_tokens;
  v_ttl int := coalesce(public.setting_num('capture.token_ttl_seconds', 300)::int, 300);
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- the caller must actually own the thing they are photographing
  if p_roster_id is not null and not exists (
    select 1 from public.day_rosters
     where id = p_roster_id and supervisor_id = v_uid and voided_at is null
  ) then
    raise exception 'That roster is not yours' using errcode = 'insufficient_privilege';
  end if;

  if p_job_line_item_id is not null and not exists (
    select 1 from public.job_line_items li
      join public.jobs j on j.id = li.job_id
     where li.id = p_job_line_item_id and j.assigned_supervisor_id = v_uid
  ) then
    raise exception 'That item is not on one of your jobs' using errcode = 'insufficient_privilege';
  end if;

  -- The SERVER chooses the object path, never the client. The storage policy
  -- then matches uploads against exactly this string, so a supervisor cannot
  -- write anywhere except the one object this token authorises.
  insert into public.capture_tokens (user_id, kind, roster_id, job_id, job_line_item_id,
                                     expires_at, storage_path)
  values (v_uid, p_kind, p_roster_id, p_job_id, p_job_line_item_id,
          now() + pg_catalog.make_interval(secs => v_ttl),
          case
            when p_roster_id is not null
              then 'rosters/' || p_roster_id::text || '/' || lower(p_kind::text) || '.jpg'
            when p_job_line_item_id is not null
              then 'units/' || p_job_line_item_id::text || '/' || lower(p_kind::text) || '.jpg'
            else 'jobs/' || coalesce(p_job_id::text, 'misc') || '/'
                 || lower(p_kind::text) || '-' || extensions.gen_random_uuid()::text || '.jpg'
          end)
  returning * into v_tok;

  return v_tok;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- record_photo — consumes a capture token and stamps the SERVER clock.
-- The client's claimed time is stored alongside, never instead.
-- ---------------------------------------------------------------------------
create or replace function public.record_photo(
  p_token_id       uuid,
  p_sha256         text,
  p_mime_type      text,
  p_bytes          int,
  p_width          int default null,
  p_height         int default null,
  p_camera_facing  text default null,
  p_capture_latency_ms int default null,
  p_client_clock   timestamptz default null,
  p_lat            double precision default null,
  p_lng            double precision default null,
  p_accuracy_m     numeric default null
)
returns public.photos
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid       uuid := auth.uid();
  v_tok       public.capture_tokens;
  v_photo     public.photos;
  v_expected  extensions.geography;
  v_dist      numeric;
  v_flag      boolean := false;
  v_reason    text;
  v_dupe      boolean;
  v_max_acc   numeric := public.setting_num('geofence.max_accuracy_m', 150);
begin
  select * into v_tok from public.capture_tokens where id = p_token_id for update;
  if not found then
    raise exception 'Unknown capture token' using errcode = 'insufficient_privilege';
  end if;
  if v_tok.user_id is distinct from v_uid then
    raise exception 'That capture token is not yours' using errcode = 'insufficient_privilege';
  end if;
  if v_tok.consumed_at is not null then
    raise exception 'That capture token has already been used' using errcode = 'insufficient_privilege';
  end if;
  if v_tok.expires_at < now() then
    raise exception 'That capture token has expired — retake the photo'
      using errcode = 'insufficient_privilege';
  end if;

  -- The cheapest anti-fraud win available: the same bytes submitted twice,
  -- anywhere, ever.
  select exists (select 1 from public.photos where sha256 = p_sha256) into v_dupe;
  if v_dupe then
    v_flag := true;
    v_reason := 'duplicate_photo';
  end if;

  -- Where should they have been standing?
  if v_tok.roster_id is not null then
    select p.base_location into v_expected
      from public.day_rosters r join public.profiles p on p.id = r.supervisor_id
     where r.id = v_tok.roster_id;
  elsif v_tok.job_line_item_id is not null or v_tok.job_id is not null then
    select j.site_location into v_expected
      from public.jobs j
     where j.id = coalesce(v_tok.job_id,
             (select job_id from public.job_line_items where id = v_tok.job_line_item_id));
  end if;

  if p_lat is not null and p_lng is not null and v_expected is not null then
    v_dist := extensions.st_distance(
                extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
                v_expected);
  end if;

  -- An unusable GPS reading and a suspicious location are very different
  -- accusations. Never conflate them.
  if p_accuracy_m is not null and p_accuracy_m > v_max_acc then
    v_flag := true;
    v_reason := coalesce(v_reason || ',', '') || 'low_accuracy';
  end if;

  insert into public.photos (
    kind, roster_id, job_id, job_line_item_id,
    storage_path, mime_type, bytes, width, height, sha256,
    captured_via, camera_facing, capture_latency_ms, capture_token_id,
    captured_at_server, client_clock_at,
    lat, lng, accuracy_m, distance_from_expected_m,
    flagged, flag_reason, uploaded_by
  )
  values (
    v_tok.kind, v_tok.roster_id,
    coalesce(v_tok.job_id, (select job_id from public.job_line_items where id = v_tok.job_line_item_id)),
    v_tok.job_line_item_id,
    v_tok.storage_path, p_mime_type, p_bytes, p_width, p_height, p_sha256,
    'getusermedia', p_camera_facing, p_capture_latency_ms, p_token_id,
    now(), p_client_clock,
    p_lat, p_lng, p_accuracy_m, v_dist,
    v_flag, v_reason, v_uid
  )
  returning * into v_photo;

  update public.capture_tokens set consumed_at = now() where id = p_token_id;

  return v_photo;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- submit_checkin — the depot check-in.
-- submitted_at is the SERVER clock, always. The device's claim is recorded
-- beside it so skew is visible rather than authoritative.
-- ---------------------------------------------------------------------------
create or replace function public.submit_checkin(
  p_roster_date        date,
  p_lat                double precision default null,
  p_lng                double precision default null,
  p_accuracy_m         numeric default null,
  p_client_clock       timestamptz default null,
  p_device_fingerprint text default null,
  p_user_agent         text default null,
  p_offline_queued_at  timestamptz default null,
  p_note               text default null
)
returns public.day_rosters
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_r        public.day_rosters;
  v_base     extensions.geography;
  v_point    extensions.geography;
  v_dist     numeric;
  v_flags    text[] := '{}';
  v_risk     int := 0;
  v_radius   numeric := public.setting_num('geofence.base_radius_m', 500);
  v_max_acc  numeric := public.setting_num('geofence.max_accuracy_m', 150);
  v_skew     int;
  v_photos   int;
begin
  if not public.is_supervisor() then
    raise exception 'Only supervisors check in' using errcode = 'insufficient_privilege';
  end if;

  select * into v_r from public.day_rosters
   where supervisor_id = v_uid and roster_date = p_roster_date and voided_at is null
   for update;
  if not found then
    raise exception 'No roster for % — you have no jobs scheduled that day', p_roster_date
      using errcode = 'no_data_found';
  end if;
  if v_r.submitted_at is not null then
    raise exception 'You have already checked in today' using errcode = 'unique_violation';
  end if;

  select count(*) into v_photos from public.photos
   where roster_id = v_r.id and kind in ('EQUIPMENT','PPE_SELFIE');
  if v_photos < 2 then
    raise exception 'Both the equipment photo and the PPE photo are required'
      using errcode = 'check_violation';
  end if;

  select base_location into v_base from public.profiles where id = v_uid;

  if p_lat is null or p_lng is null then
    v_flags := v_flags || 'no_geolocation';
    v_risk  := v_risk + 20;
  else
    v_point := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
    if v_base is not null then
      v_dist := extensions.st_distance(v_point, v_base);
    end if;

    if p_accuracy_m is not null and p_accuracy_m > v_max_acc then
      -- unusable reading, NOT a suspicious one
      v_flags := v_flags || 'low_accuracy';
      v_risk  := v_risk + 10;
    elsif v_dist is not null
      -- Widen the fence by the reported accuracy. GPS drifts 50-200 m between
      -- mid-rise buildings; a hard radius generates constant false failures
      -- and the team learns to ignore flags entirely.
      and (v_dist - coalesce(p_accuracy_m, 0)) > v_radius then
      v_flags := v_flags || 'far_from_expected';
      v_risk  := v_risk + 40;
    end if;
  end if;

  if p_client_clock is not null then
    v_skew := abs(extract(epoch from (p_client_clock - now()))::int);
    if v_skew > 120 then
      v_flags := v_flags || 'clock_skew';
      v_risk  := v_risk + 15;
    end if;
  end if;

  if p_offline_queued_at is not null then
    v_flags := v_flags || 'offline_submitted';
    v_risk  := v_risk + 5;
  end if;

  if exists (select 1 from public.photos where roster_id = v_r.id and flagged) then
    v_flags := v_flags || 'photo_flagged';
    v_risk  := v_risk + 30;
  end if;

  update public.day_rosters
     set submitted_at       = now(),           -- SERVER clock, always
         client_reported_at = p_client_clock,
         location           = v_point,
         accuracy_m         = p_accuracy_m,
         distance_from_expected_m = v_dist,
         flags              = v_flags,
         risk_score         = v_risk,
         device_fingerprint = p_device_fingerprint,
         user_agent         = p_user_agent,
         offline_queued_at  = p_offline_queued_at,
         note               = p_note,
         checkin_status     = case
             when required_checkin_at is null then 'ON_TIME'::public.checkin_status
             when now() <= required_checkin_at then 'ON_TIME'::public.checkin_status
             else 'LATE'::public.checkin_status end
   where id = v_r.id
   returning * into v_r;

  -- The instant a supervisor checks in, his late alerts die.
  perform public.cancel_pending_notifications(null, v_r.id, 'checkin.');

  insert into public.job_events (roster_id, job_id, actor_id, actor_role, event_type, payload)
  values (v_r.id, v_r.first_job_id, v_uid, 'supervisor', 'checkin.submitted',
          jsonb_build_object('status', v_r.checkin_status, 'flags', v_flags,
                             'risk_score', v_risk, 'distance_m', v_dist));

  return v_r;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Sales rep review of the depot photos. Non-blocking: the supervisor has
-- already left. Rejection tells him to resubmit and is visible to admin.
-- ---------------------------------------------------------------------------
create or replace function public.review_roster(
  p_roster_id uuid,
  p_approve   boolean,
  p_reason    text default null
)
returns public.day_rosters
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_r   public.day_rosters;
begin
  if not (public.is_sales_rep() or public.is_admin()) then
    raise exception 'Only a sales rep or admin can review a check-in'
      using errcode = 'insufficient_privilege';
  end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then
    raise exception 'A rejection needs a reason' using errcode = 'check_violation';
  end if;

  update public.day_rosters
     set approval_status   = case when p_approve then 'APPROVED' else 'REJECTED' end::public.approval_status,
         approved_by       = v_uid,
         approved_at       = now(),
         rejection_reason  = case when p_approve then null else p_reason end
   where id = p_roster_id and submitted_at is not null
   returning * into v_r;

  if not found then
    raise exception 'No submitted check-in to review' using errcode = 'no_data_found';
  end if;

  insert into public.job_events (roster_id, actor_id, actor_role, event_type, payload)
  values (p_roster_id, v_uid, public.app_role(),
          case when p_approve then 'checkin.approved' else 'checkin.rejected' end,
          jsonb_build_object('reason', p_reason));

  -- tell the supervisor either way; a rejection needs action from him
  perform public.enqueue_notification(
    v_r.supervisor_id,
    case when p_approve then 'checkin.approved' else 'checkin.rejected' end,
    'web_push', now(), null, p_roster_id,
    jsonb_build_object('reason', p_reason), 720);
  perform public.enqueue_notification(
    v_r.supervisor_id,
    case when p_approve then 'checkin.approved' else 'checkin.rejected' end,
    'in_app', now(), null, p_roster_id,
    jsonb_build_object('reason', p_reason), 720);

  return v_r;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- waive_late — the escape hatch for a wrong ETA.
-- The flag is cleared but the original detection stays in job_events. Fully
-- automatic travel times WILL be wrong sometimes; without this, the late
-- report becomes something everyone learns to ignore.
-- ---------------------------------------------------------------------------
create or replace function public.waive_late(p_job_id uuid, p_reason text)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_job public.jobs;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can waive a late flag' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A waiver needs a reason' using errcode = 'check_violation';
  end if;

  update public.jobs
     set is_late = false, late_waived_by = v_uid, late_waived_at = now(), waive_reason = p_reason
   where id = p_job_id
   returning * into v_job;

  insert into public.job_events (job_id, actor_id, actor_role, event_type, payload)
  values (p_job_id, v_uid, 'admin', 'late.waived',
          jsonb_build_object('reason', p_reason, 'was_marked_at', v_job.late_marked_at));

  return v_job;
end;
$fn$;
