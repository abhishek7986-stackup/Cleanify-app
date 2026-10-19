-- ============================================================================
-- Cleanify Ops — 27. Sales can approve finished work
-- ============================================================================
-- After photos were admin-only. The sales team already approves the depot
-- check-in and the before photos, and the admin does not have time to be the
-- last step on every job, so sales or admin may now approve after photos too.
-- Approving them still completes the job. The completion event now records
-- the reviewer's real role instead of always saying admin.
set search_path = public, extensions;

create or replace function public.review_site_photos(
  p_job_id  uuid,
  p_stage   text,
  p_approve boolean,
  p_reason  text default null
)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_job public.jobs;
begin
  if not (public.is_sales_rep() or public.is_admin()) then
    raise exception 'Only sales or admin can review site photos' using errcode = 'insufficient_privilege';
  end if;
  if p_stage not in ('before', 'after') then
    raise exception 'Stage must be before or after' using errcode = 'invalid_parameter_value';
  end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then
    raise exception 'A rejection needs a reason' using errcode = 'check_violation';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'Job not found' using errcode = 'no_data_found';
  end if;
  if (p_stage = 'before' and v_job.before_review is distinct from 'PENDING')
     or (p_stage = 'after' and v_job.after_review is distinct from 'PENDING') then
    raise exception 'Nothing waiting for review' using errcode = 'no_data_found';
  end if;

  if p_stage = 'before' then
    update public.jobs
       set before_review = case when p_approve then 'APPROVED' else 'REJECTED' end::public.approval_status,
           before_reviewed_by = v_uid, before_reviewed_at = now(),
           before_rejection_reason = case when p_approve then null else trim(p_reason) end
     where id = p_job_id returning * into v_job;
  elsif p_approve then
    update public.jobs
       set after_review = 'APPROVED', after_reviewed_by = v_uid, after_reviewed_at = now(),
           after_rejection_reason = null,
           status = 'COMPLETED', completed_at = now(), actual_end_at = now()
     where id = p_job_id returning * into v_job;
    insert into public.job_events (job_id, actor_id, actor_role, event_type, from_status, to_status, payload)
    values (p_job_id, v_uid, public.app_role(), 'status.changed', 'IN_PROGRESS', 'COMPLETED',
            jsonb_build_object('via', 'after_photos_approved'));
    perform public.cancel_pending_notifications(p_job_id, null, null);
  else
    update public.jobs
       set after_review = 'REJECTED', after_reviewed_by = v_uid, after_reviewed_at = now(),
           after_rejection_reason = trim(p_reason)
     where id = p_job_id returning * into v_job;
  end if;

  insert into public.job_events (job_id, actor_id, actor_role, event_type, payload)
  values (p_job_id, v_uid, public.app_role(),
          'photos.' || p_stage || case when p_approve then '.approved' else '.rejected' end,
          jsonb_build_object('reason', p_reason));

  return v_job;
end;
$fn$;
