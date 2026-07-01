---
name: ux-audit
description: 'Audit a page / surface against the Designing Interfaces pattern language + the ux skill checklists, then land findings. Three layers — static (code), visual (screenshots), dynamic (automated user journey + perf). Use to run a repeatable, standards-based UX review of one screen.'
disable-model-invocation: true
argument-hint: '<page-or-surface> [--l1 | --l2 | --l3]'
---

# UX Audit

A repeatable, standards-based UX review of **one surface at a time**. The benchmark is
two things together:

1. **Jenifer Tidwell, _Designing Interfaces_** — the pattern language for what a good
   interface is _made of_. See [`references/pattern-catalog.md`](references/pattern-catalog.md).
2. **The [`ux`](../ux/SKILL.md) skill** — LobeHub's execution checklists for how a flow
   should _behave_.

The audit answers: **which patterns does the surface use** (and how well), and **where is
the experience weak** (each gap tied to a checklist item). Recurring gaps feed back as new
`ux` checklist items; the audit itself becomes a worked-example reference.

Do **one surface per run** — a full-app sweep is too much for a single pass. Re-run per
page as the product grows; that's the "continuous" part.

## Three layers — pick by what you need to catch

An audit is not one activity. A finding is only trustworthy from a layer that can actually
_see_ it. Each layer has its own procedure file; run the ones the surface needs.

| Layer          | File                                                | What it does                                                   | Catches                                                                                                                                                              | Cost                             |
| -------------- | --------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **L1 Static**  | [layer-1-static.md](references/layer-1-static.md)   | Read the code                                                  | Missing states/branches (empty/error/retry), no draft persist, absent patterns, structural issues                                                                    | cheap, offline, **every audit**  |
| **L2 Visual**  | [layer-2-visual.md](references/layer-2-visual.md)   | Screenshots of the rendered surface                            | Real visual hierarchy & dominant control, spacing/contrast/alignment, truncation/overflow, how empty/loading/error actually look, responsive breakpoints, dark/light | medium; needs a render           |
| **L3 Dynamic** | [layer-3-dynamic.md](references/layer-3-dynamic.md) | Drive the real user journey via **agent-testing** + instrument | In-progress/locked states, forced error/empty states, does step N lead to N+1, focus/keyboard, **quantified CLS / LCP / INP / long-tasks**                           | high; needs a running env + auth |

### Coverage matrix — which layer can conclude what

The core rule: **a verdict must come from a layer that can see it.** Don't tick a visual or
runtime verdict off the code.

| Finding type                                                              |     L1      |        L2        | L3  |
| ------------------------------------------------------------------------- | :---------: | :--------------: | :-: |
| Missing empty/error branch, no retry, draft not persisted, absent pattern |     ✅      |        —         |  —  |
| Real visual hierarchy / is the dominant control the primary action        | ❌ misleads |        ✅        | ✅  |
| Spacing / alignment / contrast / truncation / overflow / dark mode        |     ❌      |        ✅        |  —  |
| Off-screen selection; what empty/loading/error actually render as         |     ❌      |        ✅        | ✅  |
| Responsive breakpoints (narrow / mobile)                                  |     ❌      |        ✅        | ✅  |
| In-progress / locked states; forced error / empty; capability-gated       |     ❌      |        ❌        | ✅  |
| Journey stitching (forward momentum across steps)                         |    weak     |       weak       | ✅  |
| Focus order / keyboard reachability                                       |     ❌      |        ❌        | ✅  |
| **CLS / LCP / INP / long-task numbers**                                   |     ❌      | qualitative only | ✅  |

> ⚠️ The recurring trap this prevents: ticking "one primary button" or "empty is a real
> page" from a `variant` prop in the code. Those are **L2** verdicts — confirm them on the
> render, never from L1 alone.

### Tiering — don't run all three every time

- **L1 always** — fast, complete-coverage baseline for every surface.
- **Add L2** when the findings are about layout, hierarchy, rendered states, or responsive.
- **Add L3** when you need to walk a journey, force states L1/L2 can't reach, or measure
  performance (CLS etc.).

`--l1 / --l2 / --l3` scopes a run to one layer; default is L1 (+ L2 if screenshots are
supplied).

## Ground rule: evidence, not vibes

Every finding cites its evidence — `file:line` (L1), a screenshot you **verified with the
Read tool** (L2), or a captured value / snapshot (L3). Before asserting a load-bearing
claim, confirm it in the layer that owns it; a wrong "it's missing" is worse than no
finding.

## Ground rule: benchmark the surface _class_, not just our own artifact

Reading our code can only surface flaws in **what we built** — it is structurally blind to a
capability we **never built at all**, because an entirely-absent affordance leaves no
`file:line`, no dead branch, no half-wired button to grep for. The checklists guard the
_quality of the states that exist_; they do **not** tell you which states a surface of this
_class_ is expected to have.

So before (or alongside) reading code, name the surface's **class** and its domain
conventions: how do the mature, comparable products build this exact screen, and what do
they offer that a first version forgets? An **OAuth consent** screen's class norms, for
example (GitHub / Google / Okta): show _which identity_ you're authorizing as **and let the
user switch account / re-authenticate**, name the requesting app, list the scopes, allow
deny, and point to later revocation. A **file picker**, a **checkout**, a **share dialog**
each carry their own class norms. Write this expected-capability list _first_, then audit
gaps against it — otherwise the audit only ever polishes the paths that already exist and
silently blesses a missing one.

> ❌ The first pass of the OAuth audit measured consent against our internal state
> checklists only and reported button-hierarchy / retry gaps, while missing the **biggest**
> one: the consent screen locks the user into the current identity with **no switch-account**
> path (`OAuthConsent/Login.tsx`) — a class norm every comparable OAuth provider ships. A
> competitor-norms pass catches this on minute one; a code-only pass never can.

## Severity rubric (shared)

- 🔴 **Breaks trust** — data / input loss, stuck / permanent states, a misleading "empty"
  that hides a failure, silent send failure.
- 🟠 **Dead-ends or misleads** — no forward path, ambiguous state, missing in-progress
  feedback, an empty state that isn't a real page.
- 🟡 **Friction / inconsistency / missed delight** — predictability, redundant controls,
  progressive-disclosure gaps, CLS jank.

## Output (shared)

See the worked example, [`references/example-home.md`](references/example-home.md). Note
**which layers ran**, then:

1. **Patterns in use** — table (from L1/L2), grouped by pattern family, with a one-line read.
2. **Experience gaps** — ranked; each names the finding, the `ux` checklist item / catalog
   pattern it violates, the **layer + evidence** it came from, and a one-line remedy.
3. **Skill feedback** — real instances of existing checklist items vs new generalizable gaps
   worth adding to `ux`.

## Land the findings (shared)

- **Concrete bugs** → fix the top 🔴, or file as Linear sub-issues under the "UX Audit"
  parent (per-page container issue → one sub-issue per finding).
- **Generalizable gaps** → add / strengthen a `ux` checklist item (rule + ✅/❌ example in
  the right module, mirror a line into the ux Quick review); cite the audited surface as the
  ❌ example.
- **The audit** → save it as `references/example-<page>.md` so the next run has a template.

## Related skills

- **[ux](../ux/SKILL.md)** — the execution checklists this audit measures against, and where
  generalizable findings get landed.
- **agent-testing** — the automation framework L3 drives (agent-browser CDP: snapshot / eval
  / screenshot / GIF). L3 assumes its Step 0 env + auth are green.
- **review-checklist** — code-level review; this skill is its design-level sibling.
- **skills-audit** — the same "periodic, evidence-based audit" shape, applied to the skill
  catalog.
