---
name: ux
description: 'Use for product design principles and UX checks when designing or implementing user-facing flows.'
user-invocable: false
---

# UX — Design Values & Execution Checklists

How LobeHub products should feel, and concrete rules to get there. Use this when
**building or reviewing** any user-facing flow.

This file is the **index**: the design values and interaction principles below are the
conceptual layer; the execution checklists live in per-module reference files (see
**Checklist modules**). Each checklist item is tagged with the design value(s) it serves.

## What lives where: DESIGN.md vs this skill

Two documents, two jobs — don't duplicate; cross-reference.

- **[`DESIGN.md`](../../../DESIGN.md)** — the design **system**: what the product looks
  and sounds like. Themeable tokens (color, typography, elevation, radius), the component
  inventory, and Voice & Content (wording, tone). Reach for it when you need a token
  value, a component, or copy tone.
- **this `ux` skill** — interaction **behavior**: how a flow should behave over time.
  Empty / loading / error states, lists at scale, selection visibility, pickers, number
  formatting, draft safety, action flow & momentum, button hierarchy, entity lifecycle,
  capability guardrails, progressive disclosure.

Rule of thumb: **static look & wording → DESIGN.md; dynamic behavior → this skill.** For
component/styling choices see **react**; for imperative modal wiring see **modal**.

## Design values

LobeHub follows four product design values — **Natural・Meaningful・Certainty・Growth**.
Read them before designing:
**[references/design-values.md](references/design-values.md)** (definitions + conflict
priority).

## Interaction principles

Use these before the execution checklists when a flow has multiple plausible interaction
patterns.

### Preserve the surface contract・Meaningful・Natural

Every surface carries a task promise: chat keeps the user in a working conversation, a
document page supports focused reading / editing, a settings page supports configuration,
and so on. Default interactions should continue that promise instead of unexpectedly
moving the user into another mode. Prefer in-context surfaces (portal / panel / drawer)
for reference and auxiliary work; reserve full-page navigation for committed focus or
explicit mode switches.

### Consistency is semantic, not mechanical・Certainty・Meaningful

Consistency means the same user intent behaves the same way in the same surface. It does
not mean the same component must do the same thing everywhere. When a component is reused
across surfaces, let the parent surface provide the interaction strategy so behavior
follows intent rather than implementation convenience.

### Layout communicates role・Natural・Certainty

Element placement is part of the interface language. Identity and location (breadcrumbs,
titles, object labels) should read separately from state and actions (save status,
sharing, panel toggles, overflow menus). When these roles are mixed, users have to infer
whether an element describes the current object or acts on it.

### Compose the canonical surface component, don't re-derive it・Certainty・Natural

When a surface class already has a canonical component in this codebase — a sidebar row →
`NavItem`, a collapsible group → `Accordion` / `GroupedAccordion`, an active surface →
`Block variant='filled'` — **compose it**, don't rebuild the chrome from raw
`<div>`/`<button>`/`<input>` + a bespoke `createStaticStyles` block. A hand-rolled parallel
re-derives padding, hover/active states, alignment, and reveal-on-hover by hand, and drifts
from its siblings on each one — the aggregate reads as "unpolished" even when every single gap
is tiny. Before building a list / nav / master-detail panel, find the primitive the sibling
surface uses (grep `NavItem`, `Accordion`) and compose it; fall to raw elements only for a
genuinely novel row. See **[Read §1.10](references/read.md)** for the full pattern; the
**react** component-priority rule covers the mechanics.

## Checklist modules

Grouped by **interaction type** — the kind of thing the user is doing. Jump to the module
matching the surface you're building; a surface often spans several (an editable list is
Read + Edit + Act) — walk each that applies.

- **[Read](references/read.md)** — viewing data & lists: empty / loading / error states,
  lists at scale, selection visibility, picker completeness, number formatting, default
  view.
- **[Edit](references/edit.md)** — entering & changing content: protect in-progress
  drafts, never lose input.
- **[Act](references/act.md)** — operations, flows & buttons: forward momentum, one
  primary button, entity lifecycle completeness.
- **[Feedback](references/feedback.md)** — loading visuals & capability guardrails.
- **[Grow](references/grow.md)** — discoverability & progressive disclosure.

## Quick review checklist

Use this scan to identify applicable checks, then read the linked module for its full requirements and examples. Keep implementation details and case histories in those modules, not duplicated here.

**Read — viewing data & lists** ([read.md](references/read.md))

- [ ] Distinguish first-use empty, no search matches, loading, and failure; include a useful body state beneath persistent chrome.
- [ ] Handle fetch errors before empty, not-found, zero-valued aggregates, or static fallback entries can mask them.
- [ ] Support lists from 1 to 10k rows with pagination, virtualization, and batch operations as needed.
- [ ] Search, filters, sort, counts, and bulk scope cover the full dataset, not only loaded pages.
- [ ] Scroll restored selections into view after their rows exist, without moving already-visible selections.
- [ ] Pickers include every valid target, including default/inbox options.
- [ ] Use shared number formatters with K/M/B/T rollover; never display a coefficient ≥ 1000.
- [ ] Choose the initial view from entry intent and resolved data; preserve manual choices and access to collection-level actions.
- [ ] Live feeds signal updates, allow manual refresh, preserve reading position, and distinguish refresh failure.
- [ ] Conditional polling starts reliably; unknown or failed live status never qualifies an item for destructive bulk actions.
- [ ] Large navigation surfaces offer search, filter, or jump.
- [ ] Registry cards consistently show owned/installed and trust states; contribution leads to in-app submission.
- [ ] Reuse canonical list rows and grouping components; see Read §1.10 and the **react** skill.
- [ ] Keep populated lists visible beneath persistent composers; cap or collapse growing editors.
- [ ] Status labels describe every member accurately.
- [ ] Embedded documents collapse to titled rows and expand to full text with subordinate typography.

**Edit — entering & changing content** ([edit.md](references/edit.md))

- [ ] Persist and recover drafts through reloads, failed saves, and item switches; warn or save before destructive exits.
- [ ] Keep placeholders stable and meaningful content retrievable outside them.

**Act — operations, flows & buttons** ([act.md](references/act.md))

- [ ] Success leads to the result; terminal screens provide a working next action or escape.
- [ ] Persist results that change the next step; keep transient acknowledgements in toasts.
- [ ] Provide both bulk and single-item action entry points.
- [ ] Show confirmation, locked progress, and outcome where required. Slow atomic operations close the confirmation and show progress on the originating surface.
- [ ] Long-running or costly operations support cancellation while running and retry after failure.
- [ ] Surface optimistic mutation and job-control failures; never silently roll back.
- [ ] Keep list and detail views synchronized after edits.
- [ ] Pin actions and status outside scrollable content; verify the overflowing state.
- [ ] Give each surface one visually dominant primary action.
- [ ] Provide the lifecycle operations appropriate to each entity's source; honor pin/keep/lock on every removal path.
- [ ] Show the acting identity and an account-switch or re-authentication path.
- [ ] Require a deliberate gesture for unrecoverable or broad destructive actions and report partial failure.
- [ ] Reveal newly minted secrets once with Copy, hash them at rest, and mask subsequent views.
- [ ] User-memory/profile stores support correction, retaining without use, export, and undo or soft-delete.

**Feedback — loading & system response** ([feedback.md](references/feedback.md))

- [ ] Use project loaders rather than antd `Spin`.
- [ ] Match skeleton structure to measured rendered layouts, including platform and route variants.
- [ ] Loading and load-more failures have visible recovery paths; failed items persist rather than auto-dismiss.
- [ ] Dependent-fetch gates release on settled data, absence, or error; error/not-found branches remain reachable.
- [ ] Failed awaited writes release busy controls; autosave exposes saving, saved, and failed states with retry.
- [ ] Write localized, human-readable errors; keep internal IDs in structured inspection fields and lead with the remedy for deterministic failures.
- [ ] Capability warnings are reactive and wait for resolved configuration; distinguish model choices from platform limitations.

**Grow — discoverability & progressive disclosure** ([grow.md](references/grow.md))

- [ ] Reveal advanced capabilities when useful without cluttering the novice path.
- [ ] Keyboard hints correspond to working shortcuts, verified in the running UI.
- [ ] Configuration surfaces link to the feature's data or management area.
- [ ] Flows with more than two steps show progress and keep non-essential steps skippable with an escape.

## Related skills

- **ux-audit** — a repeatable, _Designing Interfaces_-benchmarked audit of one surface; run
  it to find gaps and land them back into these checklists.
- **modal** — imperative `createModal` state-machine wiring for confirm/progress/done.
- **DESIGN.md** (Voice & Content) — wording for confirm / done / empty / error states.
- **react** — component priority, `Button` usage, styling.
