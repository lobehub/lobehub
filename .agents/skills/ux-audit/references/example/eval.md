# Worked example — Eval (评测) module audit

A real run of this skill against the **Eval module**, 2026-07 — a benchmark / evaluation
platform: benchmark list (overview) → benchmark detail (datasets + runs tabs) → run detail
(long-running execution) → single test-case detail; plus dataset detail. Five surfaces under
`src/routes/(main)/eval/**` (feature-in-route layout), backed by
`src/store/eval/slices/{benchmark,dataset,run,testCase}`. Use it as a template for the output
shape, not current-state truth (re-verify before citing).

**Surface class:** eval / experiment platform — benchmark against OpenAI Evals UI / LangSmith
/ Braintrust.
**Layers run:** L1 (static / code) ✅. L2 / L3 ⏳ not run.

**Headline:** the **write side is mature** (run-execution state machine, delete lifecycle,
dataset-import wizard), but the **read side has no error handling at all** — one root cause
(every fetch resolves only on success) hangs all five surfaces on failure.

## 1 — Patterns in use

| Pattern (family)                       | Where                                                              | Rating | Note                                    |
| -------------------------------------- | ------------------------------------------------------------------ | ------ | --------------------------------------- |
| Overview + Detail (nav)                | overview → bench → run → case; dataset detail                      | ✅     | clean multi-level drill                 |
| Empty-as-onboarding (growth)           | overview empty (`eval/index.tsx:83-95`), Datasets/Runs tab empties | ✅     | real pages + CTA                        |
| Loading Skeleton (feedback)            | overview `SkeletonGrid` reuses card chrome                         | ✅     | textbook §4.1                           |
| **Failure + Retry (feedback)**         | every fetch                                                        | — abs. | systemic root cause (gap A)             |
| **Loading state on detail (feedback)** | run / case / dataset detail                                        | — abs. | `return null` → blank (gap B)           |
| Run state machine (act/feedback)       | idle / pending / external / running / finished                     | ✅     | mature — highlight                      |
| Progress + Live poll (data)            | run detail 3s poll while active + progress bar                     | ✅     | §1.7                                    |
| Entity lifecycle — delete (act)        | benchmark / dataset / testCase / run delete                        | ✅     | confirm + success/error toast           |
| Entity lifecycle — create/edit (act)   | RunCreate / RunEdit / BenchmarkEdit / BatchResume modals           | ⚠️     | several lack error toast (gap F)        |
| Wizard (input)                         | DatasetImportModal (Upload → Mapping)                              | ✅     | progress, validation, toast — highlight |
| Draft safety (edit)                    | all form modals                                                    | ⚠️     | in-memory only, no unsaved warn (gap H) |

**Read:** run-execution + delete + import are solid. The weakness clusters entirely in the
**read side** — list/detail `error` + `loading` — plus an inconsistent band of create/edit
mutations that surface success/failure unevenly.

## 2 — Strengths / good cases (don't regress)

The write side is mature where it counts — these are the ✅ half of the 回灌 loop and the "don't
regress" list for the next refactor. They're the validated ✅ baseline against which §3's read-side
❌ gaps are measured — keep them, don't "fix":

- **✅ 亮点 — Run-execution state machine.** idle / pending / external / running / finished with a
  3 s poll while active + progress bar, plus retry-errors / batch-resume / per-case resume — each
  path confirm + loading + toast. Mature enough to be the module's flagship ✅ (act/feedback,
  §1.7).
- **✅ 亮点 — Full delete lifecycle.** benchmark / dataset / testCase / run delete all pair a
  confirm with a success/error toast — the consistent baseline the uneven create/edit writes
  (gap F) fail to match.
- **✅ 亮点 — DatasetImport two-step wizard.** `DatasetImportModal` (Upload → Mapping) runs upload
  progress, a parse-error toast, mapping validation gating the button, and an import lock with a
  success/error toast — textbook staged input.
- **✅ 亮点 — Overview empty-with-CTA + chrome-reusing skeleton.** the overview empty state is a
  real page + "create your first benchmark" CTA (`eval/index.tsx:83-95`), and its `SkeletonGrid`
  reuses the card chrome for an in-place load→content swap with no relayout (textbook §4.1).
- **No antd `Spin` anywhere.** loading is always a chrome-matched skeleton rather than a bare
  spinner — a quiet correctness win worth keeping.

## 3 — Experience gaps (ranked)

**🔴 A — No error/retry anywhere; every fetch resolves only on success → permanent skeleton /
blank / false-empty.** Systemic: each slice inits `isLoadingX: true` / `xInit: false` and
flips them **only in `onSuccess`, with no `onError`** across all 9 fetches
(`benchmark/action.ts:106-130`, `dataset/action.ts:35-67`, `run/action.ts:151-209`,
`testCase/action.ts:42-72`). Consumers hang differently:

- **overview false-empty** — reads SWR `isLoading`; failure → empty list → "create your first
  benchmark" onboarding (`eval/index.tsx:81-95`).
- **sidebar permanent skeleton** — gated on `benchmarkListInit` (success-only)
  (`_layout/Sidebar/Body/BenchmarkList.tsx`, `benchmark/initialState.ts:17`).
- **bench detail permanent skeleton** — `if (!benchmark) return <Skeleton>`
  (`bench/[benchmarkId]/index.tsx:114`).
- **run / case / dataset detail permanent blank** — `if (!record) return null`
  (`runs/[runId]/index.tsx:85`, `cases/[caseId]/index.tsx:79`, `datasets/[datasetId]/index.tsx:202`).
  → Feedback §4.2 + Read §1.1 (error before empty). The module's flagship ❌ example.

**🟠 B — run / case / dataset detail have no loading state (`return null` → blank flash).**
Even on the happy path the first frame is blank, not a skeleton (`runs/[runId]/index.tsx:85`,
`cases/[caseId]/index.tsx:79`, `datasets/[datasetId]/index.tsx:202`). → Read §1.1 ("loading is
a skeleton, never a blank flash"). Distinct from A: A = no error, B = no loading.

**🟠 C — case detail deep-linked to a non-existent case → permanent blank, no not-found.**
`caseResult` comes from `results.find(testCaseId === caseId)`; a miss stays `null` → blank, no
"case not found" (`cases/[caseId]/index.tsx:41-46,79`).

**🟠 F — several async writes lack an error toast, inconsistent with the delete paths.**
Delete (benchmark/dataset/testCase/run) all confirm + success/error toast; but RunCreateModal,
RunEditModal, BatchResumeModal, and BenchmarkEditModal surface nothing on failure (rely on
silent store handling); BenchmarkEdit also shows no loading button state. Same "submit" intent,
uneven feedback. → Act §3.1 (done/error), Feedback §4.4.

**🟡 D — i18n: hardcoded English strings.** `'Failed to start run'` fallback ×3
(`RunsTab/RunCard.tsx:220`, `runs/[runId]/features/RunHeader/index.tsx:231`,
`runs/[runId]/features/IdleState/index.tsx:122`); `'Awaiting for external evaluation'`
(`CaseResultsTable/index.tsx:211`, also should read "Awaiting external evaluation"); two
DatasetEditModal placeholders (`features/DatasetEditModal/Content.tsx:204,207`).

**🟡 E — same data, two loading sources.** The benchmark list loads via SWR `isLoading` in the
overview but via store `benchmarkListInit` in the sidebar → failure diverges (false-empty vs
permanent skeleton). Consolidate to one loading/error/empty source.

**🟡 G — async actions signal success only via polling, no explicit forward feedback.** start
run / resume case / batch resume give no success toast; the user waits on the 3s poll to see
the status change (`runs/[runId]/index.tsx`). → Act §3.1.

**🟡 H — form modals keep in-memory drafts only; no unsaved-changes warning on close.** All
create/edit/import modals lose their input on accidental close (`features/**Modal/Content.tsx`).
→ Edit §2.1 (lighter for modals).

## 4 — Skill feedback

- **Landed as ❌ examples on existing rules** (no new rules — Eval is a textbook instance):
  - Feedback **§4.2** — the whole-module `onSuccess`-only / no-`onError` pattern (gap A).
  - Read **§1.1** — Eval overview added to the error-before-empty example (gap A); a new ❌
    that a detail `return null` is not a loading state (gap B), plus a checklist clause.
- **Validated existing rules:** §4.2 permanent-skeleton, Read §1.1 empty-vs-failed, Act §3.1
  done/error feedback (gaps F/G).

## 5 — Pending: L2 + L3

- **L2** — how the permanent skeleton / blank actually look; the run-detail report layout;
  narrow-width of the benchmark card grid.
- **L3** — force each fetch to fail to confirm gaps A/B/C live (permanent skeleton / blank);
  run a real eval to watch running→finished, progress, and a mid-run poll failure (gap: silent,
  keeps polling); force a create/resume failure to confirm gap F (no toast).
