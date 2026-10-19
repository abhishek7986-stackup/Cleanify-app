-- ============================================================================
-- Cleanify Ops — 04. Indexes
-- ============================================================================
set search_path = public, extensions;

-- --- people -----------------------------------------------------------------
create index profiles_role_active_idx on public.profiles (role) where is_active;
create index profiles_base_location_gix on public.profiles using gist (base_location);

-- --- dynamic schema ---------------------------------------------------------
create index service_fields_schema_idx
  on public.service_fields (schema_id, sort_order) where archived_at is null;
create index service_field_schemas_service_idx
  on public.service_field_schemas (service_id, scope, status);

-- --- clients ----------------------------------------------------------------
-- NOT unique: one building manager can own many buildings.
create index clients_phone_idx    on public.clients (phone);
create index clients_location_gix on public.clients using gist (location);
create index clients_name_trgm_idx on public.clients (lower(name));

-- --- jobs -------------------------------------------------------------------
-- The supervisor's day, in itinerary order. Drives the roadmap screen and
-- every chained travel computation.
create index jobs_supervisor_day_idx
  on public.jobs (assigned_supervisor_id, service_date, sequence_in_day);

-- The admin/sales-rep day timetable.
create index jobs_day_status_idx on public.jobs (service_date, status);

-- "My jobs" for a sales rep, and late alerts routed back to their creator.
create index jobs_creator_day_idx on public.jobs (created_by_sales_rep_id, service_date);

-- The hot sweep. The late detector runs this every minute, so keep it narrow.
create index jobs_arrival_sweep_idx
  on public.jobs (required_arrival_at)
  where status in ('ASSIGNED','CHECKED_IN','EN_ROUTE') and is_late = false;

create index jobs_site_location_gix on public.jobs using gist (site_location);
create index jobs_client_idx        on public.jobs (client_id);
create index jobs_service_idx       on public.jobs (service_id);

-- Containment queries over the dynamic service answers.
create index jobs_service_details_gin
  on public.jobs using gin (service_details jsonb_path_ops);

-- Jobs whose travel/deadline could not be computed — the admin attention list.
create index jobs_deadline_attention_idx
  on public.jobs (service_date)
  where deadline_state in ('pending','failed');

create index job_line_items_job_idx on public.job_line_items (job_id, position);

-- --- rosters / check-in -----------------------------------------------------
create index day_rosters_supervisor_idx on public.day_rosters (supervisor_id, roster_date desc);

-- The check-in late sweep: rosters past their deadline with nothing submitted.
create index day_rosters_checkin_sweep_idx
  on public.day_rosters (required_checkin_at)
  where submitted_at is null and voided_at is null;

-- The sales rep's approval queue.
create index day_rosters_pending_approval_idx
  on public.day_rosters (submitted_at desc)
  where approval_status = 'PENDING' and submitted_at is not null and voided_at is null;

-- The admin review queue: anything the system found suspicious.
create index day_rosters_risk_idx
  on public.day_rosters (risk_score desc, submitted_at desc)
  where voided_at is null and risk_score > 0;

-- --- photos -----------------------------------------------------------------
-- The cheapest anti-fraud win available: flag any exact photo reuse across
-- every check-in ever recorded.
create index photos_sha256_idx on public.photos (sha256);
create index photos_roster_idx on public.photos (roster_id) where roster_id is not null;
create index photos_line_item_idx
  on public.photos (job_line_item_id, kind) where job_line_item_id is not null;
create index photos_job_idx    on public.photos (job_id) where job_id is not null;
create index photos_flagged_idx on public.photos (created_at desc) where flagged;

create index capture_tokens_live_idx
  on public.capture_tokens (user_id, expires_at) where consumed_at is null;

-- --- money ------------------------------------------------------------------
create index payments_collected_idx on public.payments (collected_at desc);

-- --- audit ------------------------------------------------------------------
create index job_events_job_idx    on public.job_events (job_id, occurred_at desc);
create index job_events_roster_idx on public.job_events (roster_id, occurred_at desc);
create index job_events_type_idx   on public.job_events (event_type, occurred_at desc);

create index job_reschedules_job_idx on public.job_reschedules (job_id, created_at desc);

-- --- notifications ----------------------------------------------------------
-- The dispatcher's claim query. Partial so it stays small no matter how much
-- history accumulates.
create index notifications_due_idx
  on public.notifications (due_at) where state = 'PENDING';

-- The reaper: rows whose worker died mid-send.
create index notifications_lease_idx
  on public.notifications (lease_expires_at) where state = 'CLAIMED';

-- Supersede lookups during reconcile.
create index notifications_reconcile_idx
  on public.notifications (job_id, template_key, recipient_id) where state = 'PENDING';

-- The in-app inbox.
create index notifications_inbox_idx
  on public.notifications (recipient_id, created_at desc) where state = 'SENT';

create index push_subscriptions_user_idx
  on public.push_subscriptions (user_id) where disabled_at is null;

create index recompute_queue_due_idx on public.recompute_queue (due_at);
