---
name: acceptance
version: 0.4.3
description: >
  End-to-end verification and self-evidence for a delivery in any repository,
  with or without a preconfigured verify plan. Discover an existing plan when
  one was handed to this run; otherwise author checks and publish a standalone
  acceptance. Pick the proving surface (CLI / web / desktop / iOS Simulator),
  drive the real product, capture visually confirmed evidence, and publish a
  round with the lh CLI. Triggers on 'verify the task', 'collect evidence',
  'prove it works', 'upload evidence', 'verify plan', 'requiredEvidence',
  'local test', 'manual test', 'test report', 'test with cli', 'test in
  electron', 'test desktop', or any local end-to-end verification task. Needs no
  ambient ids, and never depends on running inside a LobeHub conversation.
---

# Acceptance (Builder Self-Evidence)

You are the **builder** for a delivery. A separate review step judges it against
a **plan** — checks you author, or a verify plan handed to this run. A check that
declares `requiredEvidence` **cannot pass on your text alone**: a missing artifact
marks it `uncertain` and holds the delivery.

```
author (or discover) the plan  →  pick the surface  →  capture evidence  →  publish the round  →  self-check coverage
```

## Decide whether to execute before starting a round

Creating or updating a PR, marking it ready, or being asked to upload a report
must not by itself start another verification run. First inspect the requested
scope and the task's existing reports, evidence, and published acceptance links
(from the conversation, PR, or local `.acceptances/` directory).

| Delivery state                                                                                                                       | Action                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documentation/instruction-only change, or pure refactor/tooling change with no product behavior change                               | Skip product acceptance and briefly state why. Keep any applicable quality checks.                                                                                                                                                                                                                          |
| Gitlink-only sync                                                                                                                    | Do not launch a fresh acceptance. Link the upstream change and its existing acceptance when available; disclose missing upstream evidence without claiming it passed. Cloud changes accompanying the sync are assessed separately.                                                                          |
| Completed acceptance already published and still covers the delivery                                                                 | Reuse its URL and coverage. Do not create a round or rerun cases just for the PR.                                                                                                                                                                                                                           |
| Completed acceptance report and evidence exist locally and still cover the delivery                                                  | Inspect coverage and artifacts, then upload that report using [report.md](references/report.md). Preserve the original execution provenance; no product rerun, new plan, or repeated completed checker review is needed merely for upload.                                                                  |
| The delivery was already exercised on the real product earlier in this session (observations and raw artifacts exist, no report yet) | Do not rerun, re-plan, or open a checker stage. Write `plan[]` and `cases[]` from the observations already made, attach the original artifacts (logs, command output, captures) with their original provenance, disclose any required medium that was never captured instead of recapturing it, and ingest. |
| Product behavior lacks valid evidence, or relevant behavior changed after verification                                               | Execute only the missing or affected outcomes, retain unaffected evidence with its original provenance, and publish according to the round rules below.                                                                                                                                                     |

Evidence is reusable when its criteria cover the requested behavior, its artifacts
are available and support the observations, and subsequent code, dependency,
configuration, or environment changes do not invalidate those observations.
Compare the relevant changes; a different commit SHA, rebase, PR event, or report
publication status alone is not a reason to rerun. Failed/blocked checks and missing
required evidence are not passes: repair or supplement those specific gaps.
An explicit user request for fresh verification still takes precedence.

The execution, environment setup, plan/checker, and capture sections below apply
when executing acceptance. For reuse or upload only, inspect the existing report
and evidence and complete the necessary publication/coverage steps; do not boot
services or replay completed cases. Uploading does not change when or against
which implementation the evidence was captured.

## Independent acceptance review (first round only)

The primary checks the environment, writes the plan, executes cases, inspects
evidence, repairs failures, and publishes. Use one `acceptance-checker` agent at two points
in the first acceptance round: give at most two feedback responses on the plan and cases
before execution, then perform exactly one quick report/evidence check against
the agreed criteria before publishing. A second plan check is optional, only
to check the primary's revisions; there is no third plan-feedback response.
Count the two stages separately. After
either stage's limit, the primary owns remaining corrections and verification.
The acceptance-checker **is** the plan gate — never ask the user to approve a
plan; ask the user only for a user-owned prerequisite or a product decision
that changes the plan. In both stages, the primary supplies an explicit file
list and the relevant diff text or prepared diff artifact paths. The acceptance-checker
limits code reading to these materials; it must not run `git diff` or discover
its own scope. This does not restrict inspection of the plan, report, or evidence.
During evidence review, use it only to identify the updates and the agreed
cases whose evidence needs checking; the core task is checking the report
against the plan and artifacts. Do not reopen requirements, expand into code
review, or investigate implementation details. Return contradictions to the
primary for explanation or repair. Follow-up rounds have no acceptance-checker: the primary
re-runs, inspects, and publishes itself. Do not delegate execution or require
per-case approval.

Read [acceptance-checker.md](references/acceptance-checker.md) for the input/output
contract, review boundaries, and follow-up rules. Acceptance review supplements the
primary's own checks and any configured verifier; it does not replace either.
If delegation or required media inspection is unavailable, disclose the missing
review and unverified claims rather than claiming independent acceptance.

## Read the project layer first

Before touching an environment, check for `.agents/acceptance/`:

| File                     | What it owns                                                 |
| ------------------------ | ------------------------------------------------------------ |
| `PROJECT.md`             | Start/stop commands, ports, services, auth, surfaces, probes |
| `PROCESS.md`             | The run process: plan gate, execution rules, teardown        |
| `common-mistakes.md`     | Project living log — what earlier rounds got wrong here      |
| `probe-mock-patterns.md` | Project living log — how to force state on this product      |

The project layer owns _how this repository is run_; this skill owns _what a
valid round is_ (plan, evidence, report, immutable round, the hard rule). On
running, the project layer wins; on what may be published, this skill wins. Never
invent a start command, port, or auth flow `PROJECT.md` answers; fix a divergence
in the adapter during the run instead of working around it. No
`.agents/acceptance/` → bootstrap one first:
[project-adapter.md](references/project-adapter.md).

## Living logs — inject each by its own shape

Both layers (this skill's generic copies and the project's own) are loaded once
the target is known, silently:

- **[common-mistakes.md](references/common-mistakes.md)** — read its
  **Checklist** in full, now and again before marking any case `pass`. Pull an
  entry by id only when a checklist line applies to a case.
- **[probe-mock-patterns.md](references/probe-mock-patterns.md)** — read the
  heading index, then pull only the entries this round needs. Pick by meaning,
  not keyword; `rg` over the body is the fallback.

```bash
rg -n '^#{2,4} ' <file>          # the index, with line numbers
sed -n '<start>,<end>p' <file>   # one entry, in full
```

Record new project-specific learnings in the project layer only.

## Two paths — no id is required

Every evidence command targets a round. **The authored path is the default**; you
have an operation id only when the invocation names one. Never hunt the
environment for one, and never report this skill inapplicable — a round without
an operation is simply recorded as `standalone`.

| You have                        | Path                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| No plan — you author the checks | Write `result.json` + `assets/`, publish with `lh acceptance run ingest` — [report.md](references/report.md)         |
| An operation id you were given  | `lh verify plan state`, then `result submit --operation` per criterion — [plan-format.md](references/plan-format.md) |

Pass `--subject` (`task:<id>` / `topic:<id>` / `document:<id>`) only when the
caller named one; otherwise ingest attaches the round itself when it can and
creates a standalone acceptance when it cannot. On the first ingest, always supply
`--requirement "<one-sentence business goal>"` — the durable goal of the whole
acceptance, not this round's scope; it is immutable once recorded.

Prerequisites: `lh` is authed (`lh acceptance run list --json` returns `[]` or
data; an auth error means stop and surface it), and only the UI driver the
selected surface needs is installed — probe before adding dependencies, and never
substitute a private agent plugin.

## Optional user-journey flows

Before authoring checks, identify the independently reviewable user tasks in the
requirement. Use those tasks as business groups, not the PR title or test surface.
For example, reassignment, scheduled continuation, and failure recovery can be
separate groups when the delivery covers all three; do not impose these groups
on unrelated work. Each check should have an outcome the user can accept or
reject independently. Keep shared entry/accessibility checks separate and avoid
repeating their expectations across business checks.

When acceptance depends on a sequence of user states, publish its graph during
planning, before implementation or verification begins. Keep the checklist paths
above for independent checks;
a graph is optional and does not replace evidence or human review.

For flow-based plans, **each flow's title is its checks' default checklist category**.
Publish independent user journeys as separate flows in the same acceptance/run;
use subflows for actual composed journeys. An umbrella flow containing checks
for several independent tasks collapses them into one checklist group. Edges
must describe real user transitions, not artificial links added to make unrelated
checks reachable. Start at the user entry and follow the journey through outcomes
and recovery; UUIDs identify nodes and must not encode business order. Read back
the published plan and inspect its groups and reading order before execution.

For an existing acceptance that only needs different checklist groups, use
`lh acceptance regroup <acceptanceId> --file groups.json`. Read the acceptance
bundle first; write `{ expectedVersion, groups: [{ title, checkItemIds }] }`,
using the exact union `checks[].id` values and
`acceptance.metadata.checkGrouping.version` (0 when absent). The groups replace
the current presentation grouping; an empty list restores plan categories.
Unassigned checks keep their plan category. This preserves check IDs, numbering,
evidence and review history without creating a round. It does not change flow
transitions or verification conditions. Do not move execution nodes or start a
new round just to reorganize the checklist; those operations have different
execution semantics.

1. Use the named acceptance (or create one with `lh acceptance create --help`).
   Write a JSON file with `definition: { title, entryNodeId, nodes, edges }`.
   Give nodes and edges stable UUIDs. Each node has `id` and exactly one of
   `criterionId` (existing check asset), `check: { id, title, definition }`
   (a check asset with steps, fixtures, preconditions and expected outcome), or
   `subFlowId` (another flow in this acceptance). Edges have `id`, `sourceNodeId`,
   `targetNodeId`, `trigger`, `required`, and optional `condition`. Every node must
   be reachable from the entry. Publish child flows before referencing them.
2. `lh acceptance flow publish <acceptanceId> --file flow.json` saves the
   definition and returns `flowId`. To edit it, include that `flowId` and the
   current `expectedHash` in the file. `lh acceptance flow view <acceptanceId>`
   reads definitions, snapshots and results. Publishing does not execute checks.
   Revise a graph in place rather than publishing a second one; a superseded
   graph left behind still renders as its own journey with its own unexecuted
   checks. `lh acceptance flow delete <acceptanceId> --flow <flowId>` removes
   one that never should have existed, and only while it has no verified
   history: it is refused once a settled round has run it, or while another
   flow invokes it as a subflow.
3. `lh acceptance flow plan <acceptanceId> --flow <flowId>` creates a draft round
   with the graph and its plan. While the round is only planned it follows the
   live graph: publishing an edit refreshes its snapshot and plan in place, and
   running `flow plan` again refreshes the same draft instead of opening another
   round. Add `--run <verifyRunId>` to attach another flow to the same draft. Read `lh acceptance run get <verifyRunId> --json` for
   the actual plan IDs: each branch and subflow invocation has its own
   `checkItemId`; never substitute the reusable asset ID.
4. Share the acceptance link so the user can inspect the proposed nodes, branches
   and expected outcomes before implementation. Read and address any actionable
   feedback. Preparing a plan neither executes checks nor approves delivery;
   there is no separate flow-confirmation action. Continue within the user's
   authorized scope, or pause if the user explicitly asked to review before work.
   For requested changes, publish the revised definition with its `flowId` and
   `expectedHash`; the draft round follows automatically. Never open another
   round or another flow just to revise a plan that has not executed.
5. Implement the work and exercise the real product, then use
   `lh acceptance flow record <acceptanceId> --file result.json`, containing
   `verifyRunId`, `checkItemId`, `verdict` (`passed`, `failed`, `uncertain`, or
   `blocked`) and `observation`. Record only what was observed. Use the returned
   result ID to attach required artifacts through `lh acceptance run evidence`
   (inspect its `--help`), following the same evidence rules as checklist checks.
6. After all required checks are recorded and passed, run
   `lh acceptance flow complete <acceptanceId> --run <verifyRunId>`. Completion
   settles verification; it does not accept the delivery on the user's behalf.
   Read back the round and verify evidence coverage before handing it over.

To rerun the exact old graph, prepare a plan with `--from-run <sourceVerifyRunId>` and
omit `--run` for a fresh round. This preserves the old definition and starts
without results. Each replay starts as an unexecuted draft. A round is frozen
by its first recorded result; only then does it keep its number. An
`lh acceptance run ingest` that reaches an acceptance whose latest round is
still a draft folds into that draft rather than opening a new round. Accepted or closed
acceptances must be explicitly reopened
before starting. Edges describe business transitions; they do not automatically
schedule execution. Continue to read `lh acceptance feedback <acceptanceId> --actionable` before repairs and publish new rounds into the same acceptance.

## HARD RULE — programmatic gates are NEVER acceptance checks

Every check MUST be an outcome a **person decides about the delivery**: what the
user sees, hears, reads, or receives. These MUST NOT appear as a check, under any
phrasing: unit / integration / regression / snapshot tests, coverage,
`type-check` / `tsc`, lint / `eslint`, format, "compiles", "build passes",
"CI is green". Run them, then report them as **one line of narrative**.

Enforced at ingest: every matching item (matched on title, category, AND
`method` — "run `bun run test`" under a product-sounding title still matches) is
**dropped** with a warning and `summary` recounted; a round of only such checks
**fails to publish**. The line is the _subject_ of the check, not who judged it:
a CLI behavior asserted by a command is a fine check (`verifier: "program"`);
"the suite is green" is not. Before writing any plan, ask of each draft check:
_would the user click accept/reject on this?_

## Rounds are immutable — repair means a NEW round

A published round is a permanent record. **Never re-submit into a round after
changing the code** — publish the re-verification as the next round and let the
acceptance page show the progression.

Before a repair round, read the aggregate with
`lh acceptance view <acceptanceId | type:id> --json`. Omit checks whose latest
`userReview.action` is `accept`; address non-stale rejects under their exact
stable ids; when a check semantically replaces another, declare
`supersedes: ['old-id']` and repeat the full lineage in every later round that
reuses the successor id. Pass `--acceptance <acceptanceId>` so the round joins
the same history.

## Rules you will be tempted to skip

Not judgment calls — the moves an agent under pressure makes and must not. Each
excuse below was made in a real round.

| Excuse                                                                                                 | Reality                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Injection is hard; happy-path plus unit tests covers it"                                              | The error state _was_ the goal. Walk the probe ladder ([probe-mock-patterns.md](references/probe-mock-patterns.md) A) before calling it blocked. (M2)                                                                           |
| "The branch name says what to verify" / "Loading the living logs first…"                               | The task lives in the user's words. Recover it, or confirm a labeled guess with one structured question — silently; never narrate setup. (M3, M21)                                                                              |
| "The black frame is probably display sleep / a permission"                                             | Measure first: pixel brightness, the permission bit, an A/B with one variable toggled. Publish "confirmed by X" or "suspected", never a guess. (M4)                                                                             |
| "Let me ask how they want it run" / "I'll click Sign in and you authorize" / "too small to screenshot" | Environment mechanics are yours: full isolated run, auth by direct injection (never an interactive login — it hijacks the user's browser), a screenshot for every user-facing change. Ask only about the product decision. (M8) |
| "One more config edit and the env will boot" / "I'll mock it" / "I'll drive the rest myself"           | Timebox. Inventory running instances, probe for the real capability before mocking (a mock that records nothing is not in the path), re-delegate a dead subagent's remaining steps, revert experiments and ask. (M17)           |
| "The fix is in and tests pass — verified"                                                              | Reproduce the failure's precondition first, then verify with it held. A run that cannot fail proves nothing; "reproduces sometimes" means an unnamed precondition. When the mocked seam is the suspect, drop the mock. (M31)    |

## Pick the surface by the user-visible outcome

Match the requirement to the cheapest surface that can prove the complete outcome,
not merely the layer containing the code change. A backend fix for missing cards,
stale lists, navigation, or another visible behavior still requires the consuming
UI, its actual data response, and inspected screenshots. Database assertions and
passing tests support that evidence; they do not replace it.

| What your task changed                                      | Surface                                               | Guide                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| Backend / CLI / library / data logic with no UI outcome     | **CLI** — stdout as `text`, zero UI flakiness         | [surfaces/cli.md](surfaces/cli.md)                     |
| Web app frontend / styles / interactions                    | **Web** (agent-browser → running web app)             | [surfaces/web.md](surfaces/web.md)                     |
| New/changed API **plus** the UI consuming it                | **Web**, full-stack (agent-browser + network capture) | [surfaces/web.md](surfaces/web.md#web-full-stack)      |
| Desktop-only behavior (native windows, IPC, packaged shell) | **Electron** (agent-browser `--cdp`)                  | [surfaces/electron.md](surfaces/electron.md)           |
| Native macOS app / OS chrome agent-browser can't reach      | **Native** (osascript + screencapture, local macOS)   | [surfaces/native.md](surfaces/native.md)               |
| Native iOS behavior, gestures, device-size layout           | **iOS Simulator** (AXe/native CLI + `simctl`)         | [surfaces/ios-simulator.md](surfaces/ios-simulator.md) |

- **Use CLI alone only when the required outcome has no UI surface.** If a visible
  outcome cannot be exercised, report that acceptance as incomplete instead of
  narrowing it to data checks. Use **Electron** only when the criterion depends on
  desktop-only code; iOS is driven by a Simulator HID/AX CLI, never host mouse —
  mark the case `blocked` if the CLI cannot express the gesture.
- **Structured data uses native visualizations** (`cases[].datasets` +
  `cases[].visualizations`; raw CSV/JSON stays as `evidence`), not a PNG —
  [report.md](references/report.md#structured-visualizations). **A deliverable
  the user hears needs `audio`** —
  [evidence.md](references/evidence.md#audio-deliverables).
- **Auth is a gate scoped to the surface**: authenticate that surface first or
  every capture lands on the sign-in page. Web:
  [auth-web.md](references/auth-web.md).
- **A UI round may price its interaction cost** by recording KLM operator counts
  into `interaction-trace.jsonl`; optional, never hand-written —
  [interaction-cost.md](references/interaction-cost.md).

**Every file submission MUST include a non-empty, reviewer-facing description**
(`--desc` for CLI submissions; `description` for tools and ingest entries).
Identify what the file contains and what it demonstrates for this criterion.
A filename, path, artifact id, or generic label such as "evidence" is not a
sufficient description. This also applies when a text file is stored inline.

Shared rules for every artifact — media types, provenance, file vs inline,
safety — are in [evidence.md](references/evidence.md).

## Keep checklist explanations brief

Write each check's `observation` and inline explanation in the user's language,
usually 1–3 short sentences: what was done, what happened, and any limitation
needed to judge that outcome. Do not paste the execution report into the check.
Omit repeated titles, verdict labels, SHA/port/ID headers, environment boilerplate,
and round-history explanations. Put shared setup and revision details once in
the round report; keep commands, traces, raw output, and detailed reasoning in
separate evidence attachments. Briefly disclose a limitation in the check when
it changes the verdict; concision must not hide missing verification.

Example: “转派后，新 Agent 收到原对话上下文并创建了独立话题。刷新后消息仍保留。”
For a failure, name the unmet outcome directly, without recounting the debugging
process. Keep required evidence complete; shorten its presentation, not the work.

## Final handoff (mandatory)

Before declaring the task done, prove coverage: for each check with
`requiredEvidence`, every declared `type` is present at least once. Report it
explicitly; a missing type holds the delivery at `uncertain` no matter how good
the work is.

The final response MUST include the published acceptance URL together with the
coverage result — never only a check-result id or a prose claim. Expose only the
**acceptance** (`/acceptance/<acceptanceId>`), the stable cross-round decision
surface; append `?r=<roundIndex>` for this round's fixed snapshot.
Put no images, local paths, local file links, or internal run-page paths in the
chat reply.

Write the link as a plain-text line, never inside a fenced or inline code block — the
chat client only linkifies plain text, and a code block makes it unclickable:

Acceptance: <https://app.lobehub.com/acceptance/ACCEPTANCE_ID> (the placeholder is the id ingest printed; it stays inside the URL)
Coverage: 2/2 criteria, all required evidence uploaded

## Portability rules

- **Engine-level capture over OS capture.** `agent-browser screenshot` / `dom` /
  `eval` run headless; `screencapture` / osascript are macOS-only. iOS: `xcrun
simctl io` over host-window capture. Rounds land under `.acceptances/`, which
  the CLI keeps out of git.
- **Upload as you go.** Evidence keyed to its check mid-run survives a crash near
  the end.
- **Don't invent evidence.** Capture only the types a check declares.

## Reference map

For both acceptance-checker handoffs and review output, read
[acceptance-checker.md](references/acceptance-checker.md).

| Need                                           | Reference                                                                                                                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The project layer, bootstrapping an adapter    | [project-adapter.md](references/project-adapter.md)                                                                                                                                     |
| Mistakes checklist (read every round)          | [common-mistakes.md](references/common-mistakes.md)                                                                                                                                     |
| Forcing state, error injection, runtime probes | [probe-mock-patterns.md](references/probe-mock-patterns.md)                                                                                                                             |
| Authored rounds, `result.json`, ingest         | [report.md](references/report.md)                                                                                                                                                       |
| Plan-driven rounds: schema, submit, coverage   | [plan-format.md](references/plan-format.md)                                                                                                                                             |
| Evidence media, provenance, submission, safety | [evidence.md](references/evidence.md)                                                                                                                                                   |
| Interaction cost overlay                       | [interaction-cost.md](references/interaction-cost.md)                                                                                                                                   |
| Web/Electron Chromium CLI commands             | [agent-browser.md](references/agent-browser.md)                                                                                                                                         |
| Authenticated Web session                      | [auth-web.md](references/auth-web.md)                                                                                                                                                   |
| Native macOS / OS-owned step                   | [computer-use.md](references/computer-use.md)                                                                                                                                           |
| Temporal evidence: Web/Electron, iOS, native   | [recording-cdp.md](references/recording-cdp.md), [recording-ios-simulator.md](references/recording-ios-simulator.md), [recording-native-macos.md](references/recording-native-macos.md) |
