-- Mark a job's payment and attach the UPI proof in one step, so a UPI payment
-- never lands without its proof (or the "call the office" flag).
create or replace function public.record_job_payment_with_proof(
  p_job_id      uuid,
  p_upi_amount  numeric,
  p_cash_amount numeric,
  p_worker_ids  uuid[] default '{}',
  p_note        text default null,
  p_proof_kind  text default null,
  p_proof_path  text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if coalesce(p_upi_amount, 0) > 0 and p_proof_kind is null then
    raise exception 'Add proof of the UPI payment: a photo, a screenshot, or call the office';
  end if;
  perform public.record_job_payment(p_job_id, p_upi_amount, p_cash_amount, p_worker_ids, p_note);
  if coalesce(p_upi_amount, 0) > 0 then
    perform public.attach_payment_proof(p_job_id, p_proof_kind, p_proof_path);
  end if;
end;
$fn$;

revoke execute on function public.record_job_payment_with_proof(uuid, numeric, numeric, uuid[], text, text, text) from public, anon;
grant execute on function public.record_job_payment_with_proof(uuid, numeric, numeric, uuid[], text, text, text) to authenticated;
