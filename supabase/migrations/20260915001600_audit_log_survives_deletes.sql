-- ============================================================================
-- Cleanify Ops — 16. The audit log must outlive what it audits
--
-- job_events.job_id was declared ON DELETE CASCADE, but job_events also has an
-- append-only trigger rejecting UPDATE and DELETE. The two contradict: the
-- cascade tries to delete audit rows, the trigger refuses, and the result is
-- that a job can never be deleted at all.
--
-- Switching to ON DELETE SET NULL does not help either — that is an UPDATE,
-- which the same trigger blocks.
--
-- So the foreign keys come off. This is the normal shape for an audit table:
-- it records the id that was involved, but is not constrained by whether that
-- row still exists. Deleting a job now leaves its history intact, which is the
-- behaviour you actually want from an audit trail, and the append-only
-- guarantee stays absolute — not even a service-role key can rewrite it.
--
-- Note that in normal operation jobs are CANCELLED, never deleted. This mainly
-- matters for cleanup, test fixtures, and genuine data-entry mistakes.
-- ============================================================================
set search_path = public, extensions;

alter table public.job_events drop constraint if exists job_events_job_id_fkey;
alter table public.job_events drop constraint if exists job_events_roster_id_fkey;

comment on column public.job_events.job_id is
  'Intentionally NOT a foreign key: the audit trail survives deletion of the job it describes.';

-- Same reasoning for the notification outbox: a sent notification is a record
-- that something was actually delivered to a person. Cascading it away with the
-- job loses the evidence.
alter table public.notifications drop constraint if exists notifications_job_id_fkey;
alter table public.notifications drop constraint if exists notifications_roster_id_fkey;
