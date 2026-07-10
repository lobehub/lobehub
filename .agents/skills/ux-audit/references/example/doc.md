# Worked example — Agent Document View (助理文档视图) audit

A real run of this skill against the **standalone agent-document view**
(`/agent/:aid/docs/:docId` → `src/routes/(main)/agent/docs`), 2026-07 (LOBE-11214, under the
Chat UX Audit surface LOBE-11145). Use it as a **template for the output shape**, not as
current-state truth (the code moves; re-verify before citing). Surface = the nav header
(agent→doc breadcrumb + `AutoSaveHint` + Share + More menu) → the shared `PageEditor` canvas
(title / meta bar / lock banners / rich-text editor) → the right-panel documents/skills
explorer, plus an optional (lab-flagged) anchored `FloatingChatPanel`.

**Layers run:** L1 (static / code) ✅ — everything below. L2 (visual) / L3 (dynamic + CLS)
⏳ not yet run. Verdicts about the render are L1 inferences here, pending L2.

**Surface class & benchmark:** this is a **document editor embedded under an agent context**
(Notion page, Google Docs, Craft, Coda). Class norms checked up front: autosave with a visible
save-state (⚠️ — present but structurally can't show failure, gap ②), draft / crash recovery
(⚠️ — exists but scoped to the collaborative-lock-degraded window only, gap ⑥), collaborative
edit safety (✅ — `useDocumentLock` peek-on-open + read-only + CONFLICT handling, §2), version
history (✅ — `PageEditor/History`), full CRUD with confirm-on-delete + optimistic rollback (✅
— **standout**, §2), share / copy-link / export (✅), and a **failed-load state with retry**
(❌ — the biggest gap: the error UI is _built_ but ordering-dead, gap ①). The capabilities are
nearly all present — the weakness clusters entirely in **failure handling on load and save**.

## 1 — Patterns in use

| Pattern (family)                 | Where                                                                                            | Rating | Note                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------- |
| Visual Framework (layout)        | `NavHeader` + two-column `Layout` (editor + right panel) (`Layout/index.tsx:9`)                  | ✅     | consistent chrome                                                     |
| Breadcrumbs / Deep-linking       | agent→doc breadcrumb; `/agent/:aid/docs/:docId` restores the surface (`Header/index.tsx:46`)     | ✅     | agent label returns to chat                                           |
| Center Stage (layout)            | `PageEditor` rich-text canvas dominates (`PageEditor.tsx:273`)                                   | ✅     |                                                                       |
| Rich-text editor + toolbar       | Lexical editor, slash / ask-copilot / block plugins (`EditorCanvas`)                             | ✅     |                                                                       |
| Overview + Detail (data)         | right-panel Documents/Skills explorer beside the open doc (`RightPanel/index.tsx:122`)           | ✅     | auto-picks Skills tab when no plain docs                              |
| Full-lifecycle CRUD (act)        | create / folder / rename / move / delete, optimistic + rollback (`useDocumentTreeOps.ts`)        | ✅     | **亮点** — see §2                                                     |
| Confirm destructive (act)        | every delete site wraps `confirmModal` (`Header/useMenu.tsx:91`, `useDocumentTreeOps.ts:388`)    | ✅     | **亮点** — see §2                                                     |
| Collaborative lock (feedback)    | `useDocumentLock` peek-on-open, read-only for others, re-hydrate on flip (`useDocumentLock.ts`)  | ✅     | workspace pages only                                                  |
| Save-conflict handling (fb)      | CONFLICT save → read-only + keep `isDirty` so content is copyable (`editor/action.ts:353`)       | ✅     | **亮点** — the one failure they handle right (§2)                     |
| Managed-doc guard (input)        | skill `SKILL.md` index: `metaReadOnly` locks title/emoji to avoid bundle desync (`index.tsx:80`) | ✅     | **亮点** — see §2                                                     |
| Draft / crash recovery (edit)    | `usePageDraft` → sessionStorage snapshot + restore-on-open confirm (`usePageDraft.ts`)           | ⚠️     | **only while lock is degraded → no backup for personal docs** (gap ⑥) |
| Loading Skeleton (feedback)      | `EditorSkeleton` while content resolves (`DocumentIdMode.tsx:20`)                                | ⚠️     | **data-presence gate → permanent on error/not-found** (gap ①)         |
| Autosave (feedback)              | `AutoSaveHint` saving→saved, debounced writes (`editor/action.ts:310`)                           | ⚠️     | **no `failed` state → silent save failure** (gap ②)                   |
| **Failure + Retry on load** (fb) | `EditorError` alert exists (`DocumentIdMode.tsx:29`) but ordered behind the loading gate         | — abs. | **built but unreachable on first load; no retry** (gap ①)             |
| Empty / Not-found state (read)   | —                                                                                                | — abs. | deleted / bad `docId` → permanent skeleton (gap ①)                    |
| List data-states (read)          | right-panel explorer: loading / empty / error all rendered (`AgentDocumentsGroup.tsx:369`)       | ✅     | **亮点** — the list side does what the doc side doesn't (§2)          |
| Cross-surface entry (growth)     | breadcrumb → chat; explorer → other docs; copy-link; anchored chat topic (lab)                   | ✅     | doc↔chat loop closed                                                  |

**Read:** layout, CRUD, collaborative locking, managed-doc safety and the list-side data-states
are mature — genuinely strong. The weakness clusters entirely in **Feedback (load + save
failure)**: an error/not-found path that is _written but ordering-dead_, and an autosave that
structurally cannot report failure.

## 2 — Strengths / good cases (don't regress)

This surface is well-built where it counts; these are the ✅ half of the 回灌 loop and the
"don't regress" baseline for the next refactor:

- **✅ 亮点 — CRUD is optimistic with real rollback + failure toasts.** Create doc / create
  folder / rename / move / delete all apply an optimistic mutation, then **roll back to a
  snapshot and toast on failure** (`useDocumentTreeOps.ts` — create `:199,220`, folder
  `:152,161`, rename `:270,283`, move `:329,352`, delete `:430,459`). No silent rollback (the
  Act §3 trap). The model to copy for any tree/list CRUD.
- **✅ 亮点 — Every delete confirms.** The header More menu (`Header/useMenu.tsx:91-110`), the
  explorer tree (`useDocumentTreeOps.ts:388`), the web-list item and the skill row
  (`AgentDocumentsGroup.tsx:163,457`) each wrap `removeDocument` in `confirmModal` with a danger
  OK and an error toast. Consistent destructive-action discipline across four call sites.
- **✅ 亮点 — The one save-failure they DO model, they model well (lock CONFLICT).** On a
  collaborative CONFLICT the save path flips the editor read-only via `saveBlockedByLock` and
  **keeps `isDirty`** so the unsaved content stays on screen to copy out, rather than dropping
  the edit (`store/document/slices/editor/action.ts:353-364`), with a dedicated recovery path
  that clears the stale block (`clearSaveBlockedByLock`, `useDocumentLock.ts:152`). This is
  exactly the §4.4 "keep the edited value + name the reason" behavior — which makes gap ② sharper:
  the _generic_ network/500 failure gets none of this care (same `catch`, resets to `idle`).
- **✅ 亮点 — Managed-doc identity guard.** A skill's `SKILL.md` index is shown under the bundle
  title and its title/emoji are locked read-only (`metaReadOnly`, `AgentDocumentPage/index.tsx:80-92`),
  because a plain title save would overwrite the `SKILL.md` filename and desync the bundle. A
  thoughtful "don't let a generic editor corrupt a managed entity" guard.
- **✅ — Stale-response race guard on fetch.** `useFetchDocument`'s `onData` discards a response
  whose `documentId` is no longer the active one (`store/document/slices/document/action.ts:234-239`),
  so fast doc-switching can't hydrate the editor with a previous doc's content.
- **✅ — Draft restore is careful where it applies.** `usePageDraft` prompts once on open (not
  on every remount), enforces 24h staleness, and clears the snapshot when the lock recovers AND
  the doc is clean (`usePageDraft.ts:123-166`). Good hygiene — the limit is _scope_ (gap ⑥), not
  craft.
- **✅ — The right-panel explorer gets all four data-states right.** Loading
  (`NeuralNetworkLoading`), empty (`Empty` with icon + copy), and error (`Text type=danger`) are
  all rendered, and the documents tree keeps its toolbar reachable when empty
  (`AgentDocumentsGroup.tsx:369-383,532-537`; `DocumentExplorerTree.tsx` empty). This is the ✅
  contrast to the **doc body** on the same surface, which renders only loading + success (gap ①)
  → the audit's severity anchor: the gap is a local omission, not a surface-wide neglect.

## 3 — Experience gaps (ranked)

**① First-load fetch failure AND not-found both resolve to a permanent skeleton; the
`EditorError` alert is built but ordering-dead — ux §4.2 / Read §1.1** 🔴
`DocumentIdMode` renders `{error && <EditorError/>}` off the real SWR `error`
(`EditorCanvas/DocumentIdMode.tsx:223`) — but **after** `if (isLoading) return <EditorSkeleton/>`
(`:209`), where `isLoading = editorSelectors.isDocumentLoading(id) = !documents[id]`
(`store/document/slices/editor/selectors.ts:87`) — the **data-presence-disguised init flag** §4.2
warns about. `useFetchDocument` writes `documents[id]` only in its `onData`, and returns **`null`
(not a throw) on not-found**, dropped by an early return
(`store/document/slices/document/action.ts:219-222,228-260`). So on a first-load 500 the entry
never lands → `isLoading` stays `true` **forever** → the skeleton short-circuits and the
`EditorError` below it is **unreachable**; it can only paint on a later focus-revalidation failure
over already-loaded content. A **deleted / bad `docId`** hits the same wall → a **permanent
skeleton instead of a 404** (Read §1.1: failed / not-found / still-loading are conflated). No
retry exists on either path (SWR only auto-revalidates on focus, `action.ts:261`). Sharp because
the fix is nearly free — the error component already exists and already reads `error`. _Remedy:_
branch `error` and resolved-`null` **before** the loading gate → a failed state (reason + Reload
via `mutate`) and a real not-found; keep the skeleton only for `!error && no-data-yet`.

**② Autosave cannot represent failure — a failed content/title save reads as "saved" — ux §4.4
/ §4.2** 🟠 The document save-state enum is `'idle' | 'saving' | 'saved'` with **no `failed`**
(`store/document/slices/editor/initialState.ts:65`, mirrored in `AutoSaveHint.tsx:12`), and
`performSave`'s `catch` resets it to `'idle'` for every non-CONFLICT failure (network / 500),
logging only to console (`editor/action.ts:359-364`). So the `AutoSaveHint` in the header
(`Header/index.tsx:67`) shows "已保存最新 /saved" while the doc is still dirty and the write
failed — the type-level silent-write trap already documented for the page editor and agent
profile. `isDirty` stays true, so the debounced save _may_ retry on the next keystroke and the
`UnsavedChangesGuard` autosaves on navigation (`DocumentIdMode.tsx:110-127`) — a real backstop —
but a user who stops editing and stops navigating sits on lost-but-"saved" content indefinitely.
This is the **already-landed §4.4 rule** (it names `store/document/slices/editor/action.ts`
directly); this surface is a fresh confirmation, not a new gap. _Remedy:_ add `failed` to the
enum + an inline Retry that keeps the edited value; drive it from the `catch`.

**③ No retry affordance on any load error — even the reachable states are static — ux §4.2**
🟠 The `EditorError` alert (reachable only on revalidation failure, per gap ①) is a static
`<Alert type=error>` with no action (`DocumentIdMode.tsx:29-41`), and the explorer's error branch
is static `<Text type=danger>` (`AgentDocumentsGroup.tsx:377-383`). Both rely entirely on SWR
focus-revalidation; a user staring at either has no in-place way to re-run the fetch. _Remedy:_
give both a Reload button calling the SWR `mutate` (already available at both call sites).

**④ The header/title list fetch swallows its error — a failed list shows a placeholder title
silently — ux Read §1.1** 🟡 `useAgentDocumentItem` destructures only `{ data, mutate }` and
never reads `error` (`useAgentDocumentItem.ts:20`); a failed `listDocuments` leaves `item`
`undefined`, so the breadcrumb renders the placeholder title (`Header/index.tsx:61`) with no
signal that metadata failed to load. Milder than gap ① (the body fetch is the real content), but
it's the same failure-as-nothing coercion. _Remedy:_ surface a subtle failed-to-load affordance
on the title, or at least don't present a placeholder as if it were the real (empty) title.

**⑤ The anchored chat-topic failure silently hides the panel — ux §4.2** 🟡
`useDocumentChatTopic` returns `{ topicId, error, isLoading }` but callers gate render on
`topicId` truthiness only (`AgentDocumentPage/index.tsx:95`), and the hook logs errors to console
(`FloatingChatPanel/useDocumentChatTopic.ts:44-50`). If the topic lookup / create fails, the
FloatingChatPanel just doesn't appear — no error, no retry. Lower severity because the panel is
behind a lab flag (`enableAgentDocumentFloatingChatPanel`), but the silent-disappear pattern is
worth fixing before it graduates. _Remedy:_ on `error`, render a compact failed-to-load strip with
Retry instead of rendering nothing.

**⑥ Draft / crash recovery doesn't cover personal (non-workspace) agent docs — ux Edit §2.1**
🟡 `usePageDraft` only writes its sessionStorage snapshot while `lockHealth !== 'healthy'`
(`usePageDraft.ts:109-118`), and the lock is `enabled: workspacePage = documentId && canEdit &&
isWorkspacePage` (`useDocumentLock.ts:60,88`). For a personal / desktop-local agent doc the lock
never engages, so `lockHealth` stays at its `'healthy'` default (`PageEditor/store/initialState.ts:71`)
and **the snapshot never fires** — unsaved edits live in-memory only, protected solely by the
`beforeunload` autosave guard. A hard crash / kill / power-loss inside the autosave debounce
window (`EDITOR_DEBOUNCE_TIME` … `EDITOR_MAX_WAIT`) loses the last edits with no local recovery.
Narrower than a compose box (server autosave is the primary copy), but the draft safety net users
might assume is present is, for personal docs, absent. _Remedy:_ also snapshot on the normal dirty
path (not only during lock degradation), or document that the draft is lock-window-scoped.

## 4 — Skill feedback (回灌)

**New generalizable gap landed in `ux`:**

- **§4.2 — "error branch ordered _after_ a data-presence loading gate is unreachable on first
  load."** Existing §4.2 examples all cover the error path being _absent_ or _orphaned in the
  store_. This surface is a new, sharper shape: the error branch is **present in the same
  component and reads the real SWR `error`**, yet it sits below `if (isLoading) return <Skeleton/>`
  where `isLoading = !map[id]`, so a first-load failure (and a resolved-`null` not-found) can
  never reach it — it paints only on revalidation. Landed as a new paragraph + ❌ example (Agent
  document view) + checklist item in [feedback.md §4.2](../../ux/references/feedback.md), mirrored
  into the [Quick review](../../ux/SKILL.md) Feedback line. **→ landed as ux feedback §4.2 ❌.**

**Validated instances of existing rules (no new rule needed):**

- **§4.4 (autosave save-state has no `failed`)** — gap ②. The rule already names
  `store/document/slices/editor/action.ts`; this surface (same code, seen from the agent-doc
  header) is a fresh confirmation.
- **§4.2 (failed load offers Reload/Retry)** — gap ③. Static error alert + static list-error
  text, no retry — the already-documented "failed state must carry a Reload" line.
- **Read §1.1 (failure ≠ empty / not-found)** — gaps ①, ④. Not-found → permanent skeleton and a
  failed list-fetch → placeholder title are both the failure-as-nothing coercion §1.1 covers.

**Good cases worth preserving (see §2)** — the optimistic-CRUD-with-rollback, confirm-on-every-delete,
CONFLICT-save read-only handling, and managed-doc `metaReadOnly` guard are the "don't regress"
list for the next refactor. None extracted a _new_ ✅ rule this run (each re-illustrates an
already-complete rule — optimistic-rollback under Act §3, keep-the-value under §4.4), so per the
good-case 回灌 bar they're reported here but not force-landed as ✅ examples.
