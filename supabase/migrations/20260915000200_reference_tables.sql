-- ============================================================================
-- Cleanify Ops — 02. Reference tables
-- people, settings, policies, reasons, and the dynamic service schema
-- ============================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- app_settings — tunables that must change without a deploy
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  description text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

comment on table public.app_settings is
  'Operational tunables. Changing checkin.* or travel.* triggers a recompute of future jobs.';

-- ---------------------------------------------------------------------------
-- profiles — one row per staff member, 1:1 with auth.users
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                       uuid primary key references auth.users(id) on delete cascade,
  full_name                text not null,
  phone                    text,                                  -- E.164, +91...
  role                     public.user_role not null,
  is_active                boolean not null default true,
  locale                   text not null default 'en',            -- v2 will add hi/te
  -- supervisor-only: where they start the day from
  base_location            extensions.geography(Point, 4326),
  base_address             text,
  base_location_updated_at timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint supervisor_needs_base check (
    role <> 'supervisor' or not is_active or base_location is not null
  )
);

comment on column public.profiles.base_location is
  'Depot / start location. Origin for the first job of the day; drives the check-in deadline.';

-- ---------------------------------------------------------------------------
-- checkin_policies — the swappable deadline rule
-- ---------------------------------------------------------------------------
-- The arithmetic for these lives in exactly ONE place (public.compute_deadline).
-- If it leaks into the UI countdown, the notification enqueue and the late
-- sweep, changing policy becomes a three-day bug hunt.
create table public.checkin_policies (
  key         text primary key,
  name        text not null,
  description text,
  params      jsonb not null,
  is_default  boolean not null default false
);

create unique index one_default_policy
  on public.checkin_policies ((is_default)) where is_default;

-- ---------------------------------------------------------------------------
-- reasons — admin-managed; adding one must not need a deploy
-- ---------------------------------------------------------------------------
create table public.reasons (
  id            uuid primary key default gen_random_uuid(),
  category      text not null check (category in ('reschedule','cancellation','late','no_show','rejection')),
  code          text not null,
  label         text not null,
  requires_note boolean not null default false,
  is_active     boolean not null default true,
  sort_order    int not null default 0,
  unique (category, code)
);

-- ---------------------------------------------------------------------------
-- services + versioned field schemas
-- ---------------------------------------------------------------------------
create table public.services (
  id                   uuid primary key default gen_random_uuid(),
  key                  text not null unique,      -- 'water_tank_cleaning'
  name                 text not null,
  description          text,
  icon                 text,
  is_active            boolean not null default true,
  has_line_items       boolean not null default false,
  line_item_singular   text,                      -- 'Tank'
  line_item_plural     text,                      -- 'Tanks'
  default_duration_min int not null default 60,
  default_policy_key   text references public.checkin_policies(key),
  sort_order           int not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint line_item_labels_present check (
    not has_line_items or (line_item_singular is not null and line_item_plural is not null)
  )
);

-- A job created in March must still render and validate against the schema it
-- was created with, after an admin edits the fields in June. Jobs pin a schema
-- id; publishing mints a new version. Without this, every admin edit silently
-- corrupts history.
create table public.service_field_schemas (
  id           uuid primary key default gen_random_uuid(),
  service_id   uuid not null references public.services(id) on delete cascade,
  scope        public.schema_scope not null,
  version      int not null,
  status       public.schema_status not null default 'draft',
  published_at timestamptz,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  unique (service_id, scope, version)
);

create unique index one_published_schema_per_scope
  on public.service_field_schemas (service_id, scope)
  where status = 'published';

create table public.service_fields (
  id              uuid primary key default gen_random_uuid(),
  schema_id       uuid not null references public.service_field_schemas(id) on delete cascade,
  key             text not null,        -- IMMUTABLE once published (enforced by trigger)
  label           text not null,
  help_text       text,
  field_type      public.field_type not null,
  is_required     boolean not null default false,
  is_reportable   boolean not null default false,
  sort_order      int not null default 0,
  -- {min,max,step,unit:'L',options:[{value,label}],maxLength,default,placeholder}
  config          jsonb not null default '{}'::jsonb,
  -- {field:'tank_type', op:'eq', value:'concrete'}
  visibility_rule jsonb,
  archived_at     timestamptz,          -- archive, never delete
  created_at      timestamptz not null default now(),
  unique (schema_id, key),
  constraint field_key_is_slug check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  constraint select_needs_options check (
    field_type not in ('select','multiselect')
    or jsonb_array_length(coalesce(config->'options','[]'::jsonb)) > 0
  )
);

comment on column public.service_fields.key is
  'Immutable after publish. Answers are stored keyed by this, not by label.';

-- app_settings was created before profiles, so its FK is added here.
alter table public.app_settings
  add constraint app_settings_updated_by_fkey
  foreign key (updated_by) references public.profiles(id);
