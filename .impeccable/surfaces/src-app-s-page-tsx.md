---
version: 1
slug: "src-app-s-page-tsx"
primary_target: "src/app/s/page.tsx"
related_targets: ["src/app/s/roadmap/page.tsx","src/app/s/jobs/[id]/page.tsx","src/app/s/checkin/page.tsx","src/components/AppShell.tsx"]
---

# Supervisor field app (Today, Roadmap, Job, Check-in/out)

Mode: Operate. Platform: mobile web (PWA) on Android phones, outdoors, one-handed. Office screens share the shell and components.

Audience and job: a supervisor working through a day of cleaning jobs strictly in order: check in, ride to the next stop, prove the work with photos, collect payment, check out. The screen must always say the one thing to do now.

Constraints: light theme only (sunlight), 48px+ targets, system font, standard controls. Must not lose any current function or rule (one job at a time, approvals, location sharing). User rejected the previous look: too rounded, too many boxes, weak hierarchy, colours off.

## Direction contract

THESIS: A delivery-partner shift app: one current task, one big action, a calm list of what comes next. Refuses the stack-of-rounded-cards dashboard the previous build was.

OWN-WORLD: Deep teal app bar (#0b3532) carrying the screen title and live shift status in white; cool light canvas with full-bleed white sections divided by hairlines, not floating cards; 10–12px corners maximum on controls, square sections; one action colour (the same deep teal) for every primary button; status in text plus a small dot (green done, amber waiting, red rejected/late); tabular figures for every time, km and rupee value.

STORY: The supervisor opens the app and immediately sees their shift state, the current stop and its single next step, and taps the fixed bottom action to do it. Later stops sit below as a quiet numbered list.

FIRST VIEWPORT: Teal app bar (title, name, shift status strip: check-in state, jobs done x/y, and leave-depot time; km moved to the Roadmap strip because before departure the leave time is the figure the supervisor acts on). Under it, the Current stop section: stop number and time, client name at 22px, address, Navigate and Call as two compact buttons. Below, "Up next" list rows with dividers. Fixed above the bottom nav: the action bar with one full-width primary button naming the next step.

FORM: Canon, user-pinned ("delivery partner app": Swiggy, Zomato, Uber driver), 16 Nov 2026. Signature move: the fixed bottom action bar that always names the one next step. seed: none (roll skipped: direction pinned by the user, so no concept-seed roll ran)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
