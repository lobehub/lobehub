# Worked example — Pages module (`/page` list + editor) audit

A real run of this skill against the **Pages module**, 2026-07 — the document surface:
list sidebar (`/page`) + full-screen rich-text editor (`/page/[id]`) with version History,
AI Copilot, a collaborative edit-lock, and a public share view (`/share/page/[id]`). Use it
as a template for the output shape, not as current-state truth (the code moves; re-verify
before citing).

**Surface class:** document editor — benchmark against Notion / Google Docs / Craft.
**Layers run:** L1 (static / code) ✅ — everything below. L2 (visual) / L3 (dynamic + CLS)
⏳ not yet run — see §5. Verdicts about the render are L1 inferences here, pending L2.

**Load-bearing files:** `routes/(main)/page/{index,_layout,[id]}`,
`features/Pages/PageLayout/*` (sidebar list), `features/PageExplorer/*`,
`features/PageEditor/*` (editor + Copilot + History + lock), `store/page/*`,
`store/document/slices/editor/*`, `routes/share/page/[id]`.

**Blind spot:** the share view's error/empty shell is a **cloud-only business stub** in this
OSS repo (`business/client/features/PageShare/PublishedShell.tsx` returns `{children}`); L1
here can't audit its real states — needs the cloud build (L2/L3).

## 1 — Patterns in use

| Pattern (family)                   | Where                                                              | Rating | Note                                             |
| ---------------------------------- | ------------------------------------------------------------------ | ------ | ------------------------------------------------ |
| Overview + Detail (nav/data)       | sidebar list → `/page/[id]` editor                                 | ✅     | preserves place                                  |
| Deep-linking (nav)                 | `/page/:id`, `/share/page/:id`                                     | ✅     | URL restores doc                                 |
| Empty-state as onboarding (growth) | main-stage `PageExplorerPlaceholder` (new / upload / Notion cards) | ✅     | rich CTA — highlight                             |
| Empty state — sidebar (data)       | `PageEmpty.tsx`                                                    | ⚠️     | bare `Empty`, **no CTA** (gap ⑦)                 |
| Loading Skeleton (feedback)        | `Body` + `List` `SkeletonList`                                     | ⚠️     | present but **can't fail** (gap ①)               |
| **Failure + Retry (feedback)**     | list / history / save                                              | — abs. | the module's dominant gap (①②③④)                 |
| Autosave / Smart Defaults (input)  | `performSave` / `performMetaSave`, `AutoSaveHint`                  | ⚠️     | saving→saved, **no failed** (gaps ②③)            |
| Draft safety (edit)                | `usePageDraft.ts` (sessionStorage)                                 | ⚠️     | only snapshots while lock degraded (②)           |
| Entity lifecycle (act)             | delete / rename / duplicate / export / history-restore             | ✅⚠️   | Header ops solid; **sidebar ops silent** (gap ⑤) |
| Command History (act)              | `History/*` — list + Compare + Restore                             | ✅     | confirm + in-progress + error toast              |
| Cancelability / lock (feedback)    | `EditingIndicator` / `LockedAlert` / `LockStatusBanner`            | ✅     | three-way, mature — highlight                    |
| Lists at scale (data)              | `AllPagesDrawer` (`VList`) + `loadMoreDocuments`                   | ⚠️     | search filters loaded subset only (⑥)            |
| Modal Panel (nav)                  | Copilot / History right panel (`RightPanel`)                       | ✅     | Copilot reuses shared Conversation               |

**Read:** the editor's **entity lifecycle** and **collaborative lock** are mature; the
weakness clusters hard in **Feedback (failure states absent, save swallowed to `idle`)** and
**Read (failed load masquerading as empty; search over a partial list)** — the same
soft-spots every audit so far has hit.

## 2 — Strengths / good cases (don't regress)

The editor is strong where it counts — these are the ✅ half of the 回灌 loop and the "don't
regress" list for the next refactor. One lands as a **✅ example in the `ux` checklists** (the
Header duplicate, see §4):

- **✅ 亮点 — Three-way collaborative lock.** `EditingIndicator` / `LockedAlert` /
  `LockStatusBanner` — a mature, legible presence / lock model that makes "someone else is
  editing" visible at three altitudes rather than a single opaque flag; the one place cancelability
  / concurrency is surfaced end-to-end, so a refactor must keep all three in sync.
- **✅ 亮点 — Command History surfaces failure end-to-end.** `History/*` — list + Compare +
  Restore with confirm + in-progress + error toast; the single flow in the module that carries a
  failure state all the way to the user (the ✅ counterpoint to the swallowed save/meta/history
  failures in gaps ②③④), which is exactly why it's load-bearing as a reference.
- **✅ 亮点 — Header entity lifecycle does it right (→ landed as ux Act §3.1 ✅).** the editor
  **Header** delete / rename / duplicate / export / restore where duplicate does try/catch +
  success/error `message` (`Header/useMenu.tsx:60-70`) — the ✅ contrast to the silent sidebar ops
  in gap ⑤; same intent, but here the mutation surfaces its own failure.
- **✅ 亮点 — Main-stage empty-state as onboarding.** `PageExplorerPlaceholder` (new / upload /
  Notion cards) turns the no-doc state into a rich CTA rather than dead space — the growth-side
  "empty is a starting point" pattern done to spec (the sidebar empty in gap ⑦ is the ⚠️ foil).

## 3 — Experience gaps (ranked)

**① Sidebar list fetch failure → permanent skeleton — Feedback §4.2** 🔴
`useFetchDocuments` writes `documents` only in its success `onData`
(`store/page/slices/list/action.ts:168-190`), and `isDocumentsLoading = documents ===
undefined` (`list/selectors.ts:9`). `Body` renders `SkeletonList` while loading
(`Body/index.tsx:59-60`). On fetch error `documents` stays `undefined` → **skeleton spins
forever, no error, no retry** — the init-flag-gated-on-success trap.

**② Silent body-autosave failure + draft gap — Feedback §4.4 / Edit §2.1** 🔴
`performSave`'s catch sets `saveStatus: 'idle'` for non-lock errors
(`store/document/slices/editor/action.ts:360-364`); the enum is `idle | saving | saved` with
**no `failed`** (`editor/initialState.ts:65`). Only `CONFLICT` (lock) is surfaced; a network
/ 500 failure is indistinguishable from success. `isDirty` stays true, but `usePageDraft`
only snapshots while the lock is **unhealthy** (`usePageDraft.ts:109-118`) — so under a
healthy lock a persistent save failure gives no failed state **and** no draft backup; a
refresh loses the work silently.

**③ Silent meta (title/emoji) save failure — Feedback §4.4** 🟠
`performMetaSave` catch sets `metaSaveStatus: 'idle'` (`PageEditor/store/action.ts:189-192`)
— again no `failed`. A title/emoji edit that fails to persist shows nothing.

**④ History load failure masquerades as "no history" — Read §1.1** 🟠
The History SWR destructures only `{ data, isLoading }`, dropping `error`
(`History/index.tsx:101`); render is `items.length === 0 ? <Empty "no history"/>`. A failed
fetch → the empty state, no retry → the user reads "this doc has no versions".

**⑤ Sidebar create / rename / duplicate fail silently — Act §3.1** 🟠
`createNewPage` rethrows on error (`crud/action.ts:84-90`) but the callers
(`AddButton.tsx:17-22`, `PageExplorerPlaceholder.tsx:116-123`) are fire-and-forget — no
catch, no toast; the optimistic page flashes in and vanishes (plus an unhandled rejection).
Sidebar rename (`Editing.tsx:39-40`) and duplicate (`Item/useDropdownMenu.tsx:59-67`) only
`console.error`. **Inconsistent:** the editor **Header** duplicate does it right (try/catch +
success/error `message`, `Header/useMenu.tsx:60-70`) — same intent, two feedback behaviors.

**⑥ "All pages" search filters only the loaded subset — Read §1.2** 🟠
`AllPagesDrawer/Content.tsx:32-41` filters `allFilteredDocuments` client-side by
`title/content.includes`, and `handleScroll` bails while searching (`:49`) so it never loads
more. With 500 pages but 40 loaded, searching an unloaded page returns "no results" though it
exists — a false empty. (Read-side twin of the paginated-sort-server-side rule.)

**⑦ Sidebar empty state has no CTA — Read §1.1** 🟡
`PageEmpty.tsx` renders only a description (it does distinguish "no pages" vs "no search
match" — good), but no "create your first page" action; the rich CTA lives only in the
main-stage placeholder, so the sidebar empty is a quiet dead-end.

**⑧ Hardcoded English string — i18n** 🟡
`PageExplorerPlaceholder.tsx:298` renders literal `'Uploading...'` instead of a `t()` key.

**⏳ Share view error/empty is a cloud stub — blind spot**
`share/page/[id]/index.tsx:34-35` renders `<PublishedShell data error>{data ? viewer :
null}</PublishedShell>`; the OSS `PublishedShell` ignores `data`/`error` and returns
`{children}`, so a failed/absent share renders **blank**. Real behavior is in the business
package → confirm on the cloud build (L2/L3).

## 4 — Skill feedback

- **Landed as strengthened `ux` items** from this audit:
  - Feedback **§4.4** — new checklist line + a PageEditor ❌ example: the save-state enum
    must be able to _represent_ failure; a `catch` that resets to `idle` is the silent-write
    trap baked into the type (gaps ②③).
  - Act **§3.1** — new "optimistic mutation surfaces failure" rule + ❌ (sidebar
    create/rename/duplicate) vs ✅ (Header duplicate) example (gap ⑤).
  - Read **§1.2** — new "search over a paginated list queries the full set server-side" rule
    - `AllPagesDrawer` ❌ example (gap ⑥).
  - Each mirrored into the SKILL.md Quick review.
- **Validated existing rules** (good ❌ examples to cite): §4.2 permanent-skeleton (gap ①),
  Read §1.1 empty-vs-failed (gap ④), Read §1.1 empty-needs-CTA (gap ⑦).

## 5 — Pending: L2 visual + L3 dynamic

L1-only; a later pass should confirm / quantify:

- **L2 (visual)** — how the sidebar empty (`PageEmpty`) actually reads (dead space vs page);
  the Copilot / History right-panel layout; whether the editor's single primary affordance is
  clear; narrow-width and dark-mode of the placeholder cards.
- **L3 (dynamic)** —
  - Force the list fetch offline to **confirm gap ① live** (permanent skeleton, no retry).
  - Force a save 500 under a healthy lock to **confirm gap ②** (silent success-looking state
    - no draft → refresh loses work).
  - Force the history fetch to error to **confirm gap ④** (shows "no history").
  - Drive create/rename/duplicate failure to **confirm gap ⑤** (item vanishes, no toast).
  - Search for an unloaded page in the all-pages drawer to **confirm gap ⑥** (false empty).
  - **Measure editor CLS/LCP** across the skeleton→content swap and Copilot mount.
