-- ============================================================================
-- Cleanify Ops — 03. Operational tables
-- clients, jobs, line items, rosters, photos, money, audit, notifications
-- ============================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- clients — lightweight only. This is NOT a CRM in v1; it exists so repeat
-- clients aren't retyped. Phone is indexed but NOT unique: one building
-- manager can own many buildings.
-- ---------------------------------------------------------------------------
create table public.clients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  phone           text,
  alt_phone       text,
  email           text,
  address_line    text not null,
  landmark        text,
  locality        text,
  city            text,
  pincode         text,
  location        extensions.geography(Point, 4326) not null,
  location_source text not null default 'map_pin'
                    check (location_source in ('map_pin','geocoded','device')),
  google_place_id text,
  notes           text,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- jobs
-- ---------------------------------------------------------------------------
create sequence public.job_number_seq;

create table public.jobs (
  id                  uuid primary key default gen_random_uuid(),
  job_number          text not null unique
                        default 'CLN-' || to_char(now(), 'YYYY') || '-'
                             || lpad(nextval('public.job_number_seq')::text, 6, '0'),

  client_id           uuid not null references public.clients(id),
  service_id          uuid not null references public.services(id),

  -- Pinned schema versions: this job renders and validates against the schema
  -- as it stood when the job was created, forever.
  job_field_schema_id uuid not null references public.service_field_schemas(id),
  line_item_schema_id uuid references public.service_field_schemas(id),
  service_details     jsonb not null default '{}'::jsonb,

  site_location       extensions.geography(Point, 4326) not null,
  site_address        text not null,
  site_landmark       text,

  scheduled_start        timestamptz not null,
  estimated_duration_min int not null default 60 check (estimated_duration_min > 0),

  -- Stored, generated, and in IST. The timetable, itinerary ordering and every
  -- daily rollup key on this, so nobody can file an 04:00 IST job under the
  -- previous day with a naive date_trunc.
  service_date date generated always as
    (((scheduled_start at time zone 'Asia/Kolkata')::date)) stored,

  assigned_supervisor_id  uuid references public.profiles(id),
  created_by_sales_rep_id uuid not null references public.profiles(id),
  status                  public.job_status not null default 'DRAFT',

  -- itinerary + travel (filled asynchronously; never on the save path)
  sequence_in_day         int,
  travel_minutes          int,
  travel_minutes_override int check (travel_minutes_override is null or travel_minutes_override >= 0),
  travel_source           public.travel_source,
  travel_origin_job_id    uuid references public.jobs(id),
  expected_departure_at   timestamptz,
  required_arrival_at     timestamptz,
  deadline_computed_at    timestamptz,
  deadline_state          text not null default 'pending'
                            check (deadline_state in ('pending','ok','failed','manual')),
  itinerary_flags         text[] not null default '{}',
  checkin_policy_key      text references public.checkin_policies(key),

  -- lateness is a FLAG, never a state
  is_late          boolean not null default false,
  late_marked_at   timestamptz,
  late_blameless   boolean not null default false,
  late_waived_by   uuid references public.profiles(id),
  late_waived_at   timestamptz,
  waive_reason     text,

  quoted_amount    numeric(10,2) check (quoted_amount is null or quoted_amount >= 0),

  -- Instrumented from day one: actual_departure_at - expected_departure_at is
  -- the only honest way to tune travel.buffer_multiplier. Without it you are
  -- tuning by anecdote.
  actual_departure_at timestamptz,
  arrived_at       timestamptz,
  actual_start_at  timestamptz,
  actual_end_at    timestamptz,
  completed_at     timestamptz,
  completion_note  text,
  internal_notes   text,
  reschedule_count int not null default 0,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint waiver_needs_reason check (late_waived_by is null or waive_reason is not null)
);

comment on column public.jobs.late_blameless is
  'True when the PREVIOUS job overran. Still recorded as late, but the alert to '
  'sales rep and admin is suppressed — punishing someone because the previous '
  'job ran over is the fastest way to lose the team''s trust in the app.';

-- ---------------------------------------------------------------------------
-- job_line_items — one row per tank / per panel array.
-- The NUMBER of tanks is the count of these rows, never a field.
-- ---------------------------------------------------------------------------
create table public.job_line_items (
  id        uuid primary key default gen_random_uuid(),
  job_id    uuid not null references public.jobs(id) on delete cascade,
  position  int not null check (position > 0),
  schema_id uuid not null references public.service_field_schemas(id),
  label     text,                                  -- 'Tank 1 (terrace)'
  -- {"capacity_litres":5000,"tank_type":"concrete","notes":"needs ladder"}
  details   jsonb not null default '{}'::jsonb,
  is_done   boolean not null default false,
  done_at   timestamptz,
  created_at timestamptz not null default now(),
  unique (job_id, position)
);

-- ---------------------------------------------------------------------------
-- day_rosters — the day's base check-in, one per supervisor per day.
-- A supervisor loads the van at the depot once and then does 2-4 jobs.
-- Re-photographing the machinery in a client's driveway at job #3 proves
-- nothing, so the equipment + PPE photos hang off the DAY, not each job.
-- ---------------------------------------------------------------------------
create table public.day_rosters (
  id            uuid primary key default gen_random_uuid(),
  supervisor_id uuid not null references public.profiles(id),
  roster_date   date not null,
  first_job_id  uuid references public.jobs(id),

  -- deadline, derived from the FIRST job's travel time
  checkin_policy_key   text references public.checkin_policies(key),
  depart_by            timestamptz,
  required_checkin_at  timestamptz,
  reminder_at          timestamptz,
  deadline_computed_at timestamptz,

  -- submission. submitted_at is the SERVER clock, always.
  submitted_at        timestamptz,
  client_reported_at  timestamptz,                  -- what the device claimed
  clock_skew_seconds  int generated always as
    (extract(epoch from (client_reported_at - submitted_at))::int) stored,

  location                 extensions.geography(Point, 4326),
  accuracy_m               numeric,
  distance_from_expected_m numeric,

  checkin_status public.checkin_status,
  flags          text[] not null default '{}',
  risk_score     int not null default 0,

  -- sales rep review. Non-blocking: the supervisor departs immediately and
  -- the rep reviews afterwards.
  approval_status  public.approval_status not null default 'PENDING',
  approved_by      uuid references public.profiles(id),
  approved_at      timestamptz,
  rejection_reason text,

  late_notified_at  timestamptz,
  device_fingerprint text,
  user_agent         text,
  offline_queued_at  timestamptz,
  note               text,

  voided_at   timestamptz,
  voided_by   uuid references public.profiles(id),
  void_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (supervisor_id, roster_date),
  constraint rejection_needs_reason check (
    approval_status <> 'REJECTED' or rejection_reason is not null
  )
);

-- ---------------------------------------------------------------------------
-- capture_tokens — what makes camera-only real rather than theatre.
-- A camera-only UI is worthless if the upload endpoint accepts any blob:
-- anyone with dev tools can POST a file from last week. The server issues a
-- short-lived, single-use token when the camera opens and consumes it on
-- upload.
-- ---------------------------------------------------------------------------
create table public.capture_tokens (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  kind             public.photo_kind not null,
  roster_id        uuid references public.day_rosters(id) on delete cascade,
  job_id           uuid references public.jobs(id) on delete cascade,
  job_line_item_id uuid references public.job_line_items(id) on delete cascade,
  issued_at        timestamptz not null default now(),
  expires_at       timestamptz not null,
  consumed_at      timestamptz,
  storage_path     text
);

-- ---------------------------------------------------------------------------
-- photos
-- ---------------------------------------------------------------------------
create table public.photos (
  id               uuid primary key default gen_random_uuid(),
  kind             public.photo_kind not null,
  roster_id        uuid references public.day_rosters(id) on delete cascade,
  job_id           uuid references public.jobs(id) on delete cascade,
  job_line_item_id uuid references public.job_line_items(id) on delete cascade,

  storage_bucket   text not null default 'checkin-photos',
  storage_path     text not null unique,
  watermarked_path text,
  mime_type        text not null,
  bytes            int not null check (bytes > 0),
  width            int,
  height           int,
  sha256           text not null,          -- exact-duplicate detection, indexed

  captured_via       public.capture_method not null,
  camera_facing      text check (camera_facing in ('user','environment')),
  capture_latency_ms int,                  -- camera-open -> shutter
  capture_token_id   uuid references public.capture_tokens(id),

  captured_at_server timestamptz not null default now(),
  client_clock_at    timestamptz,

  lat                      double precision,
  lng                      double precision,
  accuracy_m               numeric,
  distance_from_expected_m numeric,

  flagged     boolean not null default false,
  flag_reason text,

  uploaded_by uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),

  -- every photo must hang off exactly the right parent for its kind
  constraint photo_parent_matches_kind check (
    case kind
      when 'EQUIPMENT'   then roster_id is not null
      when 'PPE_SELFIE'  then roster_id is not null
      when 'SITE_BEFORE' then job_line_item_id is not null and job_id is not null
      when 'SITE_AFTER'  then job_line_item_id is not null and job_id is not null
      when 'ISSUE'       then job_id is not null
      else false
    end
  )
);

-- exactly one equipment photo and one PPE photo per roster
create unique index one_photo_per_roster_kind
  on public.photos (roster_id, kind)
  where roster_id is not null;

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------
create table public.payments (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null unique references public.jobs(id) on delete cascade,
  amount      numeric(10,2) not null check (amount >= 0),
  mode        public.payment_mode not null,
  reference   text,
  collected_at timestamptz,
  recorded_by uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  constraint collected_needs_timestamp check (mode = 'pending' or collected_at is not null)
);

-- ---------------------------------------------------------------------------
-- reschedules + cancellations — kept separate from the event firehose so
-- "why do we cancel?" is a clean query, not jsonb archaeology.
-- ---------------------------------------------------------------------------
create table public.job_reschedules (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null references public.jobs(id) on delete cascade,
  from_start         timestamptz not null,
  to_start           timestamptz not null,
  from_supervisor_id uuid references public.profiles(id),
  to_supervisor_id   uuid references public.profiles(id),
  reason_id          uuid not null references public.reasons(id),
  reason_note        text,
  requested_by       uuid not null references public.profiles(id),
  client_informed    boolean not null default false,
  created_at         timestamptz not null default now()
);

create table public.job_cancellations (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null unique references public.jobs(id) on delete cascade,
  reason_id       uuid not null references public.reasons(id),
  reason_note     text,
  status_before   public.job_status not null,
  cancelled_by    uuid not null references public.profiles(id),
  client_informed boolean not null default false,
  cancelled_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- job_events — append-only audit firehose.
-- Every deadline recomputation lands here with old and new values. When a
-- supervisor says "yesterday it told me 06:40 and today it says 07:10", this
-- table is the only thing that settles the argument.
-- ---------------------------------------------------------------------------
create table public.job_events (
  id          bigint generated always as identity primary key,
  job_id      uuid references public.jobs(id) on delete cascade,
  roster_id   uuid references public.day_rosters(id) on delete cascade,
  event_type  text not null,
  actor_id    uuid references public.profiles(id),     -- null = system
  actor_role  public.user_role,
  from_status public.job_status,
  to_status   public.job_status,
  payload     jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  request_id  uuid
);

-- ---------------------------------------------------------------------------
-- notifications — the outbox. A minutely sweep over this table, not per-job
-- external timers: deadlines here move constantly, and a moved deadline must
-- be an ordinary UPDATE rather than a distributed cancel-and-recreate.
-- ---------------------------------------------------------------------------
create table public.notifications (
  id               uuid primary key default gen_random_uuid(),
  -- job_id | template_key | recipient_id | epoch(due_at)
  -- Baking due_at into the key means a moved deadline always mints a new row
  -- and retires the old one. There is no update-in-place race to lose.
  dedupe_key       text not null unique,
  job_id           uuid references public.jobs(id) on delete cascade,
  roster_id        uuid references public.day_rosters(id) on delete cascade,
  recipient_id     uuid not null references public.profiles(id) on delete cascade,
  template_key     text not null,
  channel          public.notif_channel not null,
  payload          jsonb not null default '{}'::jsonb,
  due_at           timestamptz not null,
  stale_after_min  int not null default 20,
  state            public.notif_state not null default 'PENDING',
  attempts         int not null default 0,
  max_attempts     int not null default 5,
  next_attempt_at  timestamptz,
  claimed_at       timestamptz,
  claimed_by       text,
  lease_expires_at timestamptz,
  sent_at          timestamptz,
  failed_at        timestamptz,
  last_error       text,
  provider_msg_id  text,
  superseded_by    uuid references public.notifications(id),
  read_at          timestamptz,                    -- for the in-app inbox
  created_at       timestamptz not null default now()
);

create table public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  endpoint        text not null unique,
  p256dh          text not null,
  auth            text not null,
  user_agent      text,
  platform        text check (platform in ('ios','android','desktop','other')),
  is_standalone   boolean,                         -- installed to home screen?
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  last_success_at timestamptz,
  last_ack_at     timestamptz,                     -- from the 05:30 heartbeat
  failure_count   int not null default 0,
  disabled_at     timestamptz
);

-- ---------------------------------------------------------------------------
-- recompute_queue — coalescing. A rep tweaking a time three times in ten
-- seconds must produce ONE recompute, not three fans-out of Maps lookups.
-- ---------------------------------------------------------------------------
create table public.recompute_queue (
  supervisor_id uuid not null references public.profiles(id) on delete cascade,
  service_date  date not null,
  due_at        timestamptz not null default now() + interval '5 seconds',
  attempts      int not null default 0,
  primary key (supervisor_id, service_date)
);
