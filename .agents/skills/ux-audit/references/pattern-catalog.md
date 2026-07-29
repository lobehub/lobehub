# Pattern Catalog — the _Designing Interfaces_ benchmark

The pattern language from Jenifer Tidwell's **_Designing Interfaces_** (with a few
common web/app additions), grouped by family. Use it in **step 2** of the audit: walk
each family and tag which patterns the surface implements — and, just as important, which
expected ones are **absent**.

This is a **checklist of names to look for**, not a spec. Naming varies across editions
and libraries; match on intent, not the exact label. A pattern being absent isn't
automatically a bug — but an absent pattern the surface clearly _wants_ (a data feed with
no way to see new items; a list with no empty state) is a finding.

> How to use a family: for each pattern, ask "is this here? where? used well?" Record
> ✅ solid / ⚠️ partial-or-misused / — absent-but-expected.

## Navigation — getting around

- **Clear Entry Points** — a few obvious "start here" doors, not a wall of equal links.
- **Global Navigation** — a persistent nav to the app's main sections.
- **Hub & Spoke** — a central hub that spokes out to tasks and returns.
- **Fat Menus / Sitemap Footer** — dense but organized link sets for deep sections.
- **Sequence Map / Breadcrumbs** — show where you are in a flow or hierarchy.
- **Escape Hatch** — an always-available way out of a state / back to safety.
- **Modal Panel** — a focused sub-task that suspends the background.
- **Deep-linking** — a URL that restores a specific state.

## Layout — organizing the page

- **Visual Framework** — consistent chrome (header/sidebar/spacing) across pages.
- **Center Stage** — the most important thing dominates the visual center.
- **Titled Sections** — labeled, separable content blocks.
- **Card / Card Stack** — self-contained units in a stack or grid.
- **Grid of Equals** — peers shown as equally-weighted tiles.
- **Accordion / Collapsible Panels / Movable Panels** — user-controlled disclosure &
  arrangement.
- **Right / Left Alignment** — aligned form fields & labels for scannability.
- **Responsive Disclosure / Diagonal Balance** — reveal/reflow as space or focus changes.

## Input — forms & getting input

- **Input Prompt / Input Hints** — placeholder / helper text that guides entry.
  ⚠️ trap: a placeholder must be **static** and hold no clickable/retrievable content.
- **Good / Smart Defaults** — prefilled sensible values; "empty submit does the obvious
  thing".
- **Forgiving / Structured Format** — accept loose input; format-as-you-type.
- **Autocompletion** — suggest completions (e.g. `@mention`).
- **Dropdown Chooser / List Builder / Illustrated Choices** — richer selection controls.
- **Same-Page / Inline Error Messages** — validation shown at the field, not a wipe.

## Commands & actions

- **Prominent "Done" Button** — the primary action is unmistakable (one per surface).
- **Button Groups** — related actions grouped (e.g. skip / retry).
- **Smart Menu Items** — items adapt/disable to context, with a reason.
- **Preview** — see the effect before committing.
- **Progress Indicator / Cancelability** — long ops show progress and can be stopped.
- **Multi-Level Undo / Command History** — reversible, inspectable actions.
- **Action Panel / Overflow Menu** — secondary actions collected without crowding.

## Showing complex data

- **Overview + Detail** — summary list → detail (drawer / page) without losing place.
- **Cards / Sortable Table / Tree-Table** — structured record display.
- **News Stream / Activity Stream** — reverse-chronological feed of updates.
  ⚠️ expects an **Update Indicator** (new-items badge) + manual refresh + no reorder
  under the user.
- **Dynamic Queries / Data Brushing / Local Zooming / Datatips** — interactive
  exploration & inline detail-on-demand.
- **Data Spotlight** — de-emphasize everything but the relevant records.

## Feedback & system response

- **Loading Indicator / Spinner / Skeleton** — in-flight feedback (LobeHub: skeleton /
  `NeuralNetworkLoading`, never antd `Spin`).
- **Progress Indicator** — bounded progress for known-length work.
- **Update Indicator** — "N new" signal for background changes.
- **Failure + Retry** — a terminal error state with a way to recover (ux §4.2).
- **Cancelability / Deferred Choices** — let the user stop or postpone.

## Getting started — onboarding & growth

- **Welcome / Sign-on** — a purposeful first screen.
- **Guided Tour / Discoverable Detail / Onboarding** — reveal capability progressively.
- **Empty-state as onboarding** — first-run empty states that teach + offer a CTA
  (ux Read §1.1).
  ⚠️ trap: promo / onboarding slots should be **predictable**, not randomly rotated —
  randomness costs the user a stable mental model (Certainty).

## Visual style & aesthetics

- **Deep Background / Few Hues Many Values / Corner Treatments / Skins & Themes** — the
  look. Mostly lives in **DESIGN.md** (tokens, theme); note here only when the visual
  choice hurts a behavior (e.g. a spinner that hides a failure).

---

### Families most often weak in this codebase

From audits so far, the recurring soft spots cluster in **Feedback** (failure/retry
absent) and **Input** (draft safety, placeholder misuse) — check those families first.
