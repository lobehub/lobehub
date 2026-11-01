# Worked example — Memory (记忆) module audit

A real run of this skill against the **Memory module**, 2026-07 (LOBE-11150) — a personal-AI-memory
management area: a **home persona** dashboard + five isomorphic list surfaces
(identities / contexts / preferences / experiences / activities), each with a filter bar, grid /
timeline views, a right-side detail panel, and an "Analyze" flow that extracts memory from chat
history. Surfaces under `src/routes/(main)/memory/**`, backed by
`src/store/userMemory/slices/{home,identity,context,preference,experience,activity,base}`. Use it
as a template for the output shape, not current-state truth (re-verify before citing).

**Surface class:** personal AI memory / personalization store — benchmark against ChatGPT "Manage
memories", Gemini personalization, Mem0, Personal.ai, CRM "customer 360".
**Layers run:** L1 (static / code) ✅. L2 / L3 ⏳ not run.

**Headline:** two axes fail. (1) The **read/write error side has no handling at all** — one root
cause (every `useUserMemoryStore` fetch resolves only on success, no `onError`) hangs list pages on
a **permanent skeleton**, the home page as a **false-empty**, and detail panels as a **permanent
blank**; the edit modal spins forever on a failed save. (2) The **surface-class trust-repair /
data-control axis is absent** — for a store of data _about the user_ there is no way to correct a
wrong memory (only blind-edit or delete), no retain-without-use (pause/exclude), no export, and no
undo — exactly what this product class is judged on, and exactly what a code-only read is blind to.

## 1 — Patterns in use

| Pattern (family)                   | Where                                                     | Rating | Note                                              |
| ---------------------------------- | --------------------------------------------------------- | ------ | ------------------------------------------------- |
| Overview + Detail (nav)            | home → 5 list tabs → right-panel detail                   | ✅     | clean drill; sidebar `Nav.tsx`                    |
| Empty-as-onboarding (growth)       | list/home empty → `MemoryEmpty` + `MemoryAnalysis` CTA    | ⚠️     | **activities empty has no CTA** (gap X1)          |
| Loading Skeleton (feedback)        | list `Loading.tsx` reuses card chrome; `DetailLoading`    | ✅     | chrome-reusing skeleton (home uses full-page)     |
| **Failure + Retry (feedback)**     | every fetch (5 lists + persona/tags + detail + load-more) | — abs. | systemic root cause (gap A)                       |
| Search / filter (read)             | per-tab `FilterBar`; `q → queryMemories` server-side      | ✅     | server-side search — no false-empty on unfetched  |
| Lists at scale (read)              | grid + timeline via Virtuoso, page-12 load-more           | ✅     | virtualized + load-more spinner                   |
| Selection visibility (read §1.3)   | card click → `?xId=` + right panel                        | — abs. | no scroll-into-view, no active highlight (gap D)  |
| Live/polling (read §1.7)           | analysis task poll (`useTask.ts`)                         | ⚠️     | failed poll not distinct from running (gap E)     |
| Entity lifecycle — delete (act)    | `*Dropdown` delete → `confirmModal` (danger)              | ⚠️     | confirm ok; **no undo**, no failure toast         |
| Entity lifecycle — edit (act/edit) | `EditableModal` → `EditorModal`                           | ⚠️     | failed save spins forever (gap B); volatile draft |
| Entity lifecycle — correct / add   | —                                                         | — abs. | can't mark-wrong or add manually (gap C, X3)      |
| Wide-blast confirm (act §3.7)      | `PurgeButton` (delete ALL)                                | ⚠️     | one-click danger, no type-to-confirm (gap C)      |
| Provenance (source link)           | `SourceLink.tsx` → chat topic                             | ✅     | the one class-norm we ship (backward-only)        |
| Data control (export / pause)      | —                                                         | — abs. | no export, no off-switch, no undo (gap C)         |
| Cross-tab consistency (semantic)   | 5 list tabs                                               | ⚠️     | activities diverges; sort vanishes on timeline    |

## 2 — Strengths / good cases (don't regress)

This surface is strong on the **read happy-path** and on **one write flow (analysis)**, but weak on
**error handling** and **data-control** — the gaps in §3 rank against that mixed baseline. Keep the
following; don't "fix" them.

- **✅ 亮点 — `DateRangeModal` submit state machine.** Double-submit guard + try/catch/finally +
  success toast + close (`MemoryAnalysis/DateRangeModal.tsx:42-60`). Load-bearing: this is the exact
  ✅ contrast to gap B's `EditorModal` no-`finally` trap — the model every memory write should copy
  (reset busy in `finally`, toast on `catch`). → **landed as ux Feedback §4.2 ✅**.
- **✅ 亮点 — Server-side per-tab search.** `q` is passed straight to `queryMemories`
  (`contexts/index.tsx:57-62`, mirrored per tab), so search queries the full set — no client-filter
  false-"no results" over the loaded page. Load-bearing: search correctness at scale.
  → **landed as ux Read §1.2 ✅**.
- **✅ 亮点 — `SourceLink` provenance.** Each item links back to its source chat topic
  (`SourceLink.tsx:16-40`, rendered in every `*RightPanel`). Load-bearing: the one class-norm we
  ship on the trust axis ("why does it know this") — it anchors the axis gap C says is otherwise
  absent, so _keeping and extending_ it (backward source → forward "used in N chats") is the move.
- **✅ — Virtualized grid + timeline with a real load-more spinner.** Virtuoso lists
  (`features/GridView`, `features/TimeLineView`); page-2 shows a footer skeleton (uncached SWR key →
  `isLoading`). Load-bearing: lists-at-scale — the load-more path itself is sound; only its _failure_
  is silent (part of gap A).
- **✅ — Chrome-reusing list skeleton** (`Loading.tsx` keeps card container / border / radius and
  swaps only text); **single-item delete confirm** (`*Dropdown.tsx:33-44`, danger `confirmModal`);
  **analysis running / error Alert** (`Status.tsx`). Solid, not standout — keep.

## 3 — Experience gaps (ranked)

**🔴 A — No `onError` / error state anywhere; every fetch resolves only on success.** Systemic:
each slice sets `xSearchLoading=false` / `xInit=true` **only in `onSuccess`** with no `onError`
(`context/action.ts:88`, `activity/action.ts:90`, `identity/action.ts:125`, `preference/action.ts:91`,
`experience/action.ts:88`; persona/tags `home/action.ts:27,50`; detail `base/action.ts:238`). No
`*Error` field exists in any `initialState`. Consumers hang differently:

- **list permanent skeleton** — gate is `showLoading = xSearchLoading || !xInit`
  (`contexts/index.tsx:80`); on failure the flag never flips → skeleton forever, no retry.
- **home false-empty** — home gates on SWR `isLoading` (resolves after retries) then falls to
  `MemoryEmpty` when `!persona && !roles.length` (`(home)/index.tsx:52-63`) → a failed load reads
  as "analyze to get started", inviting redundant re-analysis.
- **detail permanent blank** — 5 panels read only `{data, isLoading}`; `content` is set only in
  the `isLoading` / `data` branches (`ContextRightPanel.tsx:32-34` + 4 twins) → error _and_
  not-found both render an empty panel body.
- **load-more silent no-op** — a failed page-2 fetch appends nothing, footer spinner vanishes,
  reads as "that's all there is" (`context/action.ts:44-55`).
  → Feedback §4.2 + Read §1.1 (error before empty; error ≠ not-found). The module's flagship ❌.

**🔴 B — Edit save failure: the modal OK button spins forever, no error, no retry, edit discarded
on close.** `EditorModal onOk` runs `setConfirmLoading(true) → await onConfirm → setConfirmLoading(false)`
with **no try/catch/finally** (`src/features/EditorModal/index.tsx:35-40`), and `updateMemory` has
no `.catch` / failure toast (`base/action.ts:157-236`). A rejected write leaves OK permanently
loading; closing / reloading loses the edit. → Feedback §4.2 (awaited write, no `finally`), Act §3.1.

**🔴 C — Surface-class trust-repair & data-control axis is absent (data _about the user_).** For a
store of what the AI believes about you, the class contract is: correct a wrong belief, keep a fact
without using it, take your data out, undo a mistake. None exist:

- **No "this is wrong" / report** — dropdowns offer only edit + delete (`*Dropdown.tsx:47-61`); edit
  is a blind single-field overwrite, and a deleted fact can be re-extracted identically.
- **No retain-without-use** — the only way to stop the AI using a fact is to permanently delete it;
  schema has a `status` column but no UI on/off (no global "memory off", no per-item pause/exclude).
- **No export / download** — `crud.ts` exposes only get/update/delete/deleteAll; no export in UI.
- **No undo / soft-delete** — delete + `purgeAllMemories` (`base/action.ts:54`) are hard, no recovery;
  **Purge all** is a one-click danger `confirmModal` with **no type-to-confirm** (`PurgeButton.tsx:34`).
  → new ux rule (Act §3.9) + Act §3.7 (wide-blast). L1 is structurally blind to these (no `file:line`).

**🟠 X1 — `activities` empty state has no CTA, and its toolbar drops Analysis.**
`activities/features/List/index.tsx:33` renders `<MemoryEmpty>` with no children (siblings pass
`<MemoryAnalysis/>`); `activities/index.tsx:85` is `<ActionBar showPurge>` (siblings add
`showAnalysis`). So Activities has _no path to Analysis at all_ and an empty tab dead-ends. →
Read §1.1, "consistency is semantic".

**🟠 D — Deep-linked / restored active item isn't scrolled into view, and cards have no active
highlight.** `grep scrollIntoView|scrollToIndex` across the memory tree = 0; Virtuoso mounts at
`scrollTop=0` (`TimeLineView/index.tsx`, `GridView/index.tsx`); cards take no `active` prop. A
`?contextId=` below the fold = zero list feedback. → Read §1.3 (the no-anchor case).

**🟠 E — Analysis flow: failed run has no retry, and a failed poll is indistinguishable from
running.** `Status.tsx:49-71` shows an error Alert with **no Retry**; `useTask.ts` keeps last SWR
data on a poll error so a failed refresh keeps a stale running frame. → Act §3.1, Read §1.7.

**🟠 F — No global cross-layer search.** Each tab searches only itself; `searchMemory` /
`retrieveMemory` exist in the service (`services/userMemory/index.ts`) but aren't wired to any UI,
so "find everything about X" means repeating the query in 5 tabs. → Read §1.8 (class norm).

**🟠 G — Manual "Add memory" is impossible from the UI though the backend supports it.**
`add*Memory` / `createIdentity` exist (`services/userMemory/index.ts`) but no button calls them. →
Act §3.4 (lifecycle: create entry point).

**🟠 H — Sort silently vanishes on switch to timeline (4 tabs).** Sort `<Select>` renders only in
grid mode and the chosen sort is dropped on toggle with no signal (`contexts/index.tsx:52,106`). →
"consistency is semantic".

**🟠 I — Home persona is read-only and dead-ends.** The persona editor + edit trigger are
**commented out** (`Persona/index.tsx:16-35`, `(home)/index.tsx:27,36`); persona sections / role
tags don't link into the detail tabs. → Grow §5.3, Act §3.4.

**🟡 J — Edit draft is volatile; silent discard on close.** Source is in-memory
`editingMemoryContent`; `destroyOnHidden` + `onCancel=clearEditingMemory` discards with no
dirty-check (`EditableModal.tsx:9,28`). → Edit §2.1 (lighter for modals).

**🟡 K — Score / usage signals inconsistent.** Confidence shows for experiences only;
`scoreImpact` / `scoreUrgency` / `scorePriority` and `accessedCount` / `lastAccessedAt` are stored
but never surfaced. → consistency; class norm (recency/usage signals).

**🟡 L — No bulk-select; only "one" or "everything".** Between per-item delete and Purge-all there is
no multi-select. → Act §3.1 (bulk ⇄ single parity).

**🟡 M — No per-layer explanation / onboarding.** Five tabs with only generic empty copy; users get
no definition of identities vs contexts vs … → Grow §5.1.

**🟡 N — `DateRangeModal` allows an unbounded all-null range submit** with no confirm of scope
(`DateRangeModal.tsx:42-49`); the analysis trigger isn't hard-locked during an in-flight task
(`AnalysisTrigger.tsx:19`). → friction / Act §3.1.

## 4 — Skill feedback

- **New rule landed:** Act **§3.9** — _a surface holding data about the user (memory /
  personalization / profile store) owes trust-repair + data-control: correct-or-mark-wrong (not just
  delete), retain-without-use (pause / exclude), export, and undo / soft-delete._ Memory is the ❌
  example (gap C). Mirrored into the Quick review.
- **Landed as ❌ examples on existing rules** (Memory is a textbook instance — no other new rule):
  - Feedback **§4.2** — the whole `userMemory` store `onSuccess`-only / no-`onError` pattern (gap A)
    - the `EditorModal onOk` no-`finally` write trap (gap B).
  - Read **§1.1** — Memory detail panel (blank on error _and_ not-found) + home false-empty (gap A).
  - Read **§1.3** — Memory list: no scroll-into-view + no active-card highlight (gap D).
  - Act **§3.7** — `PurgeButton` one-click wide-blast, no type-to-confirm (gap C).
- **Landed as ✅ examples on existing rules** (the good-case half of 回灌，from §2):
  - Feedback **§4.2** — `DateRangeModal`'s submit machine (guard + try/catch/**finally** + toast) is
    the in-repo ✅ the write-side-`finally` rule now cites, directly beside the gap-B ❌.
  - Read **§1.2** — Memory per-tab server-side search is the ✅ contrast to the Pages client-filter ❌.
- **Validated existing rules:** §4.2 permanent-skeleton, Read §1.1 empty-vs-failed, Act §3.1
  done/error, "consistency is semantic" (gaps X1/H).

## 5 — Pending: L2 + L3

- **L2** — how the permanent skeleton / blank / false-empty actually render; home full-page loader
  CLS; whether `MemoryEmpty` reads as a real page; the persona / tag-cloud layout; dark mode.
- **L3** — force each fetch to fail to confirm gaps A/B/E live (permanent skeleton / blank /
  spinning modal / stale poll); walk analyze → running → done; deep-link a `?xId=` below the fold to
  confirm gap D; force a delete/update failure to confirm the missing toasts.
