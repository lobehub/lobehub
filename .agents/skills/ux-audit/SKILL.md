---
name: ux-audit
description: 'Audit a page / surface against the Designing Interfaces pattern language + the ux skill checklists, then land findings. Use to run a repeatable, standards-based UX review of one screen.'
disable-model-invocation: true
argument-hint: '<page-or-surface>'
---

# UX Audit

A repeatable, standards-based UX review of **one surface at a time**. The benchmark is
two things together:

1. **Jenifer Tidwell, _Designing Interfaces_** — the pattern language for what a good
   interface is _made of_ (navigation, layout, input, commands, data display, feedback).
   See [`references/pattern-catalog.md`](references/pattern-catalog.md).
2. **The [`ux`](../ux/SKILL.md) skill** — LobeHub's execution checklists for how a flow
   should _behave_ (empty/loading/error, loading-can-fail, draft safety, forward
   momentum, one primary button, live streams, …).

The audit answers two questions for the surface: **which patterns does it use** (and how
well), and **where is the experience weak** (each gap tied to a checklist item). It also
feeds back: recurring gaps become new `ux` checklist items; the audit itself can become a
worked-example reference.

Do **one surface per run** — a full-app sweep is too much for a single pass. Re-run per
page as the product grows; that's the "continuous" part.

## Ground rule: evidence, not vibes

Every finding cites `file:line`. Before you assert a load-bearing claim ("no error
state", "draft not persisted"), **open the code and confirm it** — don't trust a summary
or a screenshot. A wrong "it's missing" is worse than no finding. When you delegate the
surface map to an Explore agent, still re-read the 2–3 files behind your top findings
yourself.

## Procedure

### 1 — Scope & map the surface

Pin down exactly what's being audited (the route + its feature tree). A screenshot from
the user is the ideal anchor — enumerate every block the user sees, top to bottom, plus
the surrounding chrome (nav, header, sidebar).

- Find the route segment (`src/routes/**`) and the feature components (`src/features/**`)
  it delegates to. An **Explore** agent is good here — ask it to return the component
  tree, and for each block: the data-fetching mechanism, and which of empty / loading /
  error / retry states exist or are **missing**, with `file:line`.
- Produce a block list: `[greeting] [composer] [banner] [chips] [feed] [sidebar…]`.

### 2 — Inventory patterns in use

Walk [`references/pattern-catalog.md`](references/pattern-catalog.md) family by family.
For each block, tag the Tidwell pattern(s) it implements and rate the execution:

- **✅ solid** — used well.
- **⚠️ partial / misused** — the pattern is there but incomplete or fighting its intent.

Output a table: `Pattern | Where (block + file) | ✅/⚠️ | one-line note`. This is the
"patterns in use" half of the report — it also surfaces **missing** patterns (a data feed
with no _Update Indicator_; a list with no _empty state_).

### 3 — Audit states & flows against the ux checklists

For every block, walk the relevant [`ux`](../ux/SKILL.md) module (Read / Edit / Act /
Feedback / Grow). Record each gap as **present / missing / misleading** with `file:line`
evidence. High-yield checks, in order of how often they're the real problem here:

- **Loading can fail** (Feedback §4.2) — does every fetch have a terminal failure + retry,
  or does it spin forever / silently degrade? Watch for an init-flag set _only_ on success
  → permanent skeleton on error.
- **Empty vs failed vs not-loaded** (Read §1.1) — are the variants distinguished, or does a
  failed load masquerade as "nothing here"?
- **Draft safety** (Edit §2.1) — is typed input persisted across reload/crash, or in-memory
  only?
- **Forward momentum & action states** (Act §3.1) — confirm → in-progress (locked) →
  done/error; success leads forward.
- **One primary button per surface**, **pinned actions outside scroll** (Act §3.2 / §3.3).
- **Live / polling streams** (Read §1.7) — new-item indicator, manual refresh, no reorder
  under the user.
- **Predictable affordances** — is anything randomized / rotating / ephemeral where the
  user needs a stable mental model (promo slots, placeholders holding real content)?

### 4 — Rank by severity

- 🔴 **Breaks trust** — data or input loss, stuck/permanent states, misleading "empty" that
  hides a failure, silent send failure.
- 🟠 **Dead-ends or misleads** — no forward path, ambiguous state, missing in-progress
  feedback, empty state that isn't a real page.
- 🟡 **Friction / inconsistency / missed delight** — predictability, redundant controls,
  progressive-disclosure gaps.

### 5 — Output the report

Use the two-part shape (see the worked example,
[`references/example-home.md`](references/example-home.md)):

1. **Patterns in use** — the table from step 2, grouped by pattern family, with a
   one-line overall read.
2. **Experience gaps** — ranked list; each item names the finding, the `ux` checklist
   item (or catalog pattern) it violates, `file:line` evidence, and a one-line remedy.
3. **Skill feedback** — which findings are real instances of existing checklist items
   (good worked examples) vs **new generalizable gaps** worth adding to `ux`.

### 6 — Land the findings

Don't let the audit evaporate:

- **Concrete bugs** → fix the top 🔴 in the same or a follow-up branch, or file them.
- **Generalizable gaps** → add / strengthen a checklist item in the `ux` skill (put the
  rule + a ✅/❌ example in the right module reference, and mirror a line into the `ux`
  Quick review checklist). Cite the audited surface as the ❌ example.
- **The audit** → optionally save it as a `references/example-<page>.md` here so the next
  run has a template.

## Related skills

- **[ux](../ux/SKILL.md)** — the execution checklists this audit measures against, and
  where generalizable findings get landed.
- **review-checklist** — code-level review; this skill is its design-level sibling.
- **skills-audit** — the same "periodic, evidence-based audit" shape, applied to the skill
  catalog instead of a UI surface.
