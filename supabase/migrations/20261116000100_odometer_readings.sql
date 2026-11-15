-- What the system read off each odometer photo, kept beside what the
-- supervisor typed. The app fills the km box from the photo and the supervisor
-- confirms or corrects it; when the two differ, the office sees both on the
-- approval card.
--
-- One row per photo, written only by the server (service role) after it reads
-- the image, never by the phone. A reading that failed is still recorded, with
-- read_km null, so "the photo could not be read" is distinguishable from
-- "nobody tried".

create table if not exists public.odometer_readings (
  photo_id   uuid primary key references public.photos(id) on delete cascade,
  read_km    numeric,
  engine     text not null,             -- 'google_vision' or 'tesseract'
  raw_text   text,
  created_at timestamptz not null default now()
);

alter table public.odometer_readings enable row level security;

-- The office sees every reading; a supervisor sees the readings of their own
-- photos. Nobody writes through the API: the server uses the service role.
drop policy if exists odometer_readings_read on public.odometer_readings;
create policy odometer_readings_read on public.odometer_readings
  for select to authenticated
  using (
    public.is_admin() or public.is_sales_rep()
    or exists (
      select 1 from public.photos p
       where p.id = odometer_readings.photo_id and p.uploaded_by = auth.uid()
    )
  );

revoke all on public.odometer_readings from anon;
grant select on public.odometer_readings to authenticated;
