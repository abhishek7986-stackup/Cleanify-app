-- staff_breakdown: "given back" now also counts money returned at a Monday
-- settlement, not only mid-week handovers.

create or replace function public.staff_breakdown(p_from date, p_to date)
returns table (
  staff_id          uuid,
  full_name         text,
  kind              text,
  jobs              int,
  salary            numeric,
  expenses          numeric,
  expenses_pending  numeric,
  cash_collected    numeric,
  handed_back       numeric,
  cash_in_hand      numeric
)
language plpgsql stable
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_monday date := date_trunc('week', (now() at time zone 'Asia/Kolkata'))::date;
begin
  if not (public.is_admin() or public.is_sales_rep()) then
    raise exception 'Only calling staff or an admin can see the staff breakdown' using errcode = 'insufficient_privilege';
  end if;
  return query
  select s.id, s.full_name, s.kind,
         (select count(*)::int from public.job_earnings e join public.jobs j on j.id = e.job_id
           where e.staff_id = s.id and e.voided_at is null and j.service_date between p_from and p_to),
         coalesce((select sum(e.amount) from public.job_earnings e join public.jobs j on j.id = e.job_id
                    where e.staff_id = s.id and e.voided_at is null and j.service_date between p_from and p_to), 0),
         coalesce((select sum(x.amount) from public.expenses x
                    where x.staff_id = s.id and x.status = 'APPROVED' and x.voided_at is null
                      and x.spent_on between p_from and p_to), 0),
         coalesce((select sum(x.amount) from public.expenses x
                    where x.staff_id = s.id and x.status = 'PENDING' and x.voided_at is null), 0),
         coalesce((select sum(p.amount) from public.payments p
                    where p.held_by_staff_id = s.id and p.mode = 'cash' and p.voided_at is null
                      and (p.collected_at at time zone 'Asia/Kolkata')::date between p_from and p_to), 0),
         coalesce((select sum(h.amount) from public.cash_handovers h
                    where h.staff_id = s.id and h.status = 'CONFIRMED' and h.voided_at is null
                      and (h.reviewed_at at time zone 'Asia/Kolkata')::date between p_from and p_to), 0)
         + coalesce((select sum(-o.settled_amount) from public.payouts o
                    where o.staff_id = s.id and o.reversed_at is null and o.settled_amount < 0
                      and (o.settled_at at time zone 'Asia/Kolkata')::date between p_from and p_to), 0),
         greatest(0, -(public.pay_brought_forward(s.id, v_monday)
              + coalesce((select sum(e.amount) from public.job_earnings e
                           where e.staff_id = s.id and e.week_start = v_monday and e.voided_at is null), 0)
              - coalesce((select sum(p.amount) from public.payments p
                           where p.held_by_staff_id = s.id and p.mode = 'cash'
                             and p.week_start = v_monday and p.voided_at is null), 0)
              + public.handed_back(s.id, v_monday)))
    from public.pay_staff s
   where s.is_active
      or exists (select 1 from public.job_earnings e join public.jobs j on j.id = e.job_id
                  where e.staff_id = s.id and j.service_date between p_from and p_to)
   order by s.kind, s.full_name;
end;
$fn$;

revoke execute on function public.staff_breakdown(date, date) from public, anon;
grant execute on function public.staff_breakdown(date, date) to authenticated;
