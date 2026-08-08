# Worked example — HomeInbox「需要你处理」error brief card 审计

A real run of this skill against the Home Inbox error-brief card (`src/features/HomeInbox`),
2026-07, triggered by the raw string **"T-1 topic #1 (tpc\_5UBuAjUU4z6B) error" /
"Execution failed: Workspace budget exceeded"** shown to the user. Surface = one error-type
brief card in the "需要你处理" (needsYou) column: meta row (`StatusGlyph` + task ref + task
name + time) → agent avatar + headline + summary → action row (`忽略` / `重试`).

**Layers run:** L1 (static / code) ✅. L2 (visual) ✅ — the user's screenshot of the rendered
card is real render evidence. L3 (dynamic) ⏳ not run — reproducing needs a task forced to a
terminal error; see §5 for what it'd add.

**Surface class + norms** (actionable error notification in an inbox — cf. GitHub Actions
failed run, Vercel failed deploy, Sentry issue, Linear notification). A mature card of this
class: ① reads **as an error** at a glance (color/icon severity, not text alone); ② states
**what** failed in human terms, **which** entity, **when**; ③ states **why** (cause), mapped
to a known/actionable cause where possible; ④ offers **recovery** (Retry); ⑤ offers
**dismiss** (Ignore); ⑥ offers **inspect** (open the failing run / logs); ⑦ when the cause is
user-actionable (budget), a **direct path to the fix** (top-up / upgrade); ⑧ a
feedback/report channel. Audit gaps below are measured against this list, not only the code.

## 1 — Patterns in use

| Pattern (family)                      | Where                                                               | Rating | Note                                                                 |
| ------------------------------------- | ------------------------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| Card Stack / Titled Sections (layout) | `needsYou` list under "需要你处理" (`HomeInbox/index.tsx:193`)      | ✅     | grouped, errors sorted last (`splitBriefs.ts`)                       |
| Failure + Retry (feedback)            | error brief → `重试` (`BriefCardActions.tsx:238`)                   | ⚠️     | Retry present, but bare on a deterministic (budget) cause            |
| Button Groups (action)                | `忽略` / `重试` (`BriefCardActions.tsx:228-247`)                    | ✅     | dismiss + recover grouped                                            |
| Same-Page / Inline error (feedback)   | error rendered in-card, not a wipe                                  | ✅     | keeps the inbox intact                                               |
| Status glyph / severity (feedback)    | meta-row `StatusGlyph` (`StatusGlyph.tsx`)                          | ⚠️     | on error task = `paused`/`scheduled` → **hand/neutral, not failure** |
| Overview + Detail (data)              | "View run" → topic drawer (`BriefCardActions.tsx:66`)               | ⚠️→✅  | was dead (no `topicId` on brief); now wired (this run)               |
| Error-message copy (feedback §4.5)    | headline + summary (`InboxBriefCard.tsx`, `taskLifecycle/index.ts`) | ⚠️→✅  | was log-style w/ raw id; fixed this run                              |
| Remedy path for actionable cause      | budget-exceeded → top-up/upgrade                                    | —      | **absent** — no link to billing (gap ②)                              |

**Read:** the card's skeleton (group, dismiss/recover buttons, in-card render) is sound; the
weakness clusters entirely in **Feedback** — how the failure _reads_ (copy, severity glyph)
and whether the offered action can actually resolve the cause.

## 2 — Strengths / good cases (don't regress)

- **✅ 亮点 — Errors are a first-class, sorted bucket.** `splitBriefs.ts` routes `error` +
  `decision` to `needsYou` and sorts errors last, so a failure always surfaces in the "needs
  you" column rather than being lost in the news feed — the inbox never silently swallows a
  failed run.
- **✅ 亮点 — In-card recover + dismiss, no surface wipe.** `重试` / `忽略` resolve in place
  (`BriefCardActions.tsx`) and the rest of the inbox stays intact — a Same-Page-error done
  right; the failure hands control back without blowing the surface away.
- **✅ 亮点 — Error copy fixed to human-facing (→ landed as ux §4.5 ✅).** Post-fix the headline
  localizes at the card (`t('inbox.error.title')`), the cause shows as a clean clause, and the
  topic id moved to the structured `topicId` field that lights up "View run" — the ✅ example
  now cited beside the new Feedback §4.5.

> ⚠️ **Review catch — the localized headline must be scoped, not blanket.** The first
> implementation overrode the title for _every_ `type: 'error'` brief, but there are **5**
> error-brief producers, and 4 carry legitimately distinct titles: verify (`failed
verification` / `verification errored`, `verify/settle.ts`), heartbeat (`heartbeat timeout`,
> `watchdog.ts` / `task.ts`), and agent-signal (`brief.agentSignal.selfReview.error.title` —
> **already localized** server-side, `briefText.ts`). A blanket "运行失败" clobbered all of
> them. Fix: scope the override to the run-failure brief only (server stores the stable English
> `<id> run failed`; client localizes just that, falls back to the stored title otherwise).
> Lesson for the checklist: **before overriding a shared record type's user-facing field by
> `type`, enumerate every producer of that type** — a `type` is rarely single-source.

## 3 — Experience gaps (ranked)

**① Log-style copy with internal ids — ux §4.5 (Meaningful)** 🟠 **\[fixed this run]** Title
`` `${taskIdentifier} topic #${seq} (${topicId}) error` `` → "T-1 topic #1 (tpc\_5UBuAjUU4z6B)
error": raw topic id in the headline, `topic #N` log syntax, `T-1` duplicated from the meta
row; summary `` `Execution failed: ${raw}` `` carried the console-line prefix; both
English-only for every locale. Evidence L1 (`taskLifecycle/index.ts` error brief) + L2
(screenshot). **Remedy (done):** localize the framing at the card, store a clean English
fallback, move the id onto structured `topicId`.

**② A deterministic cause offers only a futile Retry — ux §4.2 (Meaningful・Certainty)** 🟠
"Workspace budget exceeded" is a **deterministic, user-actionable** cause — retrying the same
run just re-hits the same wall — yet the card offers only `重试` / `忽略`, no path to the fix
(top-up / upgrade / billing). Evidence L1 (`BriefCardActions.tsx:238` bare Retry;
`taskLifecycle` stores raw cause, no error-type → action mapping) + L2 (only 忽略 / 重试 render).
**Remedy:** map known terminal error types (`InsufficientBudgetForModel` →
`limitation.workspace.insufficientBudget.*`) to a **remedy action** (link to billing/top-up)
that leads the row; keep Retry as secondary only for transient causes. _(Done — the
completion event's structured `errorType` is threaded through both `onTopicComplete`
callers into the brief; billing causes get an `upgrade` link action + `metadata.error.code`,
and `BriefCardActions` was fixed so a link-type primary navigates. Verified via agent-testing
T-220: budget card renders 忽略 + 升级方案 → app.lobehub.com/settings/plans, no 重试.)_

**③ The card doesn't read AS an error — severity legibility (Certainty)** 🟠 The only status
cue is the meta-row `StatusGlyph`, driven by **task status** — but on error the task is set to
`paused` (ad-hoc, `taskLifecycle/index.ts:260`) or `scheduled` (automation manual run, `:269`),
and `task:paused` **deliberately renders as the "waiting for human" hand** (`StatusGlyph.tsx:15-19`).
So a _failed_ run shows the same neutral/pending glyph as a healthy pause — no red, no alert
icon (confirmed L2: the screenshot's 🤚 is that hand). The card leans entirely on copy to say
"error". **Remedy:** for `type === 'error'` briefs give the card an error accent (error-colored
alert glyph on the content, or drive the glyph to a failure visual) so severity is legible
pre-reading. _(Done — a red `CircleAlert` renders on the headline for `type: 'error'` briefs.
Verified via agent-testing T-220.)_

**④ "View run" was dead on error briefs — Overview+Detail (Meaningful)** 🟡 **\[fixed this run]**
`showViewRun = taskId && topicId` (`BriefCardActions.tsx:66`), but the error brief's `create()`
never passed `topicId` — so the one affordance to **inspect why it failed** never rendered; the
user could Retry or Ignore but not _look_. **Remedy (done):** pass `topicId` to the error brief
so "View run" appears. Verified via agent-testing T-220: both seeded briefs carrying a
`topicId` render a visible 查看运行轨迹 entry; the legacy brief without one does not.

**⑤ `忽略` is a permanent dismiss with no undo — Act (Certainty)** 🟡 `忽略` resolves the brief
(`handleResolve('ignore')`) with no confirm/undo; an error dismissed by accident is gone from
the inbox. Low severity (the run is still in the task list), noted not landed.

## 4 — Skill feedback

- **Landed as new `ux` items (回灌):**
  - **Feedback §4.5 — "Error copy is written for a human, not a log line"** (new subsection +
    4 checklist items + Quick-review mirror), citing the inbox error brief as the ❌ example and
    the fix as ✅. Covers: no internal id / no log framing / no meta-row duplication / localized.
  - **Feedback §4.2 — deterministic-cause extension** (new checklist item): a failure whose fix
    lives elsewhere (budget/quota/permission) leads with the **remedy action**, not a bare Retry.
    Mirrored into Quick review.
- **Validated existing rules:** §4.2 "failed state names the failure + offers Retry" (the card
  has Retry) and the Retry-gating principle (extended by gap ②).
- **Good case landed as ✅:** the fixed human-facing copy → §4.5 ✅ example.
- **Concrete fixes shipped this run:** gap ① (copy) + gap ④ (View-run wiring), with a
  server-side regression test (`onTopicComplete.test.ts` — brief title/summary carry no
  internal id / log framing, `topicId` on the structured field).
- **Follow-ups (not landed):** gap ② (remedy-action mapping), gap ③ (error severity glyph) —
  worth a Linear sub-issue under a "HomeInbox UX" parent.

## 5 — Pending: L3 dynamic

- Force a task to a terminal **budget-exceeded** error and confirm live: (a) "View run" now
  renders (gap ④ fix), (b) the card still reads as pending not failed (gap ③), (c) `重试`
  re-runs and re-fails immediately (gap ② — proves the futile-Retry claim behaviorally).
- Confirm the localized headline renders for a zh-CN session and legacy rows (with the old
  `Execution failed:` prefix) get the defensive strip.
