---
name: ux
description: 'LobeHub product design values (自然 Natural / 意义感 Meaningful / 确定性 Certainty / 生长性 Growth) and per-aspect UX execution checklists. Use when designing or reviewing any user-facing flow — empty/loading/error states, confirmations, async feedback, button hierarchy, action parity, lists at scale, pickers, discoverability, and loading visuals.'
user-invocable: false
---

# UX — Design Values & Execution Checklists

How LobeHub products should feel, and concrete rules to get there. Use this when
**building or reviewing** any user-facing flow. For component/styling choices see
**react**, for wording see **microcopy**, for imperative modal wiring see **modal**.

## Design values (设计价值观)

LobeHub follows four product design values — **自然 Natural・意义感 Meaningful・
确定性 Certainty・生长性 Growth**. Read them before designing:
**[references/design-values.md](references/design-values.md)** (definitions +
conflict priority).

> The checklists below are the execution layer. Each item is tagged with the
> value(s) it serves; for what those values mean, see the file above.

## 1. Flow & momentum (操作链路)・自然・意义感

Every action chain must **push the user forward**, never dead-end or block the flow.

- [ ] **Forward momentum** — after any operation, lead the user to the next step,
      don't just stop. _(意义感)_
- [ ] **Success state = primary "go to result", secondary "dismiss"** — the strong
      button is the forward action (take me to the result); "Done" is the weak/
      secondary button. ✅ After moving topics: primary = "Go to «target»", secondary
      \= "Done". _(意义感・自然)_
- [ ] **Bulk ⇄ single-item parity** — an action on a multi-select toolbar must also
      be reachable on a single item (its context menu), and vice versa. _(确定性)_
- [ ] **Confirm → in-progress → done, in one surface** — bulk/irreversible/async
      ops use a modal state machine: a confirm step stating exactly what happens →
      an in-progress view with **dismissal locked** → a done (or error) view in the
      same modal. Never fire-and-forget with only a toast; never leave a dead
      spinner. _(确定性・意义感)_

## 2. States: empty /loading/error (状态设计)・意义感・确定性

Every data surface has **four** states — design all of them, not just "has data".

- [ ] **Empty state is a purpose-built page, not a blank screen.** It explains what
      this is, why it's empty, and gives a clear next action (CTA + value props).
      ✅ Devices: an empty "Connect your first device" page with primary/secondary
      connect paths and "what you can do once connected" cards — ❌ not a bare title
      over skeleton rows or a blank body. _(意义感)_
- [ ] **Distinguish the empty variants** — "no data yet" (onboarding CTA) vs
      "no match for filters" (clear-filters affordance) are different screens. _(确定性)_
- [ ] **Loading state** designed (skeleton / NeuralNetworkLoading), not a flash of
      blank or layout shift. _(自然)_
- [ ] **Error state** designed — surface the reason and a retry/back path. _(意义感)_

## 3. Buttons & focus (按钮与焦点)・确定性

- [ ] **One primary button per surface.** The single primary CTA tells the user the
      core action; everything else is secondary/tertiary. Never a pile of primary
      buttons competing for attention. _(确定性)_

## 4. Lists at scale (列表与规模)・确定性・自然

A list/data page must be designed for its **whole range of sizes**, not just the
demo data.

- [ ] **Walk the scale: 1 / 2 / 5 / 20 / 100 / 1k–10k rows.** Pick the right
      mechanism per range — plain render → load-more / pagination → virtual scroll;
      add batch-select / bulk actions once counts get large. _(确定性)_
- [ ] **Co-design empty / loading / error with the data state** (see §2). A list
      isn't done until all four render well. _(自然)_

## 5. Option visibility (选项可见性)・确定性・意义感

- [ ] **Pickers list every valid target.** Watch for options dropped by backend
      list queries (pagination, `virtual` flags, scope filters) and add them back.
      ✅ The default "LobeAI" (inbox) agent is `virtual` and excluded from the
      sidebar list, so the move picker re-adds it. An empty picker must mean
      "genuinely none", never "we filtered out the only option". _(意义感)_

## 6. Loading visuals (Loading 视觉)・自然

**Never use antd `Spin`** — it doesn't match the product's loading visual. Use a
project loader:

| Need                        | Component                                                                     |
| --------------------------- | ----------------------------------------------------------------------------- |
| Default loading (in-flight) | `NeuralNetworkLoading` from `@/components/NeuralNetworkLoading` (`size` prop) |
| Inline dots                 | `DotsLoading` / `BubblesLoading` from `@/components`                          |
| Branded full-page           | `Loading` from `@/components/Loading/BrandTextLoading`                        |
| List / card placeholder     | a skeleton (e.g. `SkeletonList`)                                              |

When in doubt, reach for `NeuralNetworkLoading` — it's the default in-flight
indicator (e.g. modal "in progress" states).

## 7. Discoverability & growth (可发现性与生长)・生长性

The product should grow with the user — deeper power shows up as needs deepen.

- [ ] **Progressive disclosure** — keep the novice path clean; reveal advanced
      capabilities as the user gets there, don't dump everything at once. _(生长性・自然)_
- [ ] **Surface related actions at the moment of need** — make the next capability
      discoverable in context (e.g. after the first item exists, offer what to do
      with it), not buried in a far-off menu. _(生长性・意义感)_

## 8. Entity lifecycle completeness (实体生命周期完整性)・意义感・确定性

The recurring trap: a feature ships only the **display** of a list, but edit /
delete / management are never built — so the user can add something and then be
stuck with it. For every entity a user can see, design its **full lifecycle**:
create / read / update / delete, plus state transitions (enable/disable,
connect/disconnect, install/uninstall). A read-only list the user can't manage
breaks the flow.

**The allowed operation set depends on the entity's source / ownership** — decide
it explicitly _before_ building. Worked example, the tools/connectors list:

| Entity class                        | Add     | Edit      | Remove             |
| ----------------------------------- | ------- | --------- | ------------------ |
| Official / built-in (skills, tools) | —       | —         | ✗ not removable    |
| Community (installed MCP)           | install | configure | uninstall / remove |
| User-custom (custom connector)      | create  | edit      | delete             |

- [ ] **No display-only features.** For every listed entity, enumerate CRUD +
      lifecycle ops and build the ones that apply. _(意义感)_
- [ ] **Operation set per source/ownership class** — built-in may be read-only;
      anything the user _installed_ must be removable; anything the user _created_
      must be editable **and** deletable. _(确定性)_
- [ ] **Each item exposes its allowed ops** (hover action / context menu / detail
      page), and there's a clear entry point to add/create where applicable. _(自然)_
- [ ] **An intentionally-absent op is a documented decision, not an oversight**
      (e.g. official tools can't be deleted — by design). _(确定性)_

## Quick review checklist

- [ ] Action leads the user forward; success offers a primary "go to result".
- [ ] Bulk action has a single-item entry (and vice versa).
- [ ] Async/bulk/irreversible action: confirm → in-progress (locked) → done/error.
- [ ] Empty / loading / error states are all designed; empty is a real page with a CTA.
- [ ] Exactly one primary button per surface.
- [ ] List designed across 1 → 10k rows (virtual scroll / pagination / batch as needed).
- [ ] Pickers show all valid targets (default/inbox included); empty = truly none.
- [ ] No antd `Spin`; use `NeuralNetworkLoading` / project loaders.
- [ ] Advanced capability is progressively disclosed / discoverable at the moment of need.
- [ ] Listed entities have their full lifecycle (not display-only); ops match source (built-in / installed / custom).

## Related skills

- **modal** — imperative `createModal` state-machine wiring for confirm/progress/done.
- **microcopy** — wording for confirm / done / empty / error states.
- **react** — component priority, `Button` usage, styling.
