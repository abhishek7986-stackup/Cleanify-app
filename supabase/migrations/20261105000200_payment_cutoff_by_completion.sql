-- ============================================================================
-- "Not collected yet" should mean jobs finished since payments went live.
-- Keying on the booked date wrongly listed old test jobs booked for future
-- dates, so this keys on when the job was actually completed.
-- ============================================================================
create or replace function public.jobs_awaiting_payment()
returns table (
  job_id          uuid,
  job_number      text,
  client_name     text,
  supervisor_name text,
  quoted_amount   numeric,
  service_date    date,
  status          public.job_status
)
language sql stable
set search_path = ''
as $fn$
  select j.id, j.job_number, c.name, d.full_name, j.quoted_amount, j.service_date, j.status
    from public.jobs j
    left join public.clients c on c.id = j.client_id
    left join public.staff_directory d on d.id = j.assigned_supervisor_id
   where ((j.status = 'COMPLETED' and j.completed_at >= timestamptz '2026-11-05 00:00:00+05:30')
          or (j.status = 'IN_PROGRESS' and j.after_review is not null))
     and not exists (select 1 from public.payments p where p.job_id = j.id and p.voided_at is null)
   order by j.service_date, j.job_number
$fn$;
