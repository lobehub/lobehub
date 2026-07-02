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

| Finding type                                                              |     L1      |        L2        |       L3        |
| ------------------------------------------------------------------------- | :---------: | :--------------: | :-------------: |
| Missing empty/error branch, no retry, draft not persisted, absent pattern |     ✅      |        —         |        —        |
| Real visual hierarchy / is the dominant control the primary action        | ❌ misleads |        ✅        |       ✅        |
| Spacing / alignment / contrast / truncation / overflow / dark mode        |     ❌      |        ✅        |        —        |
| Off-screen selection; what empty/loading/error actually render as         |     ❌      |        ✅        |       ✅        |
| Responsive breakpoints (narrow / mobile)                                  |     ❌      |        ✅        |       ✅        |
| In-progress / locked states; forced error / empty; capability-gated       |     ❌      |        ❌        |       ✅        |
| Journey stitching (forward momentum across steps)                         |    weak     |       weak       |       ✅        |
| Focus order / keyboard reachability                                       |     ❌      |        ❌        |       ✅        |
| **CLS / LCP / INP / long-task numbers**                                   |     ❌      | qualitative only |       ✅        |
| **Which of two variants is _better_ (A/B winner)**                        | ❌ misleads |   ❌ misleads    | ✅ (+analytics) |

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

## Ground rule: comparing two variants — the winner is an outcome verdict, not a craft verdict

When an audit compares **two variants of the same surface** ("is Agent or Classic onboarding
better?"), the trap is judging **which is better _made_** (more polished, more patterns, more
AI) when the real question is **which better gets the user to their goal**. For a
gateway / interstitial surface — onboarding, consent, paywall, a loading gate — the two
diverge hard: the best version is often the _least_ version, because the surface stands
_between_ the user and what they came for. Craft is not outcome, and the richer artifact is
routinely the worse one.

So a variant comparison must:

1. **Name the success metric _first_, then judge against it.** Onboarding = completion rate +
   time-to-value + drop-off, not pattern richness. A checkout = conversion. Write the metric
   before scoring, or you'll default to scoring craft.
2. **Gate the winner verdict on L3 / analytics.** "Which variant is better" is a behavioral
   outcome — it lives in the coverage matrix's L3 row alongside CLS/INP. From L1/L2 you may
   compare **mechanics** ("A's error recovery is more complete", "B is fewer steps"); you may
   **not** declare a winner. No funnel data → say "insufficient evidence, here's what I'd
   need", and stop. A confident winner call with a buried "needs L3" caveat is the failure —
   the caveat does not license the verdict.
3. **Cost to the user is a first-class axis, inverse-weighted for gateway surfaces.** Time,
   steps, tokens, latency. Past a threshold, richness is a _liability_ on any surface the user
   wants to get _through_, not _into_.
4. **Anchor 意义感 on the user's real goal, not the feature's richness.** A flow that detains
   the user in itself when their goal is elsewhere is _less_ Meaningful even if more engaging —
   read correctly, 意义感 and 自然 favor the fast path there. Don't mistake "more conversational
   /more AI /more crafted"for"more meaningful".
5. **Read the org's revealed preference as evidence.** Feature flags, which variant is the
   **fallback**, which the most-constrained platform is forced onto (desktop), recent reverts.
   When the universal fallback _is_ variant B, B is the trusted baseline and the burden of
   proof is on A — don't explain these signals away as "ceiling vs floor".
6. **Pick the right reference class, and weight by the real intent distribution.** An AI
   tool's first-run benchmarks against ChatGPT / Claude / Cursor (near-zero onboarding, straight
   to the box), not SaaS setup wizards (Notion / Linear) that reward thorough onboarding.
   Score the modal user (who wants to skip), not the ideal engaged one.

> ❌ This skill's own miss: an L1 read judged **Agent onboarding "better" than Classic** because
> it was more polished /conversational (richer completion panel, name suggestions, view
> transitions), citing 意义感 ≳ 自然 > 确定性. In production Agent's effective-guidance completion
> was **not high**, users found it too slow (they wanted the tool, not a chat), and the org
> **rolled back to Classic**. Every error above was present: craft mistaken for outcome, 意义感 scored
> backwards, cost footnoted, a winner declared from L1 on what is an L3/analytics metric, and the
> flag-gated /degrades-to-Classic/desktop-excluded signals explained away.

## Severity rubric (shared)

- 🔴 **Breaks trust** — data / input loss, stuck / permanent states, a misleading "empty"
  that hides a failure, silent send failure.
- 🟠 **Dead-ends or misleads** — no forward path, ambiguous state, missing in-progress
  feedback, an empty state that isn't a real page.
- 🟡 **Friction / inconsistency / missed delight** — predictability, redundant controls,
  progressive-disclosure gaps, CLS jank.

## Output (shared)

See the worked example, [`references/example/home.md`](references/example/home.md). Note
**which layers ran**, then:

1. **Patterns in use** — table (from L1/L2), grouped by pattern family, with a one-line read.
2. **Experience gaps** — ranked; each names the finding, the `ux` checklist item / catalog
   pattern it violates, the **layer + evidence** it came from, and a one-line remedy.
3. **Skill feedback** — real instances of existing checklist items vs new generalizable gaps
   worth adding to `ux`.

## Land the findings (shared)

An audit is not finished when the findings are written — it is finished when they are
**landed**. All three steps below are **required** to close a run:

- **Concrete bugs** → fix the top 🔴, or file as Linear sub-issues under the "UX Audit"
  parent (per-page container issue → one sub-issue per finding).
- **Generalizable gaps → 回灌 `ux` (mandatory).** Every run **must** close the loop back into
  the `ux` skill: for each finding that generalizes beyond this surface, add / strengthen a
  `ux` checklist item (rule + ✅/❌ example in the right module, **and** mirror a line into the
  ux Quick review), citing the audited surface as the ❌ example. This is what makes the audit
  _continuous_ — each run leaves the checklists sharper than it found them. If a run genuinely
  surfaces **no** generalizable gap, say so explicitly in the report's Skill-feedback section
  (only validated-existing-rule instances) — silence is not an acceptable close.
- **The audit** → save it as `references/example/<page>.md` so the next run has a template.

> The audit and the `ux` skill are a **closed loop**: `ux` is the benchmark the audit measures
> against, and the audit is the mechanism that keeps `ux` honest. Skipping the 回灌 breaks the
> loop and reduces the audit to a one-off review.

## Related skills

- **[ux](../ux/SKILL.md)** — the execution checklists this audit measures against, and where
  generalizable findings get landed.
- **agent-testing** — the automation framework L3 drives (agent-browser CDP: snapshot / eval
  / screenshot / GIF). L3 assumes its Step 0 env + auth are green.
- **review-checklist** — code-level review; this skill is its design-level sibling.
- **skills-audit** — the same "periodic, evidence-based audit" shape, applied to the skill
  catalog.
