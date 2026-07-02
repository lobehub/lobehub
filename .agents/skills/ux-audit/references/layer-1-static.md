# Layer 1 — Static audit (read the code)

The fast, offline baseline. Read the route + feature code and decide, for each block,
whether the states and patterns a good surface needs **exist in the code**. Run this on
**every** audit; it's cheap and gives complete structural coverage.

Part of the **ux-audit** skill — see [`../SKILL.md`](../SKILL.md). Benchmark:
[`pattern-catalog.md`](pattern-catalog.md) + the [`ux`](../../ux/SKILL.md) checklists.

## What L1 can and cannot conclude

- **Can**: a data branch is missing (no `error` case), an init flag is gated on success
  only, a draft lives in an in-memory store with no `persist`, a pattern is absent, a fetch
  has no retry, an action has no in-progress path.
- **Cannot** (defer to L2/L3): whether the dominant control on screen _is_ the primary
  action, whether the empty state _reads_ as a real page, spacing / contrast / truncation,
  responsive behavior, and anything with a number (CLS/LCP). **Never tick a visual verdict
  from a `variant` prop** — mark it "pending L2".
- **Cannot** (needs the surface-class benchmark, see SKILL.md): an **entirely-absent
  capability** the surface should carry by domain convention — there's no code to read, so
  L1 is blind to it. Bring the expected-capability list from the surface-class / competitor
  pass _into_ L1 and check each item as present / missing, or the read only ever grades the
  paths that already exist. ❌ missed once: OAuth consent with **no switch-account** affordance.

## Procedure

### 1 — Scope & map the surface

Pin down the route (`src/routes/**`) and the feature components (`src/features/**`) it
delegates to. Enumerate the blocks the user sees, top to bottom, plus the chrome (nav,
header, sidebar). An **Explore** agent is good for breadth — ask it to return the component
tree, and for each block: the data-fetching mechanism and which of empty / loading / error /
retry exist or are **missing**, with `file:line`. Re-read the 2–3 files behind your top
findings yourself.

### 2 — Inventory patterns in use

Walk [`pattern-catalog.md`](pattern-catalog.md) family by family. For each block, tag the
Tidwell pattern(s) it implements and rate: **✅ solid** / **⚠️ partial-or-misused** / **—
absent-but-expected**. Output a table: `Pattern | Where (block + file) | rating | note`.
This also surfaces missing patterns (a feed with no _Update Indicator_).

### 3 — Audit states against the ux checklists

For each block, walk the relevant [`ux`](../../ux/SKILL.md) module and record each gap as
**present / missing / misleading** with `file:line`. High-yield checks, most-common-first:

- **Loading can fail** (Feedback §4.2) — every fetch has a terminal failure + retry? Watch
  for an init flag set _only_ on success → permanent skeleton on error.
- **Empty vs failed vs not-loaded** (Read §1.1) — variants distinguished, or does a failed
  load masquerade as "nothing here"?
- **Draft safety** (Edit §2.1) — typed input persisted across reload, or in-memory only?
- **Forward momentum & action states** (Act §3.1) — confirm → in-progress (locked) →
  done/error present in code?
- **Live / polling streams** (Read §1.7) — new-item signal, manual refresh, no reorder.
- **Closed-loop / cross-surface entry points** (Grow §5.3) — does this surface lead the user
  onward to the data / management area of whatever it configures, or does it dead-end? A
  config-only pane (a toggle with no link to the thing it governs), or one that only _promises_
  the destination in copy, is a gap L1 misses unless you ask it explicitly — the link that
  should exist has no `file:line`. Ask it on **every** surface, including the small "just a
  form" ones; that's where it hides.
- **Pinned actions / draft scope / etc.** as the surface warrants.

### 4 — Rank & record

Rank by the shared severity rubric (SKILL.md). Feed the patterns table (step 2) and the
gap list (step 3) into the shared output shape. Tag any verdict you couldn't reach from
code as **"pending L2/L3"** so the next layer knows to confirm it.
