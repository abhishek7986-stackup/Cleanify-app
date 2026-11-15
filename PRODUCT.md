# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(An installable web app, a PWA. It runs mostly on supervisors' Android phones; the office uses it on phones and laptops.)

## Users

- **Supervisors**: lead a small cleaning crew in the field (water tanks, bathrooms, solar panels). They use it all day on budget and mid-range Android phones, mostly outdoors in sunlight, often one-handed, sometimes with wet or gloved hands. Their job: check in at the depot, ride to each site in order, prove the work with live photos, collect payment, and check out.
- **Calling staff / sales rep** (the office): book clients and jobs, approve check-ins and before/after photos, check and correct payments, add workers and assign them to supervisors, and run weekly payouts.
- **Admin and super admin**: everything the office does, plus staff logins and services. The super admin fills in for anyone who is away.
- Workers (cleaning staff) do not log in. The office adds them and supervisors tick who worked each job.

## Product Purpose

Cleanify Operations is the internal field-operations app for Cleanify, a cleaning-services business run by StackUp. It turns each day's bookings into a supervisor's route, makes every step provable (live-camera photos, location, approvals), and keeps the money straight: collections, corrections, and each person's weekly pay worked out from frozen percentages. Success means jobs done in order, on time, with no unprovable work and no disputed money.

## Positioning

An app built around proof and order, not just scheduling: one job at a time, nothing starts until the office approves the photos, and every money change is kept on record with who did it and why.

## Operating Context

- Supervisors' day: depot check-in (safety-gear selfie, odometer photo and km reading) → office approval → ride to stop 1 → "I've reached" → before photos → approval → clean → after photos → approval → collect payment → next stop → check-out after the last job.
- Jobs open strictly in order; check-out opens only after the last job is finished.
- Sites are in and around Hyderabad. Navigation hands off to Google Maps (two-wheeler mode).
- Location is shared with the office only between check-in and check-out, and only while the app is open.

## Capabilities and Constraints

- Next.js 16 + Supabase. Live-camera-only photos. Works offline for photo capture (upload queue).
- Free OpenStreetMap maps (MapLibre). Google Vision and Google Routes are wired but switched off until billing is active; a free on-server reader reads odometer photos meanwhile.
- Light theme only (outdoor sunlight); touch targets at least 48 px.
- No native app: background location and closed-app notifications are limited by the phone.

## Brand Commitments

- Name: "Cleanify Operations", internal use only. Existing water-drop app icon.
- Supervisor screens should feel like a **delivery partner app** (Swiggy, Zomato, Uber driver): one clear task at a time, a big status, a bold action bar. The user's stated choice, 16 Nov 2026.
- The user rejected the previous look as childish: too rounded and bubbly, too many boxes, weak text hierarchy, colours that feel off.

## Evidence on Hand

- Demo data only (clients and workers marked "(Demo)"), to be removed before launch with `npm run demo:week -- --remove`.
- No real client testimonials, logos or photos exist; none may be invented.

## Product Principles

1. One job at a time: the screen always says what to do next, and only that.
2. Proof over trust: every step that matters carries a photo, a time, a place, or an approval.
3. Nothing is deleted: corrections and cancellations stay on record with a reason.
4. Built for the field: readable in sunlight, usable one-handed, forgiving of weak signal.

## Accessibility & Inclusion

- Outdoor sunlight readability: high contrast, no reliance on colour alone for status.
- Large touch targets for gloved or wet hands; simple English wording.
