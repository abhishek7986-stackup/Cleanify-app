---
name: Cleanify Operations
description: Field-operations app for cleaning supervisors and the office; a delivery-partner shift app built for sunlight and one thumb.
colors:
  shift-teal: "#0b3532"
  shift-teal-pressed: "#134e4a"
  teal-ink: "#0f766e"
  focus-teal: "#0d9488"
  mint-wash: "#ccfbf1"
  mint-mist: "#f0fdfa"
  canvas: "#eef1f0"
  surface: "#ffffff"
  ink: "#0f172a"
  ink-strong: "#020617"
  ink-muted: "#475569"
  ink-subtle: "#64748b"
  label-grey: "#5b6b69"
  quiet-fill: "#f1f5f9"
  hairline: "rgb(11 53 50 / 0.08)"
  divider: "rgb(11 53 50 / 0.07)"
  outline: "rgb(11 53 50 / 0.15)"
  ok: "#16a34a"
  ok-ink: "#15803d"
  ok-wash: "#f0fdf4"
  warn: "#f59e0b"
  warn-ink: "#b45309"
  warn-wash: "#fef3c7"
  danger: "#dc2626"
  danger-ink: "#b91c1c"
  danger-wash: "#fef2f2"
typography:
  money:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.375
    letterSpacing: "-0.01em"
  bar-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.375
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.04em"
  strip-caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
rounded:
  none: "0px"
  md: "8px"
  lg: "12px"
  full: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  gutter: "16px"
  section: "20px"
  tap: "48px"
  action: "56px"
  tap-lg: "60px"
  tab: "64px"
components:
  button-primary:
    backgroundColor: "{colors.shift-teal}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "{spacing.action}"
    width: "100%"
  button-primary-pressed:
    backgroundColor: "{colors.shift-teal-pressed}"
  button-waiting:
    backgroundColor: "{colors.quiet-fill}"
    textColor: "{colors.ink-subtle}"
    rounded: "{rounded.md}"
    height: "{spacing.action}"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.shift-teal}"
    rounded: "{rounded.md}"
    height: "{spacing.tap}"
  button-outline-pressed:
    backgroundColor: "{colors.mint-mist}"
  app-bar:
    backgroundColor: "{colors.shift-teal}"
    textColor: "{colors.surface}"
    typography: "{typography.bar-title}"
    rounded: "{rounded.none}"
  sheet:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.none}"
    padding: "20px 16px 16px"
  list-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    padding: "14px 16px"
    rounded: "{rounded.none}"
  section-label:
    textColor: "{colors.label-grey}"
    typography: "{typography.label}"
    padding: "0 16px 8px"
  tab-active:
    backgroundColor: "{colors.mint-wash}"
    textColor: "{colors.shift-teal}"
    rounded: "{rounded.full}"
    height: "32px"
    width: "64px"
  input:
    backgroundColor: "#f8fafc"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
---

# Design System: Cleanify Operations

## Overview

**Creative North Star: "The Shift Bar"**

Cleanify's supervisor app is a delivery-partner shift app, the user-pinned direction (Swiggy, Zomato, Uber driver). The screen is built from three fixed layers: a deep-teal app bar on top carrying the title and live shift status in white, full-bleed white bands on a cool grey canvas in the middle, and a fixed white action bar at the bottom holding one full-width button that names the next step. Everything between those two bars is quiet: one current stop with its single next step, then a numbered list of what comes later.

The system is dense but calm. Hierarchy comes from type weight and size, not from containers: the client name at 22px semibold, the next step at 18px semibold beside a coloured dot, and everything else in 15px or 14px slate. Sections are square bands separated by hairlines and canvas gaps, not floating rounded boxes. The user rejected the previous build as childish (too rounded, too many boxes, weak hierarchy, off colours), and this system exists to answer that.

It is light-only on purpose. Supervisors read it outdoors in direct sun, one-handed, sometimes with wet or gloved hands, so contrast stays high, no automatic dark mode exists, and every control clears 48px.

Office screens (`src/app/sales`, `src/app/admin`) share these tokens, the app bar and the tab bar, but they have not yet been fully converted to the band-and-row language. They still use rounded `card` blocks in many places. That is known drift, recorded here and not a pattern to copy (see Do's and Don'ts).

**Key Characteristics:**
- Deep teal app bar with a translucent three-cell shift-status strip inside it.
- Full-bleed white bands (sheets) on a cool grey canvas, divided by teal-tinted hairlines.
- One fixed bottom action bar naming the one next step, in the same deep teal.
- Status shown as a word plus a small dot, never colour alone.
- Tabular figures for every time, km, count and rupee value.
- Corners: 8px on controls, 12px at most, square sections, full circles only for dots, number badges and the active-tab pill.

## Colors

One deep, nearly black teal does all the brand and action work; everything else is cool neutral or status colour.

### Primary
- **Shift Teal** (`shift-teal`): the app bar background, every primary button, the selected stepper step, the progress fill on the pay rate bar, and the "go" dot beside a next step. It is the only filled action colour.
- **Shift Teal Pressed** (`shift-teal-pressed`): the pressed (`:active`) state of primary buttons. Touch screens have no hover, so pressed is the feedback state.
- **Teal Ink** (`teal-ink`): inline links (phone numbers in job details) and small location icons on white.
- **Focus Teal** (`focus-teal`): the 2px focus outline (2px offset) on every focusable element, and the focus ring on inputs.

### Secondary
- **Mint Wash** (`mint-wash`): the pill behind the active bottom-tab icon, and the text selection background (with Shift Teal text).
- **Mint Mist** (`mint-mist`): the pressed state of outline buttons, a faint tint on the next stop's row in the Roadmap, and soft "waiting" panels in the job flow.

### Neutral
- **Canvas** (`canvas`): the page behind the bands. Cool and light, so white bands read as raised without shadows.
- **Surface** (`surface`): every sheet, list row, action bar and tab bar.
- **Ink** (`ink`): body text and row titles. **Ink Strong** (`ink-strong`) is kept for the client name and the payout figure.
- **Ink Muted** (`ink-muted`) and **Ink Subtle** (`ink-subtle`): addresses, secondary lines, inactive tab labels, finished rows.
- **Label Grey** (`label-grey`): section labels only.
- **Quiet Fill** (`quiet-fill`): the "waiting" action button, unfinished number badges, empty stepper steps, the empty part of a progress bar.
- **Hairline** (`hairline`), **Divider** (`divider`), **Outline** (`outline`): Shift Teal at 8%, 7% and 15%. Sheet edges, row dividers, and outline button borders. The action and tab bars use Shift Teal at 10% as their top border.

### Status
- **OK** (`ok`, `ok-ink`, `ok-wash`): done badges (white tick on green circle), approved panels, "Payment marked".
- **Warn** (`warn`, `warn-ink`, `warn-wash`): waiting-for-approval dots (pulsing), "previous job ran over", the offline upload-queue chip.
- **Danger** (`danger`, `danger-ink`, `danger-wash`): rejected steps, "Late", money owed, negative payout, error messages.
- On the teal app bar, status dots use lighter tints for luminance: emerald at 400 (`#34d399`) for approved/sharing and amber at 400 (`#fbbf24`) for waiting, with amber 300 text.

### Named Rules
**The One Action Colour Rule.** Shift Teal is the only filled button colour. A screen has one filled teal button, and it lives in the fixed action bar. Secondary actions are white with a teal outline.

**The Dot Plus Word Rule.** Status is always a word with a small dot (8–10px circle) beside it: green done, amber waiting, red rejected or late. Colour never carries the status alone; waiting dots pulse.

**The Sunlight Rule.** Light theme only. `color-scheme: light`, no `prefers-color-scheme` dark variant.

## Typography

**Display Font:** System UI stack (-apple-system, Segoe UI, Roboto, Noto Sans, sans-serif)
**Body Font:** the same stack
**Label/Mono Font:** none; figures use tabular numerals of the same face

**Character:** Plain, native and fast on budget Android phones. The type does the hierarchy work that boxes used to do: semibold for anything you act on, regular slate for context.

### Hierarchy
- **Money** (600, 2rem, line-height 1, -0.02em, tabular): the payout figure on Payments. Turns Danger Ink when negative.
- **Headline** (600, 1.375rem, 1.375, -0.01em): the current stop's client name.
- **Bar Title** (600, 1.25rem, 1.25, -0.01em): the screen title in the app bar, white. Under it, the signed-in line at 0.8125rem in white at 75%.
- **Title** (600, 1.125rem, 1.375): the next-step line beside its dot, empty-state titles, panel titles.
- **Body** (400, 0.9375rem, 1.5): addresses, data rows, outline button labels (semibold). Primary button labels are 1rem semibold.
- **Body Small** (400, 0.875rem): secondary row lines, explanations, the "Stop 1 of 2 · 10:00 am" line (500).
- **Label** (600, 0.75rem, 0.04em, uppercase): section labels above a list of rows.
- **Strip Caption** (500, 0.6875rem, white at 60%): the caption over each value in the shift-status strip; values are 0.9375rem semibold tabular.

### Named Rules
**The Tabular Figures Rule.** Every time, km, count, percentage and rupee amount sets in tabular numerals (`font-variant-numeric: tabular-nums`) so columns and live-updating values do not jitter.

**The List Header Rule.** The uppercase section label names a list or band that follows it ("Rest of today", "Job details", "Earnings"). It never sits above a headline as a decorative tag.

## Layout

Single column, mobile first, max width 48rem (`max-w-3xl`) centred, so the same layout holds on office laptops. The page gutter is 16px; sheets break out of it (negative 16px margins) to run edge to edge.

Vertical structure, top to bottom: sticky app bar (with safe-area top inset) → optional status strip inside the bar → content bands → sticky action bar → bottom tab bar (with safe-area bottom inset). On focused tasks (a job, check-in) a back arrow replaces the tab bar and the job flow pins its own action bar to the viewport bottom; the content reserves 128px of bottom padding so nothing hides under it.

Rhythm: the first band sits flush under the app bar with no top border. Bands are separated by 20px of canvas, with a section label (8px gap below) in that gap when the band is a list. Inside a band: 20px top, 16px bottom, 16px sides. List rows are 14px tall padding with 12px between badge, text and trailing figure; data rows are at least 48px; tappable link rows are at least 56px.

Touch sizes: 48px minimum for any control (`tap`), 56px for the action button, 60px for large in-flow buttons (`tap-lg`), 64px for tab bar items.

## Elevation & Depth

Flat. Depth comes from tone (white bands on grey canvas) and teal-tinted hairlines, not shadows. The only shadow in the supervisor world is the upward lift on the fixed action bar, which tells the thumb that the bar floats over scrolling content.

### Shadow Vocabulary
- **Action bar lift** (`box-shadow: 0 -4px 16px rgb(11 53 50 / 0.06)`): the fixed bottom action bar only.
- **Map pin** (`shadow-md`): markers on the Roadmap and team maps, where they must separate from map tiles.

### Named Rules
**The Band Not Box Rule.** Content sits in full-bleed square white bands divided by hairlines. Do not float rounded, shadowed cards on the canvas.

## Shapes

Square sections, softly rounded controls, circles for small markers. Primary, outline and waiting buttons, the status strip, inputs and inline notice panels use 8px corners. 12px is the ceiling and appears only on larger inline panels. Full circles are for status dots, numbered stop badges (32px), stepper steps (28px), icon buttons in the app bar (48px hit area) and the active-tab pill. Line icons are 20px (16px small) SVG strokes at 2px, round caps and joins; tab icons are 22px at 1.9px.

**The 12px Ceiling Rule.** No control or panel rounds beyond 12px, and sheets do not round at all.

## Components

### Buttons
Firm and plain: full width, one per screen in the action bar.
- **Shape:** gently rounded (8px).
- **Primary:** Shift Teal fill, white 1rem semibold label, 56px tall, full width. When it opens a job it shows a two-line label ("Open job" caption at 70% white over "Next: Start trip") with an arrow on the right.
- **Pressed / Focus:** pressed darkens to Shift Teal Pressed; in-flow buttons may scale to 0.98. Focus is the global 2px Focus Teal outline.
- **Waiting:** the same slot and size in Quiet Fill with Ink Subtle text ("Waiting for approval"). It is not tappable and has no arrow.
- **Disabled:** slate-200 fill, Ink Subtle text.
- **Outline (field tools):** Navigate and Call sit as a two-column pair, 48px tall, white with a 1px Outline border, Shift Teal semibold label and 20px icon; pressed fills Mint Mist. Locked versions drop to a 10% border, grey text and a lock icon.

### Status strip
A three-cell definition list inside the app bar: white at 8% fill, 8px corners, white-at-15% dividers between cells. Each cell is a caption over a semibold tabular value, with a status dot where the value is a state. Today shows check-in, jobs done and leave-depot time; Roadmap and Payments reuse the same strip with their own figures.

### Sheets and list rows
- **Sheet:** a white full-bleed band with 1px Hairline top and bottom, no radius, no shadow.
- **List row:** 32px numbered circle badge (Quiet Fill, or OK with a white tick when done), semibold client name over a small grey line, trailing semibold tabular time, small chevron. Pressed state is slate-50. Rows are separated by Divider lines.
- **Data row:** label left in Ink Muted, value right in tabular semibold, at least 48px tall.

### Inputs / Fields
- **Style:** slate-50 fill, 2px slate-200 ring, 8px corners, 12px by 16px padding, 1rem text, Shift Teal caret.
- **Focus:** the ring turns Focus Teal.
- **Error:** a Danger Wash panel with Danger Ink text below the field.

### Navigation
- **App bar:** sticky, Shift Teal, white title, signed-in line with the live location indicator (dot plus word), round 48px icon buttons (back, sign out) with a white-at-10% pressed state.
- **Bottom tabs:** white bar, Shift Teal at 10% top border, equal-width items 64px tall, 22px line icon over a 0.75rem label. Active tab: the icon sits in a 64 by 32px Mint Wash pill and the label turns Shift Teal semibold; inactive labels are slate-500 medium.

### Job stepper (signature)
Four numbered 28px circles joined by a 2px line. Done steps fill Shift Teal with a white tick and the connector turns Shift Teal; the current step is white with a 2px Shift Teal ring; later steps are Quiet Fill. 11px labels below, semibold for done and current. The next-step line with its dot sits directly under it.

### Fixed action bar (signature)
White, Shift Teal at 10% top border, the action bar lift shadow, 12px by 16px padding plus the bottom safe-area inset. It holds exactly one button, optionally with a centred 0.875rem hint line above it. The Today bar and the job screen use the same button in the same place, so the thumb always finds the next step.

## Do's and Don'ts

### Do:
- **Do** put the one next step in the fixed bottom action bar as a full-width 56px Shift Teal button whose label names the step ("Start trip", "Take before photos").
- **Do** build screens from full-bleed white sheets on the canvas, divided by 1px teal-tinted hairlines, with a section label above each list.
- **Do** show every status as a word with a small dot (green done, amber waiting and pulsing, red rejected or late).
- **Do** set every time, km, count and rupee value in tabular numerals.
- **Do** keep every control at least 48px and keep the light theme in direct sun.
- **Do** keep control corners at 8px and never above 12px.

### Don't:
- **Don't** float rounded, shadowed `card` blocks on the canvas for new supervisor screens. Office screens still use them; that is drift waiting for conversion, not a pattern.
- **Don't** add a second filled teal button to a screen; secondary actions are outline buttons.
- **Don't** use colour alone for a status.
- **Don't** add a dark theme or `prefers-color-scheme` variant.
- **Don't** put an uppercase section label above a headline as a decorative tag; it only names a list or band.
- **Don't** add shadows to sheets; the action bar lift is the only shadow in the supervisor world.
