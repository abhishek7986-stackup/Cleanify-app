-- ============================================================================
-- Cleanify Ops — 28. Photo kinds for the scooter km reading and check-out
-- ============================================================================
-- The morning check-in becomes a selfie + the scooter's odometer (instead of
-- the machinery photo), and the day now ends with a check-out that takes the
-- same two photos. New enum values must be committed before any statement
-- can use them, so they live in their own migration ahead of 29.
alter type public.photo_kind add value if not exists 'ODOMETER';
alter type public.photo_kind add value if not exists 'CHECKOUT_SELFIE';
alter type public.photo_kind add value if not exists 'CHECKOUT_ODOMETER';
