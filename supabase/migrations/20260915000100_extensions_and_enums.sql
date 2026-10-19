-- ============================================================================
-- Cleanify Ops — 01. Extensions and enums
-- ============================================================================
-- On hosted Supabase, postgis / pg_cron / pg_net may also need enabling once
-- from Dashboard → Database → Extensions. These statements are idempotent.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists postgis  with schema extensions;
create extension if not exists pg_net   with schema extensions;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Roles and job lifecycle
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('admin', 'sales_rep', 'supervisor');

-- Deliberately NOT states: RESCHEDULED (a rescheduled job is still an active
-- job that must be done — it stays ASSIGNED, so it cannot vanish from the
-- timetable) and LATE (a flag, because a job can be checked-in AND late, which
-- is exactly what the on-time-rate report needs).
create type public.job_status as enum (
  'DRAFT', 'ASSIGNED', 'CHECKED_IN', 'EN_ROUTE',
  'ON_SITE', 'IN_PROGRESS', 'COMPLETED',
  'CANCELLED', 'NO_SHOW'
);

create type public.checkin_status   as enum ('ON_TIME', 'LATE', 'WAIVED', 'VOIDED');
create type public.approval_status  as enum ('PENDING', 'APPROVED', 'REJECTED');

-- ---------------------------------------------------------------------------
-- Dynamic service schema
-- ---------------------------------------------------------------------------
-- NOTE: tank type (synthetic/concrete) is deliberately NOT an enum. It is a
-- `select` option inside the field schema. Making it an enum would break the
-- "admin adds a service without a code change" requirement on day one.
create type public.field_type as enum (
  'text', 'textarea', 'number', 'integer', 'boolean',
  'select', 'multiselect', 'date', 'time', 'currency'
);
create type public.schema_scope  as enum ('job', 'line_item');
create type public.schema_status as enum ('draft', 'published', 'archived');

-- ---------------------------------------------------------------------------
-- Photos, travel, notifications
-- ---------------------------------------------------------------------------
create type public.photo_kind as enum (
  'EQUIPMENT', 'PPE_SELFIE', 'SITE_BEFORE', 'SITE_AFTER', 'ISSUE'
);
create type public.capture_method as enum ('getusermedia', 'file_input_capture', 'upload');
create type public.travel_source  as enum ('base', 'previous_job', 'manual', 'none');
create type public.payment_mode   as enum ('cash', 'upi', 'bank', 'pending');

create type public.notif_channel as enum ('web_push', 'whatsapp', 'sms', 'email', 'in_app');
create type public.notif_state   as enum (
  'PENDING', 'CLAIMED', 'SENT', 'FAILED', 'CANCELLED', 'SUPERSEDED'
);
