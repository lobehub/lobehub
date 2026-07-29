---
name: ux
description: 'LobeHub product design values / principles / checklists. Use whenever the work touches user-interface features or implementation — designing or building any user-facing flow — to get better UX results.'
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

The one-screen scan. Each line links back to a module above for the full rule + examples.

**Read — viewing data & lists** ([read.md](references/read.md))

- [ ] Empty / loading / error states are all designed; empty is a real page with a CTA. Always-rendered chrome (toolbar/header) still gets a body empty state. If the `Empty` component ships a `search`/no-match variant, **wire it** — don't render `<Empty/>` bare so a zero-result search shows the first-run onboarding.
- [ ] Error is checked before the empty branch — a failed fetch never renders as empty (read `error`, don't coerce `data ?? [] → Empty`); a detail page reads `error` before falling to `NotFound` (failed-to-load ≠ deleted/404). On a **metrics/dashboard** surface the failure default is a zero-valued object (`?? {…:0}`) that renders as a confident `$0` — read `error` before any aggregate, don't fall through to zeros. A list **merged from a fetched set + a static/frontend set** (`[...fetched, ...placeholders]`) branches `error` before merging — the static half keeps `length > 0`, so a failed fetch renders a plausible partial catalog neither the empty guard nor an error-unread call site catches (channel).
- [ ] List designed across 1 → 10k rows (virtual scroll / pagination / batch as needed).
- [ ] Search / filter over a paginated list queries the full set server-side, not just the loaded page (no false "no results" for unfetched rows). Server-side coverage isn't just the search box — **sort, facet filters, the count badges, and any "act on the filtered set" bulk op** run over the full set too; server-side search + client-side sort/filter/counts still false-empties, mis-orders across pages, and under-counts (topics).
- [ ] Capped/scrollable/virtualized list scrolls the restored active item into view on mount (`block: 'nearest'`, re-run after async rows mount).
- [ ] Pickers show all valid targets (default/inbox included); empty = truly none.
- [ ] Large numbers roll the unit at each 1000× (K→M→B→T), never a coefficient ≥ 1000; use the shared `formatUsageValue` / `formatShortenNumber`.
- [ ] Multi-tab/view surface lands on the tab the entry intent implies (and falls back to a populated view, decided from resolved state); a manual pick sticks.
- [ ] Live/polling feed signals new items + offers manual refresh, doesn't reorder under the user, and shows a failed refresh distinctly (not as empty). A bulk/destructive control derived from the live-status map (close-idle / clear-inactive) gates on the query's loaded/error state — "unknown/errored" is ineligible, never treated as the inactive value. Conditional polling starts from **reactive state** (`shouldPoll` → `refreshInterval`), not a function-form `refreshInterval` that never schedules a first timer when its initial value is `0`.
- [ ] A surface with many navigable entries (a big settings area, a long list) offers search / filter / jump, not browse-only — named as a class norm so an absent box is caught.
- [ ] Marketplace / registry browse cards carry owned/installed state on the tile (not only on the detail) and trust/verified badges via one card contract, consistent across sibling registries; contribute leads to an in-app submit, not an external repo.
- [ ] A sidebar / nav / master-detail **list row** composes the canonical `NavItem` (+ `Accordion` / `GroupedAccordion` for groups, `Block variant='filled'` for active), not a hand-rolled `<div>`/`<button>`/`<input>` + bespoke CSS — else the hover/active highlight misaligns from the content box, content bleeds to the panel edge, the search/rename/action-reveal drift from every sibling panel, and the list stays a flat ungrouped dump. Grep `NavItem` before building.
- [ ] A persistent create/compose affordance above a list is the hero only while the list is **empty**; once populated it doesn't bury the records — cap the editor height (max-height + internal scroll) and/or default it to collapsed when the list has data, so the records keep Center Stage.
- [ ] A status group/label is true for **every** member — don't fold a distinct lifecycle state (scheduled/queued/snoozed) under a label that asserts another (running/in-progress); give it its own group or a neutral label.

**Edit — entering & changing content** ([edit.md](references/edit.md))

- [ ] Editors back up in-progress input to durable storage (survives reload, not in-memory only) and recover it after refresh/crash/failed-save; destructive exits warn, never silently discard — including **switching the active item in a master-detail** (a shared form `resetFields()` on selection change silently wipes unsaved input, worst when it's pasted secrets — channel).
- [ ] Input affordances are stable: static placeholder, no clickable/retrievable content hidden in it.

**Act — operations, flows & buttons** ([act.md](references/act.md))

- [ ] Action leads the user forward; success offers a primary "go to result".
- [ ] Terminal status screen (success / error `Result`) carries an action: error → escape hatch (retry / back), success → close / go-to-result; no bare `Result` without `extra`, and "auto-closing in Ns" copy only when the close can actually fire.
- [ ] A result that changes the next step lands in a persistent state (screen / inline), not just a transient toast; "link sent" names the destination + offers resend, failures keep context + offer retry.
- [ ] Bulk action has a single-item entry (and vice versa).
- [ ] Async/bulk/irreversible action: confirm → in-progress (locked) → done/error. But a **slow but atomic** confirm-gated op (device/file delete, git op, seconds-long call) closes the confirm **immediately** (non-blocking `onOk`) and shows progress on the **originating surface** (optimistic removal / row spinner), not a confirm dialog held spinning on the round-trip — the modal is not the progress surface.
- [ ] A long-running / costly async op (generation / export / large upload) offers **Cancel while it runs** (aborts the work, not just delete-after-the-fact) and keeps an in-place **Retry** on error — named as a generation-class norm so an absent Cancel is caught.
- [ ] Optimistic create / rename / duplicate surfaces failure (caller catches + toasts); never a silent rollback.
- [ ] Job-control (run / pause / stop / retry) surfaces start/stop failure — a `catch` that only `console.error`s + optimistic-status rollback reads as a dead button; toast at the store-action boundary so every trigger inherits it.
- [ ] Cross-surface coherence: an entity shown in both a list and its detail stays in sync on edit — shared normalized store or invalidate the sibling (not a gated field subset); a per-surface review misses this seam, so check it explicitly.
- [ ] Scrollable content + actions/status → pin them in a fixed footer/header, not inside the scroll area (verify at the overflowing state).
- [ ] Exactly one primary button per surface — and it's the visually dominant control (back / cancel / secondary never out-weighs it; verify on the rendered screen, not from `variant`).
- [ ] Listed entities have their full lifecycle (not display-only); ops match source (built-in / installed / custom). A protective marker (pin / keep / lock) is honored by every removal path (bulk close, clear-idle, auto-cleanup) — a marker that gates nothing is a decorative no-op.
- [ ] An action that commits as a specific identity (OAuth consent, send-as, publish-to) shows the identity **and** a switch-account / re-auth path — never locks the user to the currently-logged-in one.
- [ ] Unrecoverable / wide-blast action (clear-all, delete-account, wipe) needs an explicit gesture (type-to-confirm / checkbox), not one-click danger; and reports partial failure, never silent half-completion.
- [ ] A minted secret (API key / token) is shown in full once at creation (persistent reveal + Copy), hashed at rest, masked thereafter — never re-revealed from a list.
- [ ] A store of data _about the user_ (AI memory / personalization / inferred profile) offers correct-or-mark-wrong (not just blind-edit/delete), retain-without-use (per-item pause + global off-switch), export/download, and undo/soft-delete — named as class norms so an absent one is caught.

**Feedback — loading & system response** ([feedback.md](references/feedback.md))

- [ ] No antd `Spin`; use `NeuralNetworkLoading` / project loaders.
- [ ] Every loading state can fail: on error or timeout, show a failed state with a Reload/Retry action — never an infinite spinner. In an auto-dismissing surface (upload dock / progress toast), the countdown clears **success only** — a failed item persists with Retry. An error state / retry action that's **modeled in the store but consumed by no surface** (`isXError` selector / `retryX` action with zero `rg` call sites) is still a missing error state — a built-but-orphaned path is a permanent skeleton at the pixel. A **load-more / infinite-scroll** page fetch that fails shows an inline Retry at the list tail (distinct from end-of-list), never a silently vanished "loading more" row with `hasMore` still true that an `IntersectionObserver` re-fires into a silent retry loop (topics).
- [ ] A compound gate waiting on a secondary/dependent fetch gates on its **in-flight** flag and releases on settled (data / resolved-`null` / error) — never on the dependency being present in a map, or an absent-by-design dependency hangs it forever. An error branch **ordered after** a data-presence gate (`{error && …}` below `if (isLoading = !map[id]) return <Skeleton/>`) is unreachable on first-load failure — it paints only on revalidation, and a resolved-`null` not-found hangs the same permanent skeleton; check error/not-found **before** the gate.
- [ ] An awaited write that gates navigation/advance resets its busy flag in `finally` + offers retry — a failed write never permanently disables the forward/Back control.
- [ ] Autosave surfaces a save-state (saving → saved → failed with retry), never a silent write; the save-state enum actually includes a `failed` variant (a catch that resets to `idle` is a silent write); one save-feedback convention across a multi-field surface, ideally in the shared form wrapper.
- [ ] Error copy is written for a human, not a log line (§4.5): no internal id (`tpc_…` / uuid / `#N` seq) or log framing (`Execution failed:` / `Error:`) in the headline — the id rides a structured field powering "View run", the framing is localized via i18n at the view, and the body doesn't repeat identity the meta row already shows. A **deterministic-cause** failure (budget/quota → top-up・upgrade; permission → request access) leads with the **remedy action**, not a bare Retry that just re-fails.
- [ ] Capability-gated feature warns (soft, reactive, load-gated) when the model can't deliver it; copy gives the remedy.

**Grow — discoverability & progressive disclosure** ([grow.md](references/grow.md))

- [ ] Advanced capability is progressively disclosed / discoverable at the moment of need.
- [ ] A control that borrows a keyboard/CLI idiom (numbered `1`/`2`/`3` chips, `⌘K` badge, arrow-nav, keycap hint) actually wires those keys — or is restyled so it doesn't imply an absent shortcut; a keycap-looking chip with no handler is a false affordance, worst in a surface ported from a CLI. Confirm the keys fire at L3.
- [ ] A config surface for a feature with its own data/management area links to it in-context (close the config → manage loop) — not just a promise in copy.
- [ ] Multi-step flow (>2 steps: wizard/onboarding) shows a step/progress indicator (position + total) and keeps non-essential steps skippable with a visible escape hatch.

## Related skills

- **ux-audit** — a repeatable, _Designing Interfaces_-benchmarked audit of one surface; run
  it to find gaps and land them back into these checklists.
- **modal** — imperative `createModal` state-machine wiring for confirm/progress/done.
- **DESIGN.md** (Voice & Content) — wording for confirm / done / empty / error states.
- **react** — component priority, `Button` usage, styling.
