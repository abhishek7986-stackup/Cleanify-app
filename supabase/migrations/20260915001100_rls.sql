-- ============================================================================
-- Cleanify Ops — 11. Row Level Security
--
-- The Supabase anon-key REST endpoint is publicly reachable. Any table left
-- without RLS is readable by any logged-in supervisor with a single curl, so
-- the posture here is default-deny on every table, then add back exactly what
-- each role needs.
--
-- Two performance rules that matter once there are 50k jobs:
--   * write (select auth.uid()), not bare auth.uid() — Postgres then treats it
--     as an InitPlan and evaluates it once per statement, not once per row.
--   * read role from the JWT (public.app_role()), never via a profiles lookup.
-- ============================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Strip Supabase's permissive defaults, then grant back deliberately.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter table public.app_settings            enable row level security;
alter table public.profiles                enable row level security;
alter table public.checkin_policies        enable row level security;
alter table public.reasons                 enable row level security;
alter table public.services                enable row level security;
alter table public.service_field_schemas   enable row level security;
alter table public.service_fields          enable row level security;
alter table public.clients                 enable row level security;
alter table public.jobs                    enable row level security;
alter table public.job_line_items          enable row level security;
alter table public.day_rosters             enable row level security;
alter table public.capture_tokens          enable row level security;
alter table public.photos                  enable row level security;
alter table public.payments                enable row level security;
alter table public.job_reschedules         enable row level security;
alter table public.job_cancellations       enable row level security;
alter table public.job_events              enable row level security;
alter table public.notifications           enable row level security;
alter table public.push_subscriptions      enable row level security;
alter table public.travel_estimates        enable row level security;
alter table public.recompute_queue         enable row level security;
alter table public.job_status_transitions  enable row level security;

-- ---------------------------------------------------------------------------
-- Reusable predicate: can the current user see this job at all?
-- ---------------------------------------------------------------------------
create or replace function public.can_see_job(p_job_id uuid)
returns boolean
language sql stable
set search_path = ''
as $fn$
  select public.is_admin()
      or public.is_sales_rep()
      or exists (
           select 1 from public.jobs j
            where j.id = p_job_id
              and j.assigned_supervisor_id = (select auth.uid())
         )
$fn$;

-- ---------------------------------------------------------------------------
-- profiles
-- The base_location column is deliberately not exposed to non-admins, so the
-- table itself is self-or-admin and everyone else reads the view below.
-- ---------------------------------------------------------------------------
grant select on public.profiles to authenticated;

create policy profiles_self_read on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());

create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Supabase Auth needs to read role during the access-token hook.
create policy profiles_auth_admin_read on public.profiles
  for select to supabase_auth_admin using (true);

-- Everyone can see who their colleagues are — names and roles only.
create view public.staff_directory
with (security_invoker = off) as
  select id, full_name, role, is_active
    from public.profiles
   where is_active;

grant select on public.staff_directory to authenticated;

-- ---------------------------------------------------------------------------
-- Configuration: readable by all staff, writable only by admin.
-- ---------------------------------------------------------------------------
grant select on public.app_settings, public.checkin_policies, public.reasons,
                public.services, public.service_field_schemas, public.service_fields,
                public.job_status_transitions
  to authenticated;

grant insert, update, delete on public.app_settings, public.checkin_policies,
                public.reasons, public.services, public.service_field_schemas,
                public.service_fields
  to authenticated;

create policy settings_read  on public.app_settings for select to authenticated using (true);
create policy settings_write on public.app_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy policies_read  on public.checkin_policies for select to authenticated using (true);
create policy policies_write on public.checkin_policies for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy reasons_read  on public.reasons for select to authenticated using (true);
create policy reasons_write on public.reasons for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy transitions_read on public.job_status_transitions
  for select to authenticated using (true);

-- Service definitions: staff read, only admin edits. Non-admins see published
-- schemas only, so a half-built draft never leaks into a job form.
create policy services_read on public.services for select to authenticated using (true);
create policy services_write on public.services for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy schemas_read on public.service_field_schemas for select to authenticated
  using (status = 'published' or public.is_admin());
create policy schemas_write on public.service_field_schemas for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy fields_read on public.service_fields for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.service_field_schemas s
                where s.id = schema_id and s.status = 'published')
  );
create policy fields_write on public.service_fields for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------
grant select, insert, update on public.clients to authenticated;

create policy clients_read on public.clients
  for select to authenticated
  using (
    public.is_admin()
    or public.is_sales_rep()
    -- a supervisor sees only the clients whose jobs he is actually doing
    or exists (select 1 from public.jobs j
                where j.client_id = clients.id
                  and j.assigned_supervisor_id = (select auth.uid()))
  );

create policy clients_write on public.clients
  for insert to authenticated
  with check (public.is_admin() or public.is_sales_rep());

create policy clients_update on public.clients
  for update to authenticated
  using (public.is_admin() or public.is_sales_rep())
  with check (public.is_admin() or public.is_sales_rep());

-- ---------------------------------------------------------------------------
-- jobs
--
-- Sales reps get org-wide READ because the day timetable is their home screen
-- and a timetable that only shows your own bookings is not a timetable.
--
-- Supervisors get NO update at all, not even on their own rows. RLS can say
-- "this row is yours"; it cannot say "you may go ON_SITE -> IN_PROGRESS but
-- not ASSIGNED -> COMPLETED". Every status change goes through
-- advance_job_status().
-- ---------------------------------------------------------------------------
grant select on public.jobs to authenticated;
grant insert, update on public.jobs to authenticated;

create policy jobs_read on public.jobs
  for select to authenticated
  using (
    public.is_admin()
    or public.is_sales_rep()
    or assigned_supervisor_id = (select auth.uid())
  );

create policy jobs_insert on public.jobs
  for insert to authenticated
  with check (
    (public.is_admin() or public.is_sales_rep())
    and created_by_sales_rep_id = (select auth.uid())
  );

create policy jobs_update on public.jobs
  for update to authenticated
  using (
    public.is_admin()
    or (public.is_sales_rep()
        and status in ('DRAFT','ASSIGNED')
        and created_by_sales_rep_id = (select auth.uid()))
  )
  with check (
    public.is_admin()
    or (public.is_sales_rep() and status in ('DRAFT','ASSIGNED'))
  );

-- ---------------------------------------------------------------------------
-- job_line_items — a supervisor may tick items off, and nothing else.
-- RLS cannot restrict columns, so this is a column-level grant.
-- ---------------------------------------------------------------------------
grant select on public.job_line_items to authenticated;
grant insert, delete on public.job_line_items to authenticated;
grant update (is_done, done_at) on public.job_line_items to authenticated;

create policy line_items_read on public.job_line_items
  for select to authenticated using (public.can_see_job(job_id));

create policy line_items_write on public.job_line_items
  for insert to authenticated
  with check (public.is_admin() or public.is_sales_rep());

create policy line_items_delete on public.job_line_items
  for delete to authenticated
  using (public.is_admin() or public.is_sales_rep());

create policy line_items_tick on public.job_line_items
  for update to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.jobs j
                where j.id = job_id
                  and j.assigned_supervisor_id = (select auth.uid())
                  and j.status in ('ON_SITE','IN_PROGRESS'))
  )
  with check (true);

-- ---------------------------------------------------------------------------
-- day_rosters — read-only over PostgREST. All writes go through
-- submit_checkin() / review_roster(), which are SECURITY DEFINER.
-- ---------------------------------------------------------------------------
grant select on public.day_rosters to authenticated;

create policy rosters_read on public.day_rosters
  for select to authenticated
  using (
    public.is_admin()
    or public.is_sales_rep()
    or supervisor_id = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- photos and capture tokens — inserted only via record_photo().
-- ---------------------------------------------------------------------------
grant select on public.photos, public.capture_tokens to authenticated;

create policy photos_read on public.photos
  for select to authenticated
  using (
    public.is_admin()
    or public.is_sales_rep()
    or uploaded_by = (select auth.uid())
    or (job_id is not null and public.can_see_job(job_id))
  );

create policy capture_tokens_read on public.capture_tokens
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- ---------------------------------------------------------------------------
-- payments — written via record_payment().
-- ---------------------------------------------------------------------------
grant select on public.payments to authenticated;

create policy payments_read on public.payments
  for select to authenticated using (public.can_see_job(job_id));

-- ---------------------------------------------------------------------------
-- Reschedules, cancellations, audit. job_events has NO write grant to anyone:
-- it is append-only from SECURITY DEFINER functions.
-- ---------------------------------------------------------------------------
grant select on public.job_reschedules, public.job_cancellations, public.job_events
  to authenticated;

create policy reschedules_read on public.job_reschedules
  for select to authenticated using (public.can_see_job(job_id));

create policy cancellations_read on public.job_cancellations
  for select to authenticated using (public.can_see_job(job_id));

create policy events_read on public.job_events
  for select to authenticated
  using (public.is_admin() or (job_id is not null and public.can_see_job(job_id)));

-- ---------------------------------------------------------------------------
-- notifications — no direct table access. The in-app inbox reads a view.
-- ---------------------------------------------------------------------------
create view public.my_notifications
with (security_invoker = on) as
  select id, job_id, roster_id, template_key, payload, due_at, sent_at, read_at, created_at
    from public.notifications
   where recipient_id = (select auth.uid())
     and channel = 'in_app'
     and state = 'SENT';

grant select on public.my_notifications to authenticated;

create policy notifications_own_read on public.notifications
  for select to authenticated using (recipient_id = (select auth.uid()));

grant update (read_at) on public.notifications to authenticated;
create policy notifications_mark_read on public.notifications
  for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- push_subscriptions — each device manages its own registration.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.push_subscriptions to authenticated;

create policy push_own on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Internals: admin visibility only, no writes from the client at all.
-- ---------------------------------------------------------------------------
grant select on public.travel_estimates to authenticated;
create policy travel_admin_read on public.travel_estimates
  for select to authenticated using (public.is_admin());

create policy recompute_admin_read on public.recompute_queue
  for select to authenticated using (public.is_admin());
grant select on public.recompute_queue to authenticated;

-- ---------------------------------------------------------------------------
-- Execute grants. Everything that mutates state is a SECURITY DEFINER RPC.
-- ---------------------------------------------------------------------------
grant execute on function
  public.create_job(jsonb),
  public.reschedule_job(uuid, timestamptz, uuid, text, uuid, boolean),
  public.cancel_job(uuid, uuid, text, boolean),
  public.advance_job_status(uuid, public.job_status, jsonb),
  public.issue_capture_token(public.photo_kind, uuid, uuid, uuid),
  public.record_photo(uuid, text, text, int, int, int, text, int, timestamptz,
                      double precision, double precision, numeric),
  public.submit_checkin(date, double precision, double precision, numeric, timestamptz,
                        text, text, timestamptz, text),
  public.review_roster(uuid, boolean, text),
  public.waive_late(uuid, text),
  public.record_payment(uuid, numeric, public.payment_mode, text),
  public.app_role(), public.is_admin(), public.is_sales_rep(), public.is_supervisor(),
  public.can_see_job(uuid), public.get_setting(text, jsonb)
to authenticated;

-- Scheduler internals are service_role only. A supervisor must never be able
-- to trigger a Maps-billing recompute storm from a phone.
revoke execute on function
  public.recompute_day(uuid, date),
  public.drain_recompute_queue(int),
  public.sweep_late(),
  public.claim_notifications(text, int),
  public.mark_notification_sent(uuid, text),
  public.mark_notification_failed(uuid, text),
  public.enqueue_notification(uuid, text, public.notif_channel, timestamptz, uuid, uuid, jsonb, int)
from authenticated, anon, public;
