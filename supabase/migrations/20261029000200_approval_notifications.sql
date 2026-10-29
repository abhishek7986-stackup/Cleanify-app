-- ============================================================================
-- Cleanify Ops — 31. Tell approvers the moment something needs them
-- ============================================================================
-- Supervisors are blocked until a sales rep or admin approves: the morning
-- check-in, the before photos, the after photos. The sales team spends the day
-- on the phone, so a page that only refreshes itself is not enough. Each
-- submission now notifies every approver immediately (push + in-app inbox),
-- and again at 10 and 30 minutes if nobody has decided. Deciding cancels the
-- reminders still queued, for everyone.
--
-- New staff sign-ups notify admins the same way.
--
-- The supervisor is told the result of their before/after photos too (the
-- depot check-in result was already sent by review_roster).
--
-- Implemented as triggers on the rows that change, so every path that submits
-- or decides (the app, an admin fixing data by hand) notifies the same way.
-- Message text travels in the payload (title, body, url), so the sender needs
-- no per-template code.
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Who approves what.
-- ---------------------------------------------------------------------------
create or replace function public.approver_ids(p_include_sales boolean)
returns setof uuid
language sql stable
set search_path = ''
as $fn$
  select id from public.profiles
   where is_active
     and (role = 'admin' or (p_include_sales and role = 'sales_rep'))
$fn$;

-- ---------------------------------------------------------------------------
-- notify_approvers: now on both channels, then push reminders at +10 and +30.
-- ---------------------------------------------------------------------------
create or replace function public.notify_approvers(
  p_template      text,
  p_title         text,
  p_body          text,
  p_url           text,
  p_include_sales boolean,
  p_job_id        uuid default null,
  p_roster_id     uuid default null,
  p_extra         jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_to      uuid;
  v_now     timestamptz := now();
  v_payload jsonb := jsonb_build_object('title', p_title, 'body', p_body, 'url', p_url, 'critical', true) || p_extra;
begin
  for v_to in select public.approver_ids(p_include_sales) loop
    perform public.enqueue_notification(v_to, p_template, 'web_push', v_now, p_job_id, p_roster_id, v_payload, 60);
    perform public.enqueue_notification(v_to, p_template, 'in_app',   v_now, p_job_id, p_roster_id, v_payload, 1440);
    perform public.enqueue_notification(v_to, p_template || '.reminder', 'web_push', v_now + interval '10 minutes',
      p_job_id, p_roster_id,
      v_payload || jsonb_build_object('title', 'Still waiting: ' || p_title), 60);
    perform public.enqueue_notification(v_to, p_template || '.reminder', 'web_push', v_now + interval '30 minutes',
      p_job_id, p_roster_id,
      v_payload || jsonb_build_object('title', 'Still waiting (30 min): ' || p_title), 60);
  end loop;
end;
$fn$;

-- enqueue_notification retires PENDING siblings with the same template and a
-- different due time. The two reminders share a template but must both stay,
-- so that retiring is narrowed to rows due EARLIER than the new one, i.e. a
-- genuinely moved deadline. Same behaviour as before for every existing
-- caller, which only ever moves a deadline later or replaces it outright.
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

  v_key := coalesce(p_job_id::text, p_roster_id::text, p_payload ->> 'application_id', 'global')
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

  if p_template not like '%.reminder' then
    update public.notifications n
       set state = 'SUPERSEDED', superseded_by = v_id
     where n.state = 'PENDING'
       and n.dedupe_key <> v_key
       and n.recipient_id = p_recipient
       and n.template_key = p_template
       and n.channel = p_channel
       and n.job_id is not distinct from p_job_id
       and n.roster_id is not distinct from p_roster_id;
  end if;

  return v_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Depot check-in
-- ---------------------------------------------------------------------------
create or replace function public.trg_roster_approval_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_name text;
begin
  if new.submitted_at is not null and new.approval_status = 'PENDING'
     and (old.submitted_at is null or old.approval_status is distinct from 'PENDING') then
    select full_name into v_name from public.profiles where id = new.supervisor_id;
    perform public.notify_approvers(
      'approval.checkin',
      coalesce(v_name, 'A supervisor') || ' checked in',
      'Approve the selfie and scooter km photo so their jobs unlock.',
      '/sales/approvals', true, null, new.id);
  elsif old.approval_status = 'PENDING' and new.approval_status <> 'PENDING' then
    perform public.cancel_pending_notifications(null, new.id, 'approval.');
  end if;
  return new;
end;
$fn$;

create trigger day_rosters_approval_notify
  after update of submitted_at, approval_status on public.day_rosters
  for each row execute function public.trg_roster_approval_notify();

-- ---------------------------------------------------------------------------
-- Before and after photos
-- ---------------------------------------------------------------------------
create or replace function public.trg_job_photos_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_sup    text;
  v_client text;
  v_label  text;
begin
  select full_name into v_sup from public.profiles where id = new.assigned_supervisor_id;
  select name into v_client from public.clients where id = new.client_id;
  v_label := coalesce(v_client, new.job_number);

  -- submitted
  if new.before_review = 'PENDING' and old.before_review is distinct from 'PENDING' then
    perform public.notify_approvers('approval.before',
      'Before photos: ' || v_label,
      coalesce(v_sup, 'The supervisor') || ' is on site waiting to start cleaning.',
      '/sales/approvals', true, new.id, null);
  end if;
  if new.after_review = 'PENDING' and old.after_review is distinct from 'PENDING' then
    perform public.notify_approvers('approval.after',
      'Job finished: ' || v_label,
      'Approve the after photos from ' || coalesce(v_sup, 'the supervisor') || ' to close the job.',
      '/sales/approvals', true, new.id, null);
  end if;

  -- decided: stop the reminders, tell the supervisor
  if old.before_review = 'PENDING' and new.before_review in ('APPROVED', 'REJECTED') then
    perform public.cancel_pending_notifications(new.id, null, 'approval.before');
    perform public.enqueue_notification(new.assigned_supervisor_id,
      'photos.before.' || lower(new.before_review::text), 'web_push', now(), new.id, null,
      jsonb_build_object(
        'title', case when new.before_review = 'APPROVED' then 'Approved: start cleaning' else 'Before photos not approved' end,
        'body',  case when new.before_review = 'APPROVED' then v_label
                      else coalesce(new.before_rejection_reason, 'Retake and send again.') end,
        'url', '/s/jobs/' || new.id), 60);
  end if;
  if old.after_review = 'PENDING' and new.after_review in ('APPROVED', 'REJECTED') then
    perform public.cancel_pending_notifications(new.id, null, 'approval.after');
    perform public.enqueue_notification(new.assigned_supervisor_id,
      'photos.after.' || lower(new.after_review::text), 'web_push', now(), new.id, null,
      jsonb_build_object(
        'title', case when new.after_review = 'APPROVED' then 'Job closed. Well done' else 'After photos not approved' end,
        'body',  case when new.after_review = 'APPROVED' then v_label
                      else coalesce(new.after_rejection_reason, 'Retake and send again.') end,
        'url', '/s/jobs/' || new.id), 60);
  end if;
  return new;
end;
$fn$;

create trigger jobs_photos_notify
  after update of before_review, after_review on public.jobs
  for each row execute function public.trg_job_photos_notify();

-- ---------------------------------------------------------------------------
-- New staff sign-ups (admins only)
-- ---------------------------------------------------------------------------
create or replace function public.trg_staff_application_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' and new.status = 'PENDING' then
    perform public.notify_approvers('approval.staff',
      'New staff: ' || new.full_name,
      'Check their Aadhaar and documents, then approve.',
      '/admin/users', false, null, null,
      jsonb_build_object('application_id', new.id));
  elsif tg_op = 'UPDATE' and old.status = 'PENDING' and new.status <> 'PENDING' then
    update public.notifications
       set state = 'CANCELLED'
     where state = 'PENDING'
       and template_key like 'approval.staff%'
       and payload ->> 'application_id' = new.id::text;
  end if;
  return new;
end;
$fn$;

create trigger staff_applications_notify
  after insert or update of status on public.staff_applications
  for each row execute function public.trg_staff_application_notify();

-- Internal helpers; never callable from the app.
revoke all on function public.approver_ids(boolean) from public, anon, authenticated;
revoke all on function public.notify_approvers(text, text, text, text, boolean, uuid, uuid, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The sender is the Next.js app (POST /api/dispatch), not a Supabase Edge
-- Function, so the app's URL and a shared secret are what pg_cron needs:
--
--   select vault.create_secret('https://<your-domain>/api/dispatch', 'cleanify_dispatch_url');
--   select vault.create_secret('<DISPATCH_SECRET from the app env>',  'cleanify_dispatch_secret');
-- ---------------------------------------------------------------------------
create or replace function public.trigger_dispatch()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'cleanify_dispatch_url';
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'cleanify_dispatch_secret';

  if v_url is null or v_key is null then
    return;   -- not configured yet: nothing is sent, nothing breaks
  end if;

  perform extensions.net_http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 8000
  );
end;
$fn$;

revoke execute on function public.trigger_dispatch() from authenticated, anon, public;
