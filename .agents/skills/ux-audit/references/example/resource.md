# Worked example — Resource (资源) module audit

A real run of this skill against the **Resource module**, 2026-07 (LOBE-11149) — a
knowledge-base / file-library manager: resource home (all resources) → library (a single
knowledge base) → library-slug (a folder inside a library). Three surfaces under
`src/routes/(main)/resource/**`, all delegating to one shared feature,
`src/features/ResourceManager/**`, backed by `src/store/{file/slices/resource,library,tree}`.
Use it as a template for the output shape, not current-state truth (re-verify before citing).

**Surface class:** knowledge-base / file-library / resource manager — benchmark against Notion,
Google Drive / Dropbox, NotebookLM, Mem, Obsidian. Class norms checked: upload-with-progress,
search/filter, sort, bulk-select+bulk-ops, single-item lifecycle, file preview, item metadata
(size/type/date/embedding status), empty-as-onboarding vs no-match, pagination/infinite scroll.
**Layers run:** L1 (static / code) ✅. L2 / L3 ⏳ not run.

**Headline:** the **write / ingestion side is genuinely strong** — drag-drop upload with a live
progress dock, per-folder tree loading, virtualized infinite scroll, three-mode bulk-select,
batch delete/chunk with confirm, optimistic create/rename. But the **read side has no error
path anywhere**: every one of the four data fetches (resource list, sidebar KB list, search,
folder tree) reads only `isLoading`/`data` and never `error`, so a **failed fetch renders as
the onboarding empty state** — telling the user "create your first resource" when the load
actually broke. Two more failure-swallowing traps compound it: a library-detail fetch failure
renders as **404 Not Found** (deleted vs failed-to-load conflation), and the **upload dock
auto-dismisses _failed_ uploads after 3s** with no retry.

Same "resolves only on success" root cause as the Eval module — see [eval.md](eval.md).

## 1 — Patterns in use

| Pattern (family)                       | Where                                                                                     | Rating | Note                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | ------ | ------------------------------------------ |
| Overview + Detail (nav)                | home → library → folder(slug); sidebar tree drill                                         | ✅     | clean multi-level drill                    |
| Deep-linking (nav)                     | `/resource/library/:id/:slug` restores folder; tree expands ancestors                     | ✅     | breadcrumb-driven ancestor expand          |
| Empty-as-onboarding (growth)           | Explorer `EmptyPlaceholder` (Create KB / Upload File / Folder cards)                      | ✅     | real page + CTAs — highlight               |
| Loading Skeleton (feedback)            | list/masonry skeletons reuse row/card chrome; sidebar `SkeletonList`; tree `TreeSkeleton` | ✅     | textbook §4.1                              |
| **Failure + Retry (feedback)**         | every fetch (resource list, KB list, search, tree)                                        | — abs. | systemic root cause (gap A)                |
| Progress Indicator (feedback)          | UploadDock per-file + overall progress bar                                                | ✅     | but auto-dismisses failures (gap C)        |
| List at scale (data)                   | `Virtuoso` / `VList` virtual scroll + infinite `endReached` + footer skel                 | ✅     | main list solid                            |
| **Search over paginated set (data)**   | `SearchResultsOverlay` server query capped `limit: 50, offset: 0`                         | ⚠️     | no pagination past 50 matches (gap D)      |
| Entity lifecycle — delete/chunk (act)  | batch delete + batch chunk: confirm + async                                               | ✅     | confirm present                            |
| Entity lifecycle — create/rename (act) | KB create modal, inline rename, optimistic resource ops                                   | ✅/⚠️  | optimistic; rename draft in-memory (gap E) |
| Upload (input/act)                     | drag-drop zone + UploadDock                                                               | ✅/⚠️  | strong, but no retry on failure (gap C)    |
| Draft safety (edit)                    | search query → URL+store (survives); rename input → local `useState`                      | ⚠️     | rename draft not persisted (gap E, minor)  |

**Read:** ingestion, tree, virtualization, bulk-select and delete/chunk are solid. The weakness
clusters entirely in the **read side** — list/detail/search/tree `error` + retry — plus the
upload dock silently discarding failures.

## 2 — Strengths / good cases (don't regress)

The write /ingestion side is strong where it counts — these are the ✅ half of the 回灌 loop and
the "don't regress" list for the next refactor. Keep, don't "fix":

- **✅ 亮点 — Drag-drop upload with a live progress dock.** A drag-drop zone feeding
  `UploadDock`, which surfaces both per-file and overall progress bars while ingestion runs — the
  ingestion side never goes silent. (The one caveat is that it auto-dismisses _failed_ uploads;
  that's gap C, not a knock on the happy-path dock.)
- **✅ 亮点 — List at scale done right.** A **virtualized list _and_ masonry** (`Virtuoso` /
  `VList`) with infinite `endReached` paging plus footer skeletons, so the main list stays smooth
  at scale and the load-more affordance is honest rather than a hard cap.
- **✅ 亮点 — Per-folder lazy tree with ancestor auto-expand.** The folder tree loads per-node
  (per-folder lazy load with per-node loading state) and, on deep-link, auto-expands the whole
  ancestor chain to restore the folder in place — `/resource/library/:id/:slug` breadcrumb-driven
  ancestor expand.
- **✅ 亮点 — Three-mode bulk-select + safe batch ops.** Bulk-select across three modes
  (none / loaded / all) feeding **batch delete** and **batch chunk**, both gated behind a confirm
  and run async — destructive batch work never fires unconfirmed.
- **✅ 亮点 — Optimistic create/rename merged against server data.** KB create modal, inline
  rename and optimistic resource ops merged against the server via
  `mergeServerResourcesWithOptimistic` — the list updates instantly without diverging from
  server truth.
- **Explorer `EmptyPlaceholder` + chrome-reusing skeletons.** The Explorer `EmptyPlaceholder` is
  a real onboarding page (Create-KB / Upload-File / Upload-Folder cards), and the list / masonry /
  sidebar / tree skeletons all reuse row/card chrome for an in-place load→content swap — no antd
  `Spin` anywhere. A quiet feedback-hygiene win worth keeping.

## 3 — Experience gaps (ranked)

**🔴 A — No error/retry on any read; every fetch resolves only on success → a failed load
renders as the onboarding empty (or a blank / a false 404).** Systemic: all four consumers
read `{ data, isLoading }` (never `error`) and coerce failure into empty:

- **Explorer false-empty** — `useFetchResources` returns the full swr incl. `error`
  (`store/file/slices/resource/hooks.ts:104`), but the consumer destructures only
  `{ isLoading, isValidating }` (`Explorer/index.tsx:57`) and gates
  `showEmptyStatus = !isLoading && !isValidating && data?.length === 0` (`:89`) → a failed
  fetch → empty list → the "create your first resource" onboarding `EmptyPlaceholder`
  (`EmptyPlaceholder.tsx:65`).
- **Sidebar KB list** — `const { data, isLoading } = useFetchKnowledgeBaseList()`
  (`(home)/_layout/Body/LibraryList/index.tsx:22`); no `error`, so a failure renders either the
  "create new library" empty CTA or a blank list (`:38-48`).
- **Search overlay false-empty** — `const { data, isLoading } = useClientDataSWR(...)`
  (`SearchResultsOverlay.tsx:43`); a failed search → `!data` → "No results found" (`:113`),
  asserting "nothing matches" when the query actually errored.
- **Folder tree false-empty** — `isLoading = status[''] === 'loading'`; empty gated on
  `!isLoading && … visibleNodes.length === 0` (`LibraryHierarchy/index.tsx:60,83`) with no
  `'error'` branch → a failed tree load renders the "add folder" empty.
  → Read §1.1 (error before empty) + Feedback §4.2. The `error` signal already exists on the swr;
  it's simply never read — a cheap fix. The module's flagship ❌ example.

**🟠 B — library detail: a fetch failure renders as 404 "Not Found", conflating deleted with
failed-to-load, no retry.** `useKnowledgeBaseItem` is read as `{ data, isLoading }` and
`if (!isLoading && !data) return <NotFound />` (`resource/library/index.tsx:21,37`). A transient
network/500 → `data` undefined → the permanent "this doesn't exist" 404, so the user thinks
their library was deleted and has no Reload. → Read §1.1 (a failed load is not "not found";
distinguish deleted vs errored, offer retry).

**🟠 C — the upload dock auto-dismisses _failed_ uploads after 3s, with no retry.** The
auto-dismiss effect only guards `isUploading` and `'pending'`; the `'error'` state falls
through, so after 3s it hides the dock and `removeFiles` (`UploadDock/index.tsx:106-124`). A
failed upload therefore vanishes silently — no error kept, no Retry affordance anywhere. Auto-
dismiss should apply to **success only**; a failure must persist with retry. → Feedback §4.2
(failed state stays available + offers retry), Act §3.1 (async op ends in done/**error**, not
fire-and-forget).

**🟡 D — search results are capped at 50 with no pagination.** The search fetch hard-codes
`limit: 50, offset: 0` (`SearchResultsOverlay.tsx:52-57`) and renders a flat virtualized list
with no load-more; matches #51+ are unreachable. Server-side query is correct (not a
partial-page false-empty), but the surface silently truncates. → Read §1.2 (search over a large
set must page through all matches, not cap silently).

**🟡 E — inline rename draft is in-memory `useState`, lost if the row/popover closes
mid-edit.** Minor (per Edit §2.1 the bar is lighter for transient inline edits), but a rename
interrupted by a click-away discards the typed name with no restore
(`(home)/_layout/Body/LibraryList/Item/Editing.tsx`). → Edit §2.1.

**🟡 F — search overlay keeps its own `selectedFileIds` local state, separate from the main
explorer selection.** Selecting rows in search results doesn't carry into the normal view (and
vice versa) (`SearchResultsOverlay.tsx:34`). Consistency-of-selection gap; verify the intended
model on L2. → Act §3.1 (bulk parity), Read §1.6-ish (state continuity across views).

## 4 — Skill feedback

- **New /strengthened rules (回灌):**
  - **Feedback §4.2** — added a clause + ❌ example: _a transient / auto-dismissing status
    surface (upload dock, progress toast) must not auto-clear a **failed** item — auto-dismiss
    success only; keep the failure with a retry._ Resource `UploadDock` (gap C) is the ❌.
  - **Read §1.1** — added the **detail-fetch-failure-as-404** clause: a detail page that renders
    a fetch failure as "not found / 404" is the same error-masquerade as failure-as-empty
    (deleted vs failed-to-load); Resource `library/index.tsx` (gap B) is the ❌.
- **Landed as ❌ examples on existing rules (validated, no new rule):**
  - Read **§1.1** — Resource Explorer / sidebar KB list / search overlay / folder tree added to
    the failure-as-empty example (gap A).
  - Feedback **§4.2** — the four-fetch `error`-never-read pattern (gap A), sibling to the Eval
    `onSuccess`-only systemic root cause.
  - Read **§1.2** — search capped at 50 with no paging (gap D).
- **Validated existing rules:** §1.1 empty-vs-failed, §4.2 loading-can-fail, Act §3.1 done/error.

## 5 — Pending: L2 + L3

- **L2** — how the false-empty onboarding actually reads on a failed fetch vs a true empty; the
  masonry card grid at narrow width; the upload dock progress/error visuals; dark mode.
- **L3** — force each of the four fetches to fail to confirm gap A live (onboarding empty /
  blank / false "no results" / false "add folder"); open a library while its detail fetch fails
  to confirm gap B (false 404); force an upload to fail and watch the dock auto-dismiss it
  (gap C); search a library with >50 matches to confirm gap D truncation.
