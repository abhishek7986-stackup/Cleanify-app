-- ============================================================================
-- Cleanify Ops — 07. Notification outbox: reconcile, sweep, dispatch
-- ============================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Who gets told when something goes wrong. A named recipient list, not
-- "every admin" — otherwise the whole org gets spammed.
-- ---------------------------------------------------------------------------
create or replace function public.alert_recipients()
returns setof uuid
language sql stable
set search_path = ''
as $fn$
  select id from public.profiles
   where id::text in (
     select jsonb_array_elements_text(coalesce(public.get_setting('alerts.admin_recipients'), '[]'::jsonb))
   )
     and is_active
  union
  -- fall back to every active admin only if nobody has been nominated
  select id from public.profiles
   where role = 'admin' and is_active
     and jsonb_array_length(coalesce(public.get_setting('alerts.admin_recipients'), '[]'::jsonb)) = 0
$fn$;

-- ---------------------------------------------------------------------------
-- enqueue_notification
--
-- The dedupe key bakes in due_at. That is the whole answer to "what about a
-- deadline that changed after the notification was already queued": a moved
-- deadline always mints a NEW row and retires the old one, so there is no
-- update-in-place race to lose. A row already SENT is never superseded.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_notification(
  p_recipient   uuid,
  p_template    text,
  p_channel     public.notif_channel,
  p_due_at      timestamptz,
  p_job_id      uuid default null,
  p_roster_id   uuid default null,
  p_payload     jsonb default '{}'::jsonb,
  p_stale_after int default 20
)
returns uuid
language plpgsql
set search_path = ''
as $fn$
declare
  v_key text;
  v_id  uuid;
begin
  if p_recipient is null or p_due_at is null then
    return null;
  end if;

  v_key := coalesce(p_job_id::text, p_roster_id::text, 'global')
           || '|' || p_template
           || '|' || p_recipient::text
           || '|' || p_channel::text
           || '|' || extract(epoch from p_due_at)::bigint::text;

  insert into public.notifications (
    dedupe_key, job_id, roster_id, recipient_id, template_key,
    channel, payload, due_at, stale_after_min
  )
  values (
    v_key, p_job_id, p_roster_id, p_recipient, p_template,
    p_channel, p_payload, p_due_at, p_stale_after
  )
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.notifications where dedupe_key = v_key;
  end if;

  -- Retire still-pending siblings for the same job/template/recipient/channel
  -- whose deadline has moved. SENT rows are left alone.
  update public.notifications n
     set state = 'SUPERSEDED', superseded_by = v_id
   where n.state = 'PENDING'
     and n.dedupe_key <> v_key
     and n.recipient_id = p_recipient
     and n.template_key = p_template
     and n.channel = p_channel
     and n.job_id is not distinct from p_job_id
     and n.roster_id is not distinct from p_roster_id;

  return v_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- cancel_pending_notifications — the instant a supervisor checks in, his late
-- alerts must die.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_pending_notifications(
  p_job_id    uuid default null,
  p_roster_id uuid default null,
  p_prefix    text default null
)
returns int
language sql
set search_path = ''
as $fn$
  with upd as (
    update public.notifications
       set state = 'CANCELLED'
     where state = 'PENDING'
       and (p_job_id    is null or job_id    = p_job_id)
       and (p_roster_id is null or roster_id = p_roster_id)
       and (p_job_id is not null or p_roster_id is not null)
       and (p_prefix is null or template_key like p_prefix || '%')
    returning 1
  )
  select count(*)::int from upd;
$fn$;

-- ---------------------------------------------------------------------------
-- reconcile_roster_notifications — the check-in reminder and late alerts.
-- Runs in the same transaction as any deadline change.
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_roster_notifications(p_roster_id uuid)
returns void
language plpgsql
set search_path = ''
as $fn$
declare
  v_r        record;
  v_rep      uuid;
  v_admin    uuid;
  v_payload  jsonb;
  v_whatsapp boolean := coalesce((public.get_setting('alerts.whatsapp_enabled','true'::jsonb) #>> '{}')::boolean, true);
begin
  select * into v_r from public.day_rosters where id = p_roster_id;
  if not found or v_r.voided_at is not null then
    return;
  end if;

  -- Already checked in, or nothing scheduled: nothing to warn about.
  if v_r.submitted_at is not null or v_r.required_checkin_at is null then
    perform public.cancel_pending_notifications(null, p_roster_id, 'checkin.');
    return;
  end if;

  select created_by_sales_rep_id into v_rep from public.jobs where id = v_r.first_job_id;

  v_payload := jsonb_build_object(
    'roster_id',   v_r.id,
    'supervisor',  (select full_name from public.profiles where id = v_r.supervisor_id),
    'deadline',    v_r.required_checkin_at,
    'roster_date', v_r.roster_date
  );

  -- 15 minutes before the deadline, to the supervisor
  if v_r.reminder_at is not null then
    perform public.enqueue_notification(
      v_r.supervisor_id, 'checkin.reminder', 'web_push', v_r.reminder_at,
      null, p_roster_id, v_payload, 20);
    perform public.enqueue_notification(
      v_r.supervisor_id, 'checkin.reminder', 'in_app', v_r.reminder_at,
      null, p_roster_id, v_payload, 20);
  end if;

  -- At the deadline: the supervisor, the rep who booked the first job, and the
  -- nominated admins.
  perform public.enqueue_notification(
    v_r.supervisor_id, 'checkin.late.supervisor', 'web_push', v_r.required_checkin_at,
    null, p_roster_id, v_payload, 360);
  perform public.enqueue_notification(
    v_r.supervisor_id, 'checkin.late.supervisor', 'in_app', v_r.required_checkin_at,
    null, p_roster_id, v_payload, 360);

  if v_rep is not null then
    perform public.enqueue_notification(
      v_rep, 'checkin.late.staff', 'in_app', v_r.required_checkin_at,
      null, p_roster_id, v_payload, 360);
    if v_whatsapp then
      perform public.enqueue_notification(
        v_rep, 'checkin.late.staff', 'whatsapp', v_r.required_checkin_at,
        null, p_roster_id, v_payload, 360);
    end if;
  end if;

  for v_admin in select * from public.alert_recipients() loop
    if v_admin is distinct from v_rep then
      perform public.enqueue_notification(
        v_admin, 'checkin.late.staff', 'in_app', v_r.required_checkin_at,
        null, p_roster_id, v_payload, 360);
      if v_whatsapp then
        perform public.enqueue_notification(
          v_admin, 'checkin.late.staff', 'whatsapp', v_r.required_checkin_at,
          null, p_roster_id, v_payload, 360);
      end if;
    end if;
  end loop;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- sweep_late — the minutely detector.
-- The predicate is `deadline < now()`, NOT `deadline between last_tick and
-- now()`. A twenty minute scheduler outage therefore self-heals: everything
-- fires late, nothing is lost.
-- ---------------------------------------------------------------------------
create or replace function public.sweep_late()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_rosters int := 0;
  v_jobs    int := 0;
  v_r       record;
  v_j       record;
  v_blameless boolean;
begin
  -- --- check-in deadline missed -------------------------------------------
  for v_r in
    select * from public.day_rosters
     where submitted_at is null
       and voided_at is null
       and required_checkin_at is not null
       and required_checkin_at < now()
       and late_notified_at is null
  loop
    update public.day_rosters
       set checkin_status = 'LATE', late_notified_at = now()
     where id = v_r.id;

    insert into public.job_events (roster_id, job_id, event_type, payload)
    values (v_r.id, v_r.first_job_id, 'checkin.late',
            jsonb_build_object('deadline', v_r.required_checkin_at, 'detected_at', now()));

    v_rosters := v_rosters + 1;
  end loop;

  -- --- arrival deadline missed --------------------------------------------
  for v_j in
    select j.* from public.jobs j
     where j.status in ('ASSIGNED','CHECKED_IN','EN_ROUTE')
       and j.is_late = false
       and j.required_arrival_at is not null
       and j.required_arrival_at < now()
  loop
    -- The blameless rule: if the PREVIOUS job of the day is still running,
    -- this supervisor cannot physically be here. Record it, but do not tell
    -- the rep and admin he is late — punishing someone because the previous
    -- job overran is the fastest way to lose the team's trust in the app.
    select exists (
      select 1 from public.jobs p
       where p.assigned_supervisor_id = v_j.assigned_supervisor_id
         and p.service_date = v_j.service_date
         and p.sequence_in_day = v_j.sequence_in_day - 1
         and p.status in ('EN_ROUTE','ON_SITE','IN_PROGRESS')
         and p.actual_end_at is null
    ) into v_blameless;

    update public.jobs
       set is_late = true,
           late_marked_at = now(),
           late_blameless = v_blameless,
           itinerary_flags = case when v_blameless
                                  then array(select distinct unnest(itinerary_flags || 'upstream_overrun'))
                                  else itinerary_flags end
     where id = v_j.id;

    insert into public.job_events (job_id, event_type, payload)
    values (v_j.id, case when v_blameless then 'arrival.late.blameless' else 'arrival.late' end,
            jsonb_build_object('expected', v_j.required_arrival_at, 'detected_at', now()));

    v_jobs := v_jobs + 1;
  end loop;

  -- --- liveness heartbeat --------------------------------------------------
  -- A scheduler that dies quietly is the worst failure mode in this system:
  -- nobody is notified of anything and the app looks completely fine.
  insert into public.app_settings (key, value, description)
  values ('scheduler.last_tick', to_jsonb(now()), 'Written every sweep. Alert externally if stale > 5 min.')
  on conflict (key) do update set value = to_jsonb(now()), updated_at = now();

  return jsonb_build_object('rosters_marked_late', v_rosters, 'jobs_marked_late', v_jobs);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- should_still_send — send-time re-validation.
-- A supervisor can check in two seconds before the dispatcher claims the row.
-- Cheap insurance against telling someone they are late 90 seconds after they
-- checked in.
-- ---------------------------------------------------------------------------
create or replace function public.should_still_send(p_notification_id uuid)
returns boolean
language plpgsql stable
set search_path = ''
as $fn$
declare
  v_n record;
  v_r record;
  v_j record;
begin
  select * into v_n from public.notifications where id = p_notification_id;
  if not found then return false; end if;

  -- too old to be useful: a "check in 15 minutes from now" reminder for a
  -- deadline that passed an hour ago is worse than silence
  if now() > v_n.due_at + make_interval(mins => v_n.stale_after_min) then
    return false;
  end if;

  if v_n.roster_id is not null then
    select * into v_r from public.day_rosters where id = v_n.roster_id;
    if not found or v_r.voided_at is not null then return false; end if;
    if v_n.template_key like 'checkin.%' and v_r.submitted_at is not null then
      return false;
    end if;
    if v_r.required_checkin_at is distinct from v_n.due_at
       and v_n.template_key = 'checkin.late.supervisor' then
      return false;                                  -- deadline moved: superseded
    end if;
  end if;

  if v_n.job_id is not null then
    select * into v_j from public.jobs where id = v_n.job_id;
    if not found then return false; end if;
    if v_j.status in ('COMPLETED','CANCELLED','NO_SHOW') then return false; end if;
    if v_n.template_key like '%late%' and v_j.late_blameless then return false; end if;
  end if;

  return true;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- claim_notifications — FOR UPDATE SKIP LOCKED is what makes double-sends
-- structurally impossible even if two schedulers fire at once. That is what
-- lets a redundant external pinger run alongside pg_cron safely.
-- ---------------------------------------------------------------------------
create or replace function public.claim_notifications(p_worker text, p_limit int default 200)
returns setof public.notifications
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  -- return rows whose worker died mid-send
  update public.notifications
     set state = 'PENDING', claimed_by = null, claimed_at = null, lease_expires_at = null
   where state = 'CLAIMED' and lease_expires_at < now();

  return query
  with claimed as (
    update public.notifications n
       set state = 'CLAIMED',
           claimed_at = now(),
           claimed_by = p_worker,
           lease_expires_at = now() + interval '2 minutes',
           attempts = n.attempts + 1
     where n.id in (
       select id from public.notifications
        where state = 'PENDING'
          and due_at <= now()
          and (next_attempt_at is null or next_attempt_at <= now())
        order by due_at
        for update skip locked
        limit p_limit
     )
    returning n.*
  )
  select * from claimed;
end;
$fn$;

create or replace function public.mark_notification_sent(p_id uuid, p_provider_msg_id text default null)
returns void
language sql
set search_path = ''
as $fn$
  update public.notifications
     set state = 'SENT', sent_at = now(), provider_msg_id = p_provider_msg_id,
         lease_expires_at = null
   where id = p_id;
$fn$;

create or replace function public.mark_notification_failed(p_id uuid, p_error text)
returns void
language plpgsql
set search_path = ''
as $fn$
declare v_n record;
begin
  select * into v_n from public.notifications where id = p_id;
  if not found then return; end if;

  if v_n.attempts >= v_n.max_attempts then
    update public.notifications
       set state = 'FAILED', failed_at = now(), last_error = p_error, lease_expires_at = null
     where id = p_id;
  else
    -- exponential backoff: 30s, 60s, 120s, 240s...
    update public.notifications
       set state = 'PENDING', last_error = p_error, lease_expires_at = null,
           claimed_by = null, claimed_at = null,
           next_attempt_at = now() + make_interval(secs => 30 * power(2, v_n.attempts)::int)
     where id = p_id;
  end if;
end;
$fn$;
