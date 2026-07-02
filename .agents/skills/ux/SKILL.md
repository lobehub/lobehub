---
name: ux
description: 'LobeHub product design values / principles / checklists. Load this skill whenever the work touches user-interface features or implementation — designing or building any user-facing flow — to get better UX results.'
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

The one-screen scan. Each line links back to a module above for the full rule + examples.

**Read — viewing data & lists** ([read.md](references/read.md))

- [ ] Empty / loading / error states are all designed; empty is a real page with a CTA. Always-rendered chrome (toolbar/header) still gets a body empty state.
- [ ] List designed across 1 → 10k rows (virtual scroll / pagination / batch as needed).
- [ ] Capped/scrollable/virtualized list scrolls the restored active item into view on mount (`block: 'nearest'`, re-run after async rows mount).
- [ ] Pickers show all valid targets (default/inbox included); empty = truly none.
- [ ] Large numbers roll the unit at each 1000× (K→M→B→T), never a coefficient ≥ 1000; use the shared `formatUsageValue` / `formatShortenNumber`.
- [ ] Multi-tab/view surface lands on the tab the entry intent implies (and falls back to a populated view, decided from resolved state); a manual pick sticks.
- [ ] Live/polling feed signals new items + offers manual refresh, doesn't reorder under the user, and shows a failed refresh distinctly (not as empty).

**Edit — entering & changing content** ([edit.md](references/edit.md))

- [ ] Editors back up in-progress input to durable storage (survives reload, not in-memory only) and recover it after refresh/crash/failed-save; destructive exits warn, never silently discard.
- [ ] Input affordances are stable: static placeholder, no clickable/retrievable content hidden in it.

**Act — operations, flows & buttons** ([act.md](references/act.md))

- [ ] Action leads the user forward; success offers a primary "go to result".
- [ ] Bulk action has a single-item entry (and vice versa).
- [ ] Async/bulk/irreversible action: confirm → in-progress (locked) → done/error.
- [ ] Scrollable content + actions/status → pin them in a fixed footer/header, not inside the scroll area (verify at the overflowing state).
- [ ] Exactly one primary button per surface.
- [ ] Listed entities have their full lifecycle (not display-only); ops match source (built-in / installed / custom).

**Feedback — loading & system response** ([feedback.md](references/feedback.md))

- [ ] No antd `Spin`; use `NeuralNetworkLoading` / project loaders.
- [ ] Every loading state can fail: on error or timeout, show a failed state with a Reload/Retry action — never an infinite spinner.
- [ ] Capability-gated feature warns (soft, reactive, load-gated) when the model can't deliver it; copy gives the remedy.

**Grow — discoverability & progressive disclosure** ([grow.md](references/grow.md))

- [ ] Advanced capability is progressively disclosed / discoverable at the moment of need.

## Related skills

- **ux-audit** — a repeatable, _Designing Interfaces_-benchmarked audit of one surface; run
  it to find gaps and land them back into these checklists.
- **modal** — imperative `createModal` state-machine wiring for confirm/progress/done.
- **DESIGN.md** (Voice & Content) — wording for confirm / done / empty / error states.
- **react** — component priority, `Button` usage, styling.
