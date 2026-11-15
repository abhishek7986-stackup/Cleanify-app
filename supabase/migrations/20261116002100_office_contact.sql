-- Who the supervisor calls about a job: the sales rep who booked it, or, if
-- they have no number or have left, another active sales rep, then an admin.
-- Supervisors cannot read staff profiles, so this returns just a name and phone.
create or replace function public.office_contact_for_job(p_job_id uuid)
returns table (full_name text, phone text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_job public.jobs;
begin
  select * into v_job from public.jobs where id = p_job_id;
  if not found then
    return;
  end if;
  if not (public.is_admin() or public.is_sales_rep() or v_job.assigned_supervisor_id = auth.uid()) then
    raise exception 'Not your job' using errcode = 'insufficient_privilege';
  end if;
  return query
    select p.full_name, p.phone
      from public.profiles p
     where p.is_active
       and nullif(trim(coalesce(p.phone, '')), '') is not null
       and p.role in ('sales_rep', 'admin')
     order by (p.id = v_job.created_by_sales_rep_id) desc, (p.role = 'sales_rep') desc, p.full_name
     limit 1;
end;
$fn$;

revoke execute on function public.office_contact_for_job(uuid) from public, anon;
grant execute on function public.office_contact_for_job(uuid) to authenticated;
