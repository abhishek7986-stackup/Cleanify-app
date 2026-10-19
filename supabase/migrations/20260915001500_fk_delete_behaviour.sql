-- ============================================================================
-- Cleanify Ops — 15. Delete behaviour for the two computed job references
--
-- Both of these columns are derived breadcrumbs that recompute_day() rewrites
-- on every pass, but they were declared with the default NO ACTION. That makes
-- deleting any job that happens to be a day's anchor — or any job that a later
-- job chained its travel from — fail with a foreign key violation.
--
-- SET NULL is right for both: the next recompute re-derives them. CASCADE
-- would be actively wrong, since deleting one job must never silently delete a
-- roster or another job.
-- ============================================================================
set search_path = public, extensions;

alter table public.day_rosters
  drop constraint day_rosters_first_job_id_fkey,
  add  constraint day_rosters_first_job_id_fkey
       foreign key (first_job_id) references public.jobs(id) on delete set null;

alter table public.jobs
  drop constraint jobs_travel_origin_job_id_fkey,
  add  constraint jobs_travel_origin_job_id_fkey
       foreign key (travel_origin_job_id) references public.jobs(id) on delete set null;
