-- What the app read off each odometer photo, kept beside what the supervisor
-- typed. The photo's number pre-fills the km box; the supervisor confirms or
-- corrects it. When the two differ, the office sees both on the approval card.
--
-- Written only by the server (service role) right after reading the photo, so
-- a supervisor cannot set "what the photo said". Never updated: a retake is a
-- new photo with its own row.

create table if not exists public.odometer_readings (
  photo_id   uuid primary key references public.photos(id) on delete cascade,
  read_km    numeric,            -- null when nothing on the photo looked like an odometer
  raw_text   text,               -- what the reader saw, for checking a disputed number
  engine     text not null,      -- 'google_vision' or 'tesseract'
  created_at timestamptz not null default now()
);

alter table public.odometer_readings enable row level security;

-- The office sees every reading; a supervisor sees the readings of their own photos.
drop policy if exists odometer_readings_read on public.odometer_readings;
create policy odometer_readings_read on public.odometer_readings
  for select to authenticated
  using (
    public.is_admin() or public.is_sales_rep()
    or exists (select 1 from public.photos p where p.id = photo_id and p.uploaded_by = auth.uid())
  );

revoke insert, update, delete on public.odometer_readings from authenticated, anon;
