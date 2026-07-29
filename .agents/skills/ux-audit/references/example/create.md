# Worked example — Create surfaces (视频创作 / 图像创作) audit

A real run of this skill against the two desktop **generation** surfaces —
`src/routes/(main)/(create)/video` and `.../image` — 2026-07 (LOBE-11151, under the
desktop-main-area audit LOBE-11098). Use it as a **template for the output shape**, not as
current-state truth (the code moves; re-verify before citing).

The two surfaces are **near-identical**: both compose the shared shell
`src/routes/(main)/(create)/features/` (`CreateGenerationPage` → `GenerationWorkspace` →
`Content` / `EmptyState`, `GenerationLayout` sidebar) over a per-medium store
(`src/store/{video,image}`) with the same four slices (`generationConfig` /
`generationTopic` / `generationBatch` / `create{Video,Image}`). So most findings are
**shared code → both surfaces at once**, and several live in the shell, meaning any future
generation surface inherits them.

Surface = left topic sidebar → center workspace (skeleton → empty(composer) → feed of
generation batches) → PromptInput composer (prompt + inline reference upload + ConfigPanel
popover).

**Layers run:** L1 (static / code) ✅ — everything below. L2 (visual) / L3 (dynamic +
CLS + navigate-away behavior) ⏳ not yet run — see §5.

**Surface-class benchmark (named first, per SKILL.md ground rule).** Generation surfaces
(Midjourney / DALL·E / Ideogram / Leonardo / Runway / Kling / Sora) carry class norms a
code-only read is blind to: prompt history/reuse ✅ (the durable batch feed + Reuse
Settings / Copy Prompt), batch + variations ⚠️ (Reuse-Settings-then-regenerate, no
"vary"), seed reproducibility ✅ (Copy/Apply Seed), persistent gallery ✅ (server-side
batches), reference/frame upload ✅ (ImageUpload / FrameUpload), capability gate ✅
(`image/NotSupportClient.tsx`), **cancel a running job ❌** (gap ②), **result→input reuse
❌** (gap ⑤), **async-completion signal for long video jobs** ⏳ (pending L3), cost/quota
before generate ⏳ (not surfaced; out of L1 scope).

## 1 — Patterns in use

| Pattern (family)              | Where                                                                | Rating | Note                                                        |
| ----------------------------- | -------------------------------------------------------------------- | ------ | ----------------------------------------------------------- |
| Global Navigation (nav)       | `GenerationLayout/Sidebar` topic list                                | ✅     | persistent, per-medium                                      |
| Center Stage (layout)         | composer centered on empty; feed + bottom composer when populated    | ✅     | textbook creation-tool shape                                |
| Card Stack / Grid (data)      | `GenerationFeed` batch items; image N-up grid                        | ✅     |                                                             |
| Overview + Detail (data)      | batch → per-generation success/loading/error item                    | ✅     |                                                             |
| Skeleton loading (feedback)   | `SkeletonList` while `!isCurrentGenerationTopicLoaded`               | ⚠️     | **success-only gate → permanent on error** (gap ①)          |
| Progress Indicator (feedback) | `VideoLoadingItem` circular %, `ElapsedTime` (sessionStorage-backed) | ✅     | elapsed survives remount                                    |
| **Cancelability** (action)    | —                                                                    | —      | **absent-but-expected**: no stop/abort, only delete (gap ②) |
| Failure + Retry (feedback)    | `VideoErrorItem` / `ErrorState` render reason + Copy Error           | ⚠️     | **no in-place Retry** — only delete + re-create (gap ②/③)   |
| Good / Smart Defaults (input) | model/provider restored from `globalStore.status`; seed randomizer   | ✅     | last model persists (config does not — gap ⑥)               |
| Button Groups (action)        | hover row: Reuse Settings / Copy Prompt / Delete                     | ✅     |                                                             |
| Prominent "Done" (action)     | Generate button                                                      | ✅     | one primary (pending L2)                                    |
| Capability gate (feedback)    | `image/NotSupportClient.tsx` (CLI / self-hosted upsell)              | ✅     | class-norm gate present                                     |
| Empty-state as onboarding     | `EmptyState` = centered composer, **no examples/showcase**           | ⚠️     | bare first-run (gap ④)                                      |

**Read:** navigation, feed, progress and defaults are solid. Weakness clusters in
**Feedback (failure paths)** — the same family this codebase is repeatedly weak in — and in
two absent generation-class affordances (cancel, result→input).

## 2 — Strengths / good cases (don't regress)

The surface is strong where it counts — these are the ✅ half of the 回灌 loop and the "don't
regress" list for the next refactor. Most live in the **shared shell**
(`src/routes/(main)/(create)/features/`), so any future generation surface inherits them; two of
them (marked `→ landed as ux … ✅`) taught the checklists a latent sub-rule this run — see §4:

- **✅ 亮点 — Durable batch feed as persistent gallery.** Submitted batches are server-side and
  survive reload, so `GenerationFeed` is a real gallery, not an in-session scratchpad — this is
  what carries the class-norm "prompt history / persistent gallery" affordance a code-only read
  usually finds absent. Load-bearing because the whole result→reuse story (Copy Prompt / Reuse
  Settings / seed) depends on results still being there after a refresh.
- **✅ 亮点 — Generation-class reproducibility on every row.** The hover row exposes Copy / Apply
  Seed + Reuse Settings + Copy Prompt (Button Groups pattern), so any past generation can be
  reproduced or nudged. Seed reproducibility + settings reuse are generation-class norms (Copy /
  Apply Seed), and they're present on **every** batch row rather than buried in a detail view.
- **✅ 亮点 — Reference /frame upload accepted inline.** `ImageUpload` / `FrameUpload` let the
  composer take reference images and video frames inline — the reference-upload class norm is met.
  Load-bearing precisely because gap ⑤ is about the _missing_ bridge back: the accept side is
  already built, so result→input reuse is a wiring gap, not a from-scratch feature.
- **✅ 亮点 — Capability gate present. → landed as ux Feedback §4.3 ✅** `image/NotSupportClient.tsx`
  renders a full-surface CLI / self-hosted explainer **with the remedy** (self-host-DB + hosted-app
  links) instead of a broken composer when the client build lacks the generation backend. This
  sharpened §4.3: its "soft inline warning, never a hard block" rule silently assumed a
  **user-fixable-here (model/config)** gap; this is a **platform/deployment** gap the user _can't_
  flip on-screen, so a full-surface gate carrying the remedy is correct — a distinction §4.3 didn't
  draw before.
- **✅ 亮点 — Elapsed time survives remount. → landed as ux Feedback §4.1 ✅** `ElapsedTime` reads
  `generation_start_time_{generationId}` from sessionStorage on mount and `removeItem`s it when the
  job leaves active (`image/…/GenerationItem/ElapsedTime.tsx:33-49`), so the per-job clock recovers
  true duration across a remount rather than resetting to zero. This extracted a latent §4.1 rule
  the skeleton-focused prose didn't state: a long-op elapsed / progress readout must derive from a
  **persisted start-timestamp keyed by job id** (survives remount) and clear it on completion, never
  a local counter that restarts at 0.

## 3 — Experience gaps (ranked)

**① Failed batch-list fetch → permanent skeleton — ux Feedback §4.2 + Read §1.1** 🔴
`useFetchGenerationBatches` registers **`onSuccess` only, no `onError`**
(`store/video/slices/generationBatch/action.ts:242-266`, `store/image/…/action.ts:165-191`)
and writes `generationBatchesMap[topicId]` only on success. The "loaded" gate is
`isCurrentGenerationTopicLoaded = Array.isArray(map[topicId])` (`…/selectors.ts:23-27`) — a
success-only init flag wearing an `Array.isArray` disguise. The **shared** shell renders
`!loaded → <SkeletonList/>`, `!hasGenerations → <EmptyState/>`, else feed
(`features/GenerationWorkspace/Content.tsx:39-45`) with **no error branch**. So a failed /
timed-out batch fetch never flips the flag → **permanent skeleton, no retry**, on **both
surfaces and any future one built on the shell**. (Sidebar `useFetchGenerationTopics` is the
same success-only shape — same risk on the topic list.)

**② No cancel for an in-progress generation — ux Act §3.1 + Cancelability pattern** 🟠 No
cancel / abort / stop action exists in either store (grep across `store/{video,image}` is
empty); the only way to stop a running job is **delete the batch**
(`BatchItem` delete → `console.error`-only, gap ③). Video jobs run minutes and cost tokens;
Cancelability is a generation-class norm (Runway / Kling / Sora all cancel a queued/running
job) and Act §3.1's async machine expects a **locked in-progress state that can be
cancelled**, not deleted after the fact. Also there is **no in-place Retry** on the error
item — recovery is "Reuse Settings → Generate again" by hand.

**③ Download & delete failures are silent, while sibling copy actions toast — ux Act §3.1** 🟠
Within the same file, `handleCopyPrompt` / `handleCopyError` / `handleCopySeed` surface
failure with `message.error(...)`, but `handleDelete` / `handleDeleteBatch` / `handleDownload`
only `console.error` (`video/…/GenerationFeed/BatchItem.tsx:81,113,129`;
`image/…/GenerationItem/index.tsx:47`), and image's `handleDownloadImage` has **no try/catch
at all** (`image/…/GenerationItem/index.tsx:~62`). A failed download (large video, flaky
net) gives the user zero feedback — a dead button. Inconsistent error feedback inside one
surface is itself the smell.

**④ Bare first-run empty state — ux Read §1.1** 🟡 `EmptyState` renders only the centered
`PromptInput` (`features/GenerationWorkspace/EmptyState.tsx:18-22`) — no example prompts,
model showcase, or "what you can make here". Generation tools teach first-run with a sample
gallery (Midjourney explore, DALL·E / Ideogram samples). The composer _is_ a defensible
empty state, so this is mild — **pending L2** for how bare it actually reads.

**⑤ A generated result can't be reused as input — ux Act §3.1 (forward momentum) / Grow** 🟡
Success items offer download / delete / copy-seed / reuse-settings, but no "use this
image/video as reference / edit / vary" — the artifact is terminal (`SuccessState` /
`VideoSuccessItem`). Both surfaces _accept_ reference uploads yet offer no one-click bridge
from a result back into the composer (img2img continuation, "vary", video frame reuse — all
generation-class norms). The forward path dead-ends at download.

**⑥ Draft (prompt + config) is in-memory only — ux Edit §2.1** 🟡 Neither store uses
`persist` (grep empty); prompt text and every config param (model / aspect / dimensions /
seed / steps) live in memory and vanish on reload/crash. _Nuance that lowers severity:_
submitted generations persist server-side (the feed is durable) and the prompt is
intentionally cleared post-submit, so the loss window is only the **unsubmitted** draft —
but a long crafted prompt + a tuned ConfigPanel wiped by an accidental refresh is real
effort lost. Second validated instance of §2.1 (after the home composer).

**⑦ A failed status poll is invisible — ux Read §1.7** 🟡 `useCheckGenerationStatus`
`onError` → `console.error` + doubled backoff (`…/generationBatch/action.ts:164-167,231-233`);
the item keeps showing the loading spinner with no "checking failed / still retrying" hint,
so a persistently failing poll is indistinguishable from a slow generation. Self-heals on
retry, hence minor — but "failed refresh ≠ still in progress" is the §1.7 rule.

## 4 — Skill feedback (回灌)

- **Validated existing rules** (good ❌ examples now cited in `ux`): Feedback **§4.2** (gap ①
  — permanent skeleton, and the new `Array.isArray(map[id])`-as-init-flag shape), Act **§3.1**
  (gap ③ — action-failure must surface, and the sibling-actions-toast-but-these-don't
  inconsistency), Edit **§2.1** (gap ⑥, second instance).
- **Landed as a new/strengthened `ux` item (from a gap ❌):** Act **§3.1** — a **long-running /
  costly async op (generation, export, upload) needs a Cancel affordance**, not
  delete-after-the-fact (gap ②); mirrored into the Quick review. This is the generalizable one —
  it recurs on any surface with a minutes-long, billable background job.
- **Landed from a good case ✅ (the other half of 回灌 — each sharpened a rule, not just decorated
  it):**
  - Feedback **§4.1** — extracted a latent sub-rule from `ElapsedTime`: a long-op elapsed /
    progress readout must derive from a **persisted start-timestamp keyed by job id** (survives
    remount) and clear it on completion, never a local counter that restarts at 0. The old §4.1
    prose was skeleton/CLS-only and never stated this.
  - Feedback **§4.3** — `NotSupportClient` split the capability-gate rule in two: the existing
    "soft inline warning, never a hard block" assumed a **user-fixable-here (model/config)** gap;
    a **platform/deployment** gap the user can't flip on-screen instead wants a **full-surface
    gate carrying the remedy**. §4.3 didn't draw this distinction before.
- **Noted, not yet landed** (promote if a second surface repeats): result→input reuse for
  generation surfaces (gap ⑤); example-gallery first-run for creation tools (gap ④).

## 5 — Pending: L2 visual + L3 dynamic

- **L2 (visual)** — does the Generate button read as the single dominant control on the
  composer (gap: pending-L2 verdict); how bare the empty state actually looks (gap ④); feed
  card CLS on the loading→success image/video swap; N-up image grid at narrow width; the
  circular-progress loading item vs loaded video (height match).
- **L3 (dynamic)** —
  - Force the batch fetch offline to **confirm gap ① live** (permanent skeleton, no retry) —
    the highest-value confirmation.
  - Start a long video generation, **navigate away, and check for any completion signal** on
    return (polling is per-mounted-item; there may be no async-done notification — a
    generation-class expectation for minute-long jobs).
  - Drive delete/download offline to **confirm gap ③** (silent failure).
  - **Measure create-workspace CLS** across skeleton→feed and loading-item→result swaps.
