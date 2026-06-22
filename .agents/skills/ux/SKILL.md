---
name: ux
description: 'LobeHub product design values / principles / checklists. Load this skill whenever the work touches user-interface features or implementation — designing or building any user-facing flow — to get better UX results.'
user-invocable: false
---

# UX — Design Values & Execution Checklists

How LobeHub products should feel, and concrete rules to get there. Use this when
**building or reviewing** any user-facing flow. For component/styling choices see
**react**, for wording see **microcopy**, for imperative modal wiring see **modal**.

## Design values

LobeHub follows four product design values — **Natural・Meaningful・Certainty・
Growth**. Read them before designing:
**[references/design-values.md](references/design-values.md)** (definitions +
conflict priority).

> The checklists below are the execution layer. Each item is tagged with the
> value(s) it serves; for what those values mean, see the file above.

## How this is organized

The checklists are grouped by **interaction type** — the kind of thing the user
is doing. Jump to the module that matches the surface you're building (reading a
list, editing content, running an action, …); each module collects the rules
specific to that interaction. The same surface often spans several modules (an
editable list is Read + Edit + Act) — walk each that applies.

---

## 1. Read — viewing data & lists

Any surface that **displays** records, lists, or detail. Covers the states a data
view can be in, behavior at scale, and keeping the user's place visible.

### 1.1 Data states: empty / loading / error・Meaningful・Certainty

Every data surface has **four** states — design all of them, not just "has data".

- [ ] **Empty state is a purpose-built page, not a blank screen.** It explains what
      this is, why it's empty, and gives a clear next action (CTA + value props).
      ✅ Devices: an empty "Connect your first device" page with primary/secondary
      connect paths and "what you can do once connected" cards — ❌ not a bare title
      over skeleton rows or a blank body. _(Meaningful)_
- [ ] **Distinguish the empty variants** — "no data yet" (onboarding CTA) vs
      "no match for filters" (clear-filters affordance) are different screens. _(Certainty)_
- [ ] **Always-rendered chrome still needs a body empty state.** When a surface
      keeps its toolbar / header mounted even with no data (so a create / `+`
      affordance stays reachable), the **body** below it must still render an empty
      placeholder — persistent chrome is not an excuse to leave the content area
      blank. ✅ The agent **Documents** tab keeps its new-folder / new-doc toolbar
      and renders an `Empty` below it when there are no documents — ❌ not a toolbar
      over dead space. _(Meaningful)_
- [ ] **Loading state** designed (skeleton / NeuralNetworkLoading), not a flash of
      blank or layout shift. _(Natural)_
- [ ] **Error state** designed — surface the reason and a retry/back path. _(Meaningful)_

### 1.2 Lists at scale・Certainty・Natural

A list/data page must be designed for its **whole range of sizes**, not just the
demo data.

- [ ] **Walk the scale: 1 / 2 / 5 / 20 / 100 / 1k–10k rows.** Pick the right
      mechanism per range — plain render → load-more / pagination → virtual scroll;
      add batch-select / bulk actions once counts get large. _(Certainty)_
- [ ] **Co-design empty / loading / error with the data state** (see §1.1). A list
      isn't done until all four render well. _(Natural)_

### 1.3 Selection visibility in scrolled lists・Certainty・Natural

A capped / scrollable / virtualized list mounts at `scrollTop = 0`. If the
active item sits below the fold, the user lands on a valid selection that is
**off-screen** — and reads it as "nothing is selected" or a broken page. Any
list that can open with a pre-selected item must **scroll that item into view**.
This is an easy case to miss: it only shows up once the list is long enough and
the selection is restored rather than freshly clicked.

- [ ] **Scroll the active item into view on mount / restore.** When the selection
      is restored from a URL query, deep link, or persisted state (not a fresh
      click), bring it into view — the container starts at the top otherwise. ✅
      The nested thread list is capped to \~9 rows; a thread restored from
      `?thread=` below the fold is scrolled into view on mount. _(Certainty)_
- [ ] **Hardest when the selection has no other anchor.** If the parent/container
      row isn't highlighted while a child is active (no breadcrumb, no header
      echo), an off-screen active row means **zero** visible feedback — design
      for exactly this case. _(Meaningful)_
- [ ] **Use `block: 'nearest'` (or equivalent).** Only scroll when the row is
      actually off-screen; an already-visible selection must not jump. _(Natural)_
- [ ] **Re-run once async rows mount.** The active id is usually known before the
      list finishes loading; key the scroll off a list-ready signal (e.g. row
      count), not only off the id, so a restored selection still lands when the
      data arrives. _(Certainty)_
- [ ] **Mirror it across duplicated list variants** so the behavior can't regress
      in just one (e.g. parallel agent / group lists). _(Certainty)_

### 1.4 Option visibility in pickers・Certainty・Meaningful

- [ ] **Pickers list every valid target.** Watch for options dropped by backend
      list queries (pagination, `virtual` flags, scope filters) and add them back.
      ✅ The default "LobeAI" (inbox) agent is `virtual` and excluded from the
      sidebar list, so the move picker re-adds it. An empty picker must mean
      "genuinely none", never "we filtered out the only option". _(Meaningful)_

### 1.5 Default view reflects entry intent & data state・Certainty・Meaningful

A surface with multiple tabs / views / panels has a **landing** selection. Don't
hardcode it to "the first tab" — derive it from **(a) how the user got here** (the
intent their navigation carried) and **(b) which views actually have data**. A
static default that lands the user on an empty tab while a sibling holds exactly
what they came for reads as broken. This pairs with §1.1: the empty state is the
fallback _within_ a view; this rule is about not landing on that empty view in the
first place when a better one exists.

- [ ] **Open on the tab the entry implies.** When navigation carries intent — the
      user clicked a Skill, a file, a record of a specific type — land on the view
      that shows it, not the static first tab. ✅ Opening a document page by clicking
      a **skill** lands the right panel on the **Skills** tab; opening a plain
      document lands on **Documents**. _(Meaningful)_
- [ ] **Fall back to a populated view when the default would be empty.** If the
      default tab has no data but a sibling does, default to the populated one so
      the surface opens on content. ✅ An agent with only skills (no documents)
      opens the panel on **Skills** instead of an empty **Documents** tab. _(Certainty)_
- [ ] **Decide from resolved state, not mid-load.** Compute the default once the
      data has loaded — choosing off an empty _in-flight_ list flips the tab as data
      arrives. Hold the static default while loading, switch on resolved-empty. _(Certainty)_
- [ ] **A manual choice wins and sticks.** Once the user picks a tab, stop
      auto-selecting — track "user-picked" separately (e.g. a nullable `pickedTab`
      that overrides the derived default) so later data changes don't yank them off
      their choice. _(Natural)_

---

## 2. Edit — entering & changing content

Any surface where the user **types or edits**. Input is expensive effort; the
overriding rule is **never lose it**.

### 2.1 Protect in-progress edits・Certainty・Meaningful

Typed / edited content is real user effort; losing it is one of the most
infuriating outcomes a product can produce. Whenever an editor holds unsaved
input, assume the exit can be **accidental** — a misclick, a refresh, a crash, a
navigation, a failed save — and build a safety net: back the draft up locally and
recover it.

- [ ] **Back up the draft locally as the user types.** Persist to
      localStorage / IndexedDB / store so a refresh, crash, accidental close, or
      navigation doesn't vaporize the content. _(Certainty)_
- [ ] **Restore on return.** Coming back to the same editing context auto-restores
      (or offers to restore) the unsaved draft, rather than showing a blank field. _(Meaningful)_
- [ ] **Guard destructive exits.** Closing / navigating / switching items away
      from a dirty editor warns or auto-saves — never silently discards. _(Certainty)_
- [ ] **Survive a failed save.** If the save errors, keep the user's content in
      the field / draft and let them retry; never clear the input on failure. _(Meaningful)_
- [ ] **Scope the draft to its target** (per topic / message / item id) so drafts
      don't bleed across entities or resurrect on the wrong item. _(Certainty)_

---

## 3. Act — operations, flows & buttons

Any surface where the user **performs an action** — a single op, a bulk op, or a
multi-step flow. Covers momentum, focus, and full entity lifecycle.

### 3.1 Flow & momentum・Natural・Meaningful

Every action chain must **push the user forward**, never dead-end or block the flow.

- [ ] **Forward momentum** — after any operation, lead the user to the next step,
      don't just stop. _(Meaningful)_
- [ ] **Success state = primary "go to result", secondary "dismiss"** — the strong
      button is the forward action (take me to the result); "Done" is the weak/
      secondary button. ✅ After moving topics: primary = "Go to «target»", secondary
      \= "Done". _(Meaningful・Natural)_
- [ ] **Bulk ⇄ single-item parity** — an action on a multi-select toolbar must also
      be reachable on a single item (its context menu), and vice versa. _(Certainty)_
- [ ] **Confirm → in-progress → done, in one surface** — bulk/irreversible/async
      ops use a modal state machine: a confirm step stating exactly what happens →
      an in-progress view with **dismissal locked** → a done (or error) view in the
      same modal. Never fire-and-forget with only a toast; never leave a dead
      spinner. _(Certainty・Meaningful)_

### 3.2 One primary button per surface・Certainty

- [ ] **One primary button per surface.** The single primary CTA tells the user the
      core action; everything else is secondary/tertiary. Never a pile of primary
      buttons competing for attention. _(Certainty)_

### 3.3 Entity lifecycle completeness・Meaningful・Certainty

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
      lifecycle ops and build the ones that apply. _(Meaningful)_
- [ ] **Operation set per source/ownership class** — built-in may be read-only;
      anything the user _installed_ must be removable; anything the user _created_
      must be editable **and** deletable. _(Certainty)_
- [ ] **Each item exposes its allowed ops** (hover action / context menu / detail
      page), and there's a clear entry point to add/create where applicable. _(Natural)_
- [ ] **An intentionally-absent op is a documented decision, not an oversight**
      (e.g. official tools can't be deleted — by design). _(Certainty)_

---

## 4. Feedback — loading & system response

How the product **answers back** while and after the user acts — loading visuals
and proactive guardrails.

### 4.1 Loading visuals・Natural

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

### 4.2 Capability-gated features・Certainty・Meaningful

A feature can be fully built and still produce a broken result when the selected
model — or its still-loading config — **can't deliver the capability the feature
depends on** (for example, an agentic run on a model without tool calling). This
is usually the user's configuration choice, not a defect; but if the product stays
silent the user reads it as the product being broken. When a feature's success
depends on a capability the current config may lack, the product owes a
**proactive, non-blocking reminder** — a guardrail, not a gate.

- [ ] **Surface the mismatch, don't fail silently.** When a feature needs a model
      capability (tool calling, vision, reasoning, long context) the current model
      lacks, show a soft inline warning at the point of action — never a hard block
      or a modal that stops the user. _(Meaningful)_
- [ ] **Stay reactive.** The reminder clears the moment the user switches to a
      capable model — derive it from live state, not a one-shot check. _(Natural)_
- [ ] **Don't warn while config is loading.** A capability that hasn't resolved yet
      looks "unsupported"; warning then is a false alarm — exactly the glitch users
      mistake for a product bug. Warn only on a _resolved_ unsupported state. _(Certainty)_
- [ ] **Scope to the mode that needs it.** Show only when the capability-dependent
      mode is on; one reminder per root cause, never a pile of overlapping notices. _(Natural・Certainty)_
- [ ] **State the problem and the remedy.** The copy says what's wrong _and_ what
      the user should do about it. _(Meaningful)_

---

## 5. Grow — discoverability & progressive disclosure

How the product **deepens** as the user's needs deepen.

### 5.1 Progressive disclosure・Growth

The product should grow with the user — deeper power shows up as needs deepen.

- [ ] **Progressive disclosure** — keep the novice path clean; reveal advanced
      capabilities as the user gets there, don't dump everything at once. _(Growth・Natural)_
- [ ] **Surface related actions at the moment of need** — make the next capability
      discoverable in context (e.g. after the first item exists, offer what to do
      with it), not buried in a far-off menu. _(Growth・Meaningful)_

---

## Quick review checklist

**Read — viewing data & lists**

- [ ] Empty / loading / error states are all designed; empty is a real page with a CTA. Always-rendered chrome (toolbar/header) still gets a body empty state.
- [ ] List designed across 1 → 10k rows (virtual scroll / pagination / batch as needed).
- [ ] Capped/scrollable/virtualized list scrolls the restored active item into view on mount (`block: 'nearest'`, re-run after async rows mount).
- [ ] Pickers show all valid targets (default/inbox included); empty = truly none.
- [ ] Multi-tab/view surface lands on the tab the entry intent implies (and falls back to a populated view, decided from resolved state); a manual pick sticks.

**Edit — entering & changing content**

- [ ] Editors back up in-progress input locally and recover it after refresh/crash/failed-save; destructive exits warn, never silently discard.

**Act — operations, flows & buttons**

- [ ] Action leads the user forward; success offers a primary "go to result".
- [ ] Bulk action has a single-item entry (and vice versa).
- [ ] Async/bulk/irreversible action: confirm → in-progress (locked) → done/error.
- [ ] Exactly one primary button per surface.
- [ ] Listed entities have their full lifecycle (not display-only); ops match source (built-in / installed / custom).

**Feedback — loading & system response**

- [ ] No antd `Spin`; use `NeuralNetworkLoading` / project loaders.
- [ ] Capability-gated feature warns (soft, reactive, load-gated) when the model can't deliver it; copy gives the remedy.

**Grow — discoverability & progressive disclosure**

- [ ] Advanced capability is progressively disclosed / discoverable at the moment of need.

## Related skills

- **modal** — imperative `createModal` state-machine wiring for confirm/progress/done.
- **microcopy** — wording for confirm / done / empty / error states.
- **react** — component priority, `Button` usage, styling.
