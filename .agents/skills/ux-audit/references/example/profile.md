# Worked example — Agent Profile (助理档案) audit

A real run of this skill against the **agent profile / character editor**
(`/agent/:aid/profile` → `src/routes/(main)/agent/profile`), 2026-07 (LOBE-11215). Use it
as a **template for the output shape**, not as current-state truth (the code moves;
re-verify before citing). Surface = the nav header (breadcrumb + `AutoSaveHint` + status
tags + More menu) → the profile editor (avatar / name / background, model + tool config, or
the heterogeneous-agent config panels) → the system-prompt rich-text editor, plus the
always-mounted edit-lock driver and the right-side Agent Builder copilot.

**Layers run:** L1 (static / code) ✅ — everything below. L2 (visual) / L3 (dynamic + CLS)
⏳ not yet run — see §5. Verdicts about the render are L1 inferences here, pending L2.

**Surface class & benchmark:** this is a **custom-agent / character editor** (ChatGPT GPT
editor, Character.ai, Poe bot editor, Dify, Cursor rules). Class norms checked up front:
live preview / test-the-agent (✓ — the Agent Builder copilot + the sibling chat tab),
version history / fork (✓ — `AgentVersionReviewTag` / `AgentForkTag`), collaborative edit
safety (✓ — the edit lock), autosave with a visible save-state (⚠️ — present but can't show
failure, gap ②), and a config→inspect loop back to the agent's data (✓ — links to stats,
gap-free, §2). The class norms are largely met — the weakness is **failure handling**, not
missing capability.

## 1 — Patterns in use

| Pattern (family)               | Where                                                                         | Rating | Note                                               |
| ------------------------------ | ----------------------------------------------------------------------------- | ------ | -------------------------------------------------- |
| Visual Framework (layout)      | `NavHeader` + `WideScreenContainer` shell (`index.tsx:46,61`)                 | ✅     | consistent chrome                                  |
| Breadcrumbs / Deep-linking     | `AgentBreadcrumb`, `/agent/:aid/profile` restores the surface                 | ✅     |                                                    |
| Center Stage (layout)          | prompt editor dominates the canvas                                            | ✅     |                                                    |
| Form / Titled Sections (input) | avatar+name header, model/tool panel, prompt editor                           | ✅     |                                                    |
| Good / Smart Defaults (input)  | inbox → "Lobe AI" name + default avatar (`Content.tsx:77,82`)                 | ✅     |                                                    |
| Autosave (feedback)            | `AutoSaveHint` saving→saved, debounced writes (`store/action.ts:42`)          | ⚠️     | **no `failed` state** (gap ②)                      |
| Collaborative lock (feedback)  | `EditLockDriver` peeked before render; read-only for others                   | ✅     | **亮点** — see §2                                  |
| Streaming-aware editing        | saves suppressed mid-stream, flushed on end (`store/action.ts:76-112`)        | ✅     | **亮点** — see §2                                  |
| Overview + Detail (data)       | More → Advanced Settings **modal** (`AgentSettings`)                          | ✅     | preserves surface contract (modal, not navigate)   |
| Cross-surface entry (growth)   | More menu → `/agent/:id/stats`, breadcrumb → chat (`Header/index.tsx:200`)    | ✅     | **亮点** — config→inspect loop closed (§2)         |
| Rich-text editor + toolbar     | Lexical editor, mention / table / slash plugins (`EditorCanvas`)              | ✅     |                                                    |
| Loading Skeleton (feedback)    | brand `Loading` while config resolves (`index.tsx:42`)                        | ⚠️     | **success-only gate → permanent on error** (gap ①) |
| **Failure + Retry** (feedback) | store models it (`agentConfigErrorMap` + selectors + `retryFetchAgentConfig`) | — abs. | **built but wired to nothing** (gap ①)             |
| Empty / Not-found state        | —                                                                             | — abs. | invalid `:aid` → permanent loading (gap ①)         |

**Read:** layout, deep-linking, collaborative locking, streaming and the config→inspect
loop are mature — genuinely strong. The weakness clusters entirely in **Feedback (failure
states)**: an error path that exists in the store but reaches no pixel, and an autosave that
structurally cannot report failure.

## 2 — Strengths / good cases (don't regress)

This surface is well-built where it counts; these are the ✅ half of the 回灌 loop and the
"don't regress" baseline for the next refactor:

- **✅ 亮点 — Edit lock is peeked _before_ the editor renders.** `EditLockDriver` is mounted
  **outside** the config-loading gate (`index.tsx:68-70`, with a comment explaining why), so an
  agent another workspace member is already editing is read-only from the **first frame** rather
  than flashing editable then locking. `lockedByOther` / `lockPending` drive a real
  `EditingIndicator` and hide the Agent Builder (which would fight the lock). Load-bearing
  collaborative-safety — the model to copy for any shared-resource editor.
- **✅ 亮点 — Streaming-aware save gating.** While the Agent Builder streams a generated
  system-prompt into the editor, user-edit detection and debounced saves are **suppressed**, then
  a single save is flushed when the stream ends (`store/action.ts:76-112`, `EditorCanvas`
  `finishStreaming`). Generated content never clobbers a save race, and the user's own edits
  aren't misread as stream output. A subtle correctness win worth protecting.
- **✅ 亮点 — Config→inspect loop closed from the config context.** The More menu links straight
  to `/agent/:id/stats` (`Header/index.tsx:200-206`) and the breadcrumb returns to the agent's
  chat, so configuring the agent and _seeing what it did_ are one click apart — the ✅ contrast to
  settings-Memory's promise-with-no-door (Grow §5.3).
- **✅ (worth preserving, but currently inert) — The store already models error ≠ loading
  correctly.** `agentConfigErrorMap` + `currentAgentConfigError` / `isAgentConfigError` +
  `retryFetchAgentConfig` (`selectors.ts:235-238`, `action.ts:341-357`) are exactly the right
  data layer, with a doc comment promising "a retry UI instead of an endless skeleton." The
  intent is right; gap ① is that **no surface consumes any of it** — so this is a strength to
  _finish_, not one to admire. (Don't delete it in a cleanup pass — wire it.)

## 3 — Experience gaps (ranked)

**① Config-fetch error → permanent brand-loading; the error+retry machinery is built but
wired to nothing — ux §4.2 / Read §1.1** 🔴 `ProfileArea` branches only on
`isAgentConfigLoading` (`index.tsx:42`), whose selector is `!activeAgentId ||
!agentMap[activeAgentId]` (`selectors.ts:227-228`) — the **data-presence-disguised init flag**
§4.2 warns about ("loaded = is the data here yet"). On a failed or 404 `getAgentConfigById`,
`onData` never runs, `agentMap[id]` stays `undefined`, so `isAgentConfigLoading` stays `true`
**forever** → the full-page `<Loading/>` spins with no reason and no retry. A bad / deleted
`:aid` is therefore indistinguishable from a slow load (Read §1.1 error-vs-not-found). What
makes this sharp: `onError` **does** record `agentConfigErrorMap[id]` (`action.ts:341-352`),
and `currentAgentConfigError` / `isAgentConfigError` (`selectors.ts:235-238`) **and**
`retryFetchAgentConfig` (`action.ts:357`) all exist — but `rg` finds **zero** consumers
anywhere in the app. The retry UI the store was built for is dead code. _Remedy:_ branch
`isAgentConfigError` before the loading gate in `ProfileArea` → a failed state (reason +
Reload calling `retryFetchAgentConfig`); keep loading only for `!error && no-data`.

**② Autosave cannot represent failure — every save on the surface fails silently — ux §4.4
/ §4.2** 🔴 `AutoSaveHint`'s save-state enum is `'idle' | 'saving' | 'saved'`
(`AutoSaveHint.tsx:12`) — **no `failed` variant**, so the machine literally can't _show_ a
failed write (the exact type-level silent-write trap the page-editor and task-detail examples
already carry). Downstream, every writer swallows failure: the debounced prompt save and
`finishStreaming` both `catch → console.error` only (`store/action.ts:48-50, 103-105`); title
(`AgentHeader.tsx:49`), avatar / background (`:58, 96`), model / tool
(`ProfileEditor/index.tsx` `updateConfig`), and the Advanced-Settings modal's optimistic
config/meta writes (`AgentSettings/Content.tsx:59, 65`) surface nothing. A prompt edit that
failed to persist reads identical to one that saved — config-loss with a "saved" tag over it.
_Remedy:_ add `failed` to the enum + an inline Retry that keeps the edited value; drive it
from the writers' `catch`. One convention for the whole surface (bake it into `AutoSaveHint`).

**③ Avatar upload has no `catch` — a failed upload is silent — ux §4.2** 🟠
`handleAvatarUpload` wraps `uploadWithProgress` in `try { … } finally { setUploading(false) }`
with **no `catch`** (`AgentHeader.tsx:72-79`); only the client-side size-exceeded case is
toasted (`:66-68`). A rejected upload (network / server / oversized-after-encode) just flips
the spinner off — no `message.error`, and the rejection escapes as an unhandled promise.
_Remedy:_ `catch → message.error` with a retry hint; keep the previous avatar.

**④ Prompt / title drafts aren't backed to durable storage — up to 30s of edits lost on
reload — ux Edit §2.1** 🟡 The name lives in a `useState` `localTitle` (`AgentHeader.tsx:37`)
and the prompt is held in the editor until a debounced write (1 s, `maxWait` 30 s —
`store/action.ts:42-54`) reaches the server; there's **no localStorage draft** like the chat
composer's `useChatInputDraft`. A reload / crash inside the debounce window vaporizes the last
edits with no recovery. Milder than a compose box (it does autosave to the server), but the
30 s `maxWait` plus zero local backup is a real loss window on the surface where users write
long system prompts. _Remedy:_ mirror `useChatInputDraft` — back the editor draft to
localStorage keyed by agent id, flush on unmount, clear on confirmed save.

**⑤ Advanced-Settings modal `loading={false}` hardcoded — ux §4.2** 🟡
`AgentSettings/Content.tsx:93` passes `loading={false}` unconditionally, so if config / meta
were still resolving the modal would render as ready rather than skeleton. Low impact today
(the whole surface is gated on `isAgentConfigLoading`, so the store is usually populated before
the modal can open), but it's a latent success-only assumption. _Remedy:_ derive `loading`
from the real config-resolved state.

## 4 — Skill feedback

- **New sub-rule landed in `ux` (the generalizable one):** Feedback **§4.2 strengthened** — an
  error state and retry action that **exist in the store but are consumed by no surface** are
  still a _missing_ error state; a built-but-unwired failure path is indistinguishable from an
  absent one, and grepping the error selector's consumers is the check. ❌ example = gap ①
  (agent profile: `isAgentConfigError` + `retryFetchAgentConfig` built, `rg` → 0 call sites,
  permanent brand-loading on fetch failure). Mirrored into the Quick review. This was **not**
  stated before — the prior §4.2 text assumed the error path was simply forgotten, not
  half-built-and-orphaned.
- **Validated existing rules** (good ❌ examples to cite, not new): §4.4 (gap ②, the
  `idle|saving|saved`-no-`failed` enum — a third instance beside the page editor and task
  detail; added to the §4.4 ❌ list), §4.2 data-presence-disguised init flag (gap ①'s
  `!agentMap[id]` gate), §4.2 write-side no-`catch` (gap ③), Edit §2.1 (gap ④,
  autosave-to-server still owes a local draft).
- **Good cases noted, not landed as new ✅ rules:** the edit-lock-peeked-before-render and
  streaming-aware-save gating are strong but re-illustrate rules that are already complete
  (collaborative safety / save-race correctness) rather than revealing a missing distinction —
  recorded here as the "don't regress" list, not folded into the checklist.

## 5 — Pending: L2 visual + L3 dynamic

- **L2 (visual)** — confirm the prompt editor reads as the dominant Center Stage; check the
  `AutoSaveHint` tag legibility (saving vs saved vs "latest"); the locked-editor opacity 0.65
  read; narrow-width layout of the avatar+name row and the heterogeneous-config tabs; dark mode.
- **L3 (dynamic)** —
  - Force `getAgentConfigById` to fail / navigate to a bogus `:aid` to **confirm gap ① live**
    (permanent brand-loading, no retry) and to check nothing else (a route redirect / error
    boundary) rescues it first.
  - Force a save write to reject to **confirm gap ②** (the surface shows "saved" / no failure).
  - Drive an avatar upload failure to **confirm gap ③**.
  - Reload mid-edit within the debounce window to **confirm gap ④** (lost prompt edits).
