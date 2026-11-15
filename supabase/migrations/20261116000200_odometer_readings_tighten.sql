-- Tightens odometer_readings (created in 20261116000100): only the two known
-- readers can be recorded, and signed-in staff get read-only access (writes
-- come from the server's service role, never from a phone).

alter table public.odometer_readings drop constraint if exists odometer_readings_engine_check;
alter table public.odometer_readings
  add constraint odometer_readings_engine_check check (engine in ('google_vision', 'tesseract'));

revoke all on public.odometer_readings from anon, authenticated;
grant select on public.odometer_readings to authenticated;
