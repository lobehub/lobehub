---
name: acceptance
license: Apache-2.0
metadata:
  version: "0.10.0"
description: >
  Verify delivery outcomes on the real product, capture inspected evidence,
  and deliver an acceptance report with the lh CLI: published to LobeHub when
  signed in, or rendered as a local offline report when not. Use for product
  acceptance, manual verification, evidence collection, or publishing an
  existing report, with or without a supplied plan. Reuse valid evidence; run
  new verification through bounded, lower-cost agent contexts when available.
---

# Acceptance (Builder Self-Evidence)

You are the **builder** for a delivery. A separate review step judges it against
a **plan** — checks you author, or a verify plan handed to this run. A check that
declares `requiredEvidence` **cannot pass on your text alone**: a missing artifact
marks it `uncertain` and holds the delivery.

```
author (or discover) the plan  →  pick the surface  →  capture evidence  →  publish or render the round  →  self-check coverage
```

## Decide whether to execute before starting a round

Creating or updating a PR, marking it ready, or being asked to upload a report
must not by itself start another verification run. First inspect the requested
scope and the task's existing reports, evidence, published acceptance links and
local `report.html` pages (from the conversation, PR, or local `.acceptances/`
directory).

| Delivery state                                                                                                                       | Action                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documentation/instruction-only change, or pure refactor/tooling change with no product behavior change                               | Skip product acceptance and briefly state why. Keep any applicable quality checks.                                                                                                                                                                                                                          |
| Gitlink-only sync                                                                                                                    | Do not launch a fresh acceptance. Link the upstream change and its existing acceptance when available; disclose missing upstream evidence without claiming it passed. Cloud changes accompanying the sync are assessed separately.                                                                          |
| Completed acceptance already published and still covers the delivery                                                                 | Reuse its URL and coverage. Do not create a round or rerun cases just for the PR.                                                                                                                                                                                                                           |
| Completed acceptance rendered locally (`report.html`) and still covers the delivery                                                  | Reuse its report and coverage. When the user now wants others to review it, publish the existing rounds with `lh acceptance publish <acceptanceDir>` — [Local reports](#local-reports-when-not-signed-in); never re-run cases to share them.                                                              |
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

## Execution ownership and independent review

For new execution, use one fresh-context `acceptance-runner` for environment
preflight, planning, product interaction, capture, report assembly, publication,
and cleanup. Explicitly select a lighter model with the required tools; do not
inherit the builder's full conversation or default high-cost model. The primary
keeps scope, product decisions, code repairs, and delivery accountability, and
coordinates through brief reports. Reuse the runner for follow-ups.

Read [delegation.md](references/delegation.md) once to assign source ownership,
model capability, budgets, and handoffs. Each unchanged source section, runtime
probe, and evidence inspection has one owner: pass its acquired facts and
provenance, rather than fetching it again in another agent. Workers load only
their role instructions and needed references, not this entire entrypoint.

Use one `acceptance-checker` in the first round: at most two plan-feedback
responses before execution, then exactly one final report/evidence review.
It is the default owner of verdict-bearing media inspection; the runner captures
and indexes that media without pre-reviewing it. Read
[acceptance-checker.md](references/acceptance-checker.md) only in that owner.
The checker is the plan gate; never ask the user for routine plan approval.
The primary resolves findings and tells the runner when execution or publication
may proceed. There is no per-case approval loop or repeated full review after fixes.

Follow-up rounds have no independent checker gate. Assign new artifact inspection
to one capable owner and re-run only affected cases. If delegation is unavailable,
use one bounded execution context and disclose missing independent review.
If model selection is unavailable, record the actual or inherited model rather
than claiming lower cost. Retain all evidence requirements in either fallback.

## Read the project layer first

Before touching an environment, its execution owner checks for
`.agents/acceptance/`. Reuse sections and facts already acquired for the same
revision; other agents receive the relevant rules and provenance in their
handoff instead of independently reading these files:

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

The execution owner acquires the relevant generic and project sections once
the target is known and records their versions in the shared handoff:

- **[common-mistakes.md](references/common-mistakes.md)** — acquire its
  **Checklist** once. Assign applicable lines to the execution or inspection
  owner, and apply those retained rules before `pass`; do not re-read the file
  for each case. Pull an entry by id only when its detail is needed and not
  already acquired.
- **[probe-mock-patterns.md](references/probe-mock-patterns.md)** — read the
  heading index, then pull only the entries this round needs. Pick by meaning,
  not keyword; `rg` over the body is the fallback.

```bash
rg -n '^#{2,4} ' <file>          # the index, with line numbers
sed -n '<start>,<end>p' <file>   # one entry, in full
```

Record new project-specific learnings in the project layer only.

## CLI discovery

Use the installed `lh` as the command reference. The assigned execution or
publishing owner consults the relevant subcommand's `--help` only when syntax
or capability is unknown, and records the learned usage by CLI version. Reuse
that result across stages and agents; do not walk the whole help tree, repeat
discovery for every case, or invoke a write command to probe support.

Prefer CLI-provided schemas, examples and non-publishing validation. Read a
linked payload schema or legacy recipe only when the installed CLI lacks that
capability. Help teaches syntax; the rules below retain subject/operation
identity, immutable rounds, evidence coverage, language and safe recovery.
Inspect structured errors and ingest warnings; successful JSON parsing or a
zero exit code alone does not establish publication or complete coverage.

## Two paths — no id is required

Every evidence command targets a round. **The authored path is the default**; you
have an operation id only when the invocation names one. Never hunt the
environment for one, and never report this skill inapplicable — a round without
an operation is simply recorded as `standalone`.

| You have                        | Path                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No plan — you author the checks | Write `result.json` + `assets/`, publish with `lh acceptance run ingest`, or render locally with `lh acceptance run render` — [report.md](references/report.md) |
| An operation id you were given  | Read the frozen plan, write the same round directory keyed by its check item ids, publish with `ingest --operation` — [plan-format.md](references/plan-format.md) |

The paths differ only in where the checks come from and which round the ingest
lands in. Capture is identical: the surface guides, recordings with
[chapters](references/video-chapters.md), before/after pairs, screenshots inspected
by their designated owner, `proposal.md`. A handed-down plan never licenses a lighter capture.

Pass `--subject` (`task:<id>` / `topic:<id>` / `document:<id>`) only when the
caller named one; otherwise ingest attaches the round itself when it can and
creates a standalone acceptance when it cannot. On the first ingest, always supply
`--requirement "<one-sentence business goal>"` — the durable goal of the whole
acceptance, not this round's scope; it is immutable once recorded.

Prerequisites: the execution or publishing owner runs `lh acceptance preflight --json`
once before writing any plan or report text, or reuses its recorded result while
server, scope, credentials, and language configuration are unchanged. Its `mode`
picks where the round goes — [Local reports](#local-reports-when-not-signed-in).
On a signed-in machine an auth error means stop and surface it. Install only the UI
driver the selected surface needs; probe before adding dependencies, and never
substitute a private agent plugin. Its `language.locale` is the **report
language**: write every human-readable field (title, plan, case names,
observations, evidence descriptions, conclusion, `report.md`, `proposal.md`) in
it, even when the prompt that invoked you is in another language — a delegating
agent's prompt does not show which language the user reads. The publish commands
reject text in the wrong script, so run `lh acceptance run ingest <dir> --dry-run`
with the same target flags the publish will use as soon as the plan is in
`result.json`, before executing it. Offline `validate` does not check account
language or remote plan membership and never replaces this dry-run.
Never publish merely to test whether a payload is accepted. When
`language.status` is `unset`, use the language the user converses in. On a CLI
without `preflight`, check auth with `lh acceptance run list --json`.

## Local reports when not signed in

`preflight` answers `mode`. **`publish`** (signed in): publish every round as this
skill describes. **`local`** (this machine never signed in to LobeHub): the round
is identical — same plan, capture, `result.json`, `proposal.md`, round directory
and checker — but it is rendered instead of ingested, and nothing is uploaded:

```bash
lh acceptance run render "$REPORT_DIR" --requirement "<one-sentence business goal>" --json
```

The render writes `report.html` beside the acceptance's rounds: the acceptance
page, offline, from every round of that directory, with the same check screening,
evidence coverage and round history as ingest. The language is `unset`, so write
in the language the user converses in, and use offline `lh acceptance run validate`
where the published path runs `ingest --dry-run`. A render that reports
`publicationStatus: partial` has the same meaning as a partial ingest.

Pick the mode by these, in order:

- The user's explicit wish wins: "keep it local" renders even when signed in.
- **Collaboration needs LobeHub.** When the user wants others to comment, review or
  open a link, they sign in (`lh login`, done by the user) and the existing rounds
  are published with `lh acceptance publish <acceptanceDir> --json`: unpublished
  rounds in order, then the reviewer's standing local decisions. It returns the
  `acceptanceUrl`; later rounds publish with `ingest --acceptance <acceptanceId>`,
  where `acceptanceId` is in the directory's `acceptance.json` (`remote`).
- A supplied operation id, flows and regroup are LobeHub features; they publish.
- Otherwise follow `mode`.

The reader reviews in the page itself: accept, reject with a comment, circle a
region on a screenshot, leave group feedback. **Save reviews** downloads those
decisions; `lh acceptance feedback <acceptanceDir> --json` and
`lh acceptance view <acceptanceDir> --json` pick the newest saved download up,
file it as `reviews.json`, and answer in the same shape as for a published
acceptance (`--reviews <file>` names the download explicitly). Comments,
mentions, approvals and shared links do not exist locally.

## Optional user-journey flows

For a requirement with state transitions or independently reviewable journeys,
read [flows.md](references/flows.md) only when authoring or updating that graph.
Ordinary checklist rounds do not load it.

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
`lh acceptance view <acceptanceId | type:id | acceptanceDir> --json`. Omit checks whose latest
`userReview.action` is `accept`; address non-stale rejects under their exact
stable ids; when a check semantically replaces another, declare
`supersedes: ['old-id']` and repeat the full lineage in every later round that
reuses the successor id. Pass `--acceptance <acceptanceId>` so the round joins
the same history; a local round joins it by being written in the same
acceptance directory.

## Rules you will be tempted to skip

Not judgment calls — the moves an agent under pressure makes and must not. Each
excuse below was made in a real round.

| Excuse                                                                                                 | Reality                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Injection is hard; happy-path plus unit tests covers it"                                              | The error state _was_ the goal. Walk the probe ladder ([probe-mock-patterns.md](references/probe-mock-patterns.md) A) before calling it blocked. |
| "The branch name says what to verify" / "Loading the living logs first…"                               | The task lives in the user's words. Recover it, or confirm a labeled guess with one structured question — silently; never narrate setup. |
| "The black frame is probably display sleep / a permission"                                             | Measure first: pixel brightness, the permission bit, an A/B with one variable toggled. Publish "confirmed by X" or "suspected", never a guess. |
| "Let me ask how they want it run" / "I'll click Sign in and you authorize" / "too small to screenshot" | Environment mechanics are yours: full isolated run, auth by direct injection (never an interactive login — it hijacks the user's browser), a screenshot for every user-facing change. Ask only about the product decision. |
| "One more config edit and the env will boot" / "I'll mock it" / "I'll drive the rest myself"           | Timebox. Inventory running instances, probe for the real capability before mocking (a mock that records nothing is not in the path), re-delegate a dead subagent's remaining steps. Search the project layer (`.agents/acceptance/`, including `references/`) for the exact error before asking; if it has no fix, revert experiments and ask for the missing prerequisite. |
| "The fix is in and tests pass — verified"                                                              | Reproduce the failure's precondition first, then verify with it held. A run that cannot fail proves nothing; "reproduces sometimes" means an unnamed precondition. When the mocked seam is the suspect, drop the mock. |

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
| Native iOS behavior, gestures, device-size layout           | **iOS Simulator** (sim-use/AXe + `simctl`)            | [surfaces/ios-simulator.md](surfaces/ios-simulator.md) |

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
- **A change to UI users already see needs before/after evidence.** When the
  delivery changes existing copy, labels, toasts, layout, or style, each such
  case requires a `comparison` pair of the same view on the pre-change and
  post-change code — [report.md](references/report.md#beforeafter-comparison-pairs).
  An after-only shot of a toast reading `重命名遇到了问题，请重试` does not show
  it replaced `Rename failed`. Prove the before half really runs the old code
  ([probe-mock-patterns.md](references/probe-mock-patterns.md) A6); text that
  does not render visibly, such as an `aria-label`, also needs the DOM reading.
  UI with no prior state is exempt.
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

Write each check's `observation` and inline explanation in the report language,
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

**Cloud browser links use `https://lobehub.com`.** For all acceptance, round,
cleanup, and upgrade URLs in this skill (including instructions below that say
"verbatim"), normalize LobeHub Cloud origins to `https://lobehub.com`, preserving
the path, query, and fragment. Cloud hosts are `lobehub.com` and its subdomains.
Keep self-hosted and development origins unchanged. This changes display links,
not the CLI's configured API server.
Keep the Skill installation resource at
`https://app.lobehub.com/acceptance/skill.md`.

Close every browser session this run opened
(`agent-browser --session <name> close`, [web teardown](surfaces/web.md#web-teardown))
before handing off; a session left open keeps a full browser running
indefinitely. Stop this run's [resource guard](references/resource-guard.md)
(`resource-guard.sh stop --state-dir <run state dir>`) as well, and state in the
round report whether it
reached yellow or red and what that stopped; a run that hit red must say which
checks it left `blocked` instead of passing.

Before declaring the task done, prove coverage: for each check with
`requiredEvidence`, every declared `type` is present at least once. Report it
explicitly; a missing type holds the delivery at `uncertain` no matter how good
the work is.

If publication returns a storage-quota failure, the publishing owner reads
[publication-recovery.md](references/publication-recovery.md) once. Preserve
local evidence, disclose incomplete uploaded coverage, and give the returned
scope-specific cleanup and upgrade options. Never delete user data or blindly
retry the whole ingest.

The final response for a completed handoff MUST include the published acceptance
URL — or, for a local round, the report link — together with the coverage result,
never only a check-result id or a prose claim. Obtain the links from the path you
actually executed:

- **Authored round:** copy `acceptanceUrl` returned by
  `lh acceptance run ingest --json` verbatim.
- **Local round:** copy `reportUrl` returned by `lh acceptance run render --json`
  (a `file://` link to `report.html`) verbatim, and tell the reader that
  **Save reviews** in the page is how their decisions reach you. It is the one
  local path the reply carries.
- **Operation-plan round:** copy `acceptanceUrl` returned by
  `lh acceptance run ingest --operation <id> --json`. When the plan needed no
  ingest, or the CLI predates plan-round ingest, follow the read-only
  [plan handoff lookup](references/plan-format.md#resolve-the-plan-rounds-handoff-links)
  instead. Do not ingest without `--operation`, create another acceptance, or
  resubmit evidence merely to obtain a link.

Never guess a host, acceptance ID, or round index. The documented plan lookup is
the only reconstruction needed for CLIs whose submission output contains only an
internal run URL. If the run has no acceptance association or the lookup fails,
report the handoff as blocked and preserve the submitted evidence; do not declare
delivery complete or fabricate a link.
Put no images, other local paths or file links, or internal run-page paths in
the chat reply.

Write the link as a plain-text line, never inside a fenced or inline code block — the
chat client only linkifies plain text, and a code block makes it unclickable.
Hand off only the acceptance URL: the acceptance page opens on its latest round,
so a separate per-round link adds nothing for the reader. Replace the placeholder
below with the URL from the selected path:

Acceptance: <acceptanceUrl, verbatim>
Coverage: 2/2 criteria, all required evidence uploaded

For a local round, the first line is `Report: <reportUrl, verbatim>` and coverage
says "rendered" instead of "uploaded".

## Portability rules

- **Engine-level capture over OS capture.** `agent-browser screenshot` / `dom` /
  `eval` run headless; `screencapture` / osascript are macOS-only. iOS: `xcrun
simctl io` over host-window capture. Rounds land under `.acceptances/`;
  allocate them with `new_round` ([report.md](references/report.md#no-operation-id-needed)),
  which seeds the `.acceptances/.gitignore` that keeps them out of git.
- **Save as you go.** Write each artifact into the round's `assets/` and its case
  into `result.json` the moment it is captured, so a crash near the end loses
  nothing; then publish the round once.
- **Don't invent evidence.** Capture only the types a check declares.
- **Chapter every recording.** Log a mark for each step and each claim you
  verify on a frame, and disclose every anomaly you noticed as a `flag`; the
  reviewer seeks to them instead of watching the whole clip —
  [video-chapters.md](references/video-chapters.md).

## Reference map

Only the assigned owner reads the relevant reference or section, once per version;
other roles use its acquired facts and instructions. The runner does not load
the checker contract, and the primary does not re-open their documents or evidence.

| Need                                           | Reference                                                                                                                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Execution delegation, models, context ownership | [delegation.md](references/delegation.md) |
| First-round plan and evidence review | [acceptance-checker.md](references/acceptance-checker.md) |
| Optional flow authoring or regrouping | [flows.md](references/flows.md) |
| Storage-quota publication recovery | [publication-recovery.md](references/publication-recovery.md) |
| Bounding a run's memory use                    | [resource-guard.md](references/resource-guard.md) |
| The project layer, bootstrapping an adapter    | [project-adapter.md](references/project-adapter.md)                                                                                                                                     |
| Mistakes checklist (acquire once per version) | [common-mistakes.md](references/common-mistakes.md) |
| Forcing state, error injection, runtime probes | [probe-mock-patterns.md](references/probe-mock-patterns.md)                                                                                                                             |
| Authored rounds, `result.json`, ingest, render | [report.md](references/report.md)                                                                                                                                                       |
| Plan-driven rounds: plan, ingest, coverage     | [plan-format.md](references/plan-format.md)                                                                                                                                             |
| Evidence media, provenance, submission, safety | [evidence.md](references/evidence.md)                                                                                                                                                   |
| Interaction cost overlay                       | [interaction-cost.md](references/interaction-cost.md)                                                                                                                                   |
| Web/Electron Chromium CLI commands             | [agent-browser.md](references/agent-browser.md)                                                                                                                                         |
| iOS Simulator driver CLI commands              | [sim-use.md](references/sim-use.md) (preferred), [axe.md](references/axe.md) (fallback) |
| Bundled CDP screenshot and macOS capture preflight | [screenshot-helpers.md](references/screenshot-helpers.md) |
| Authenticated Web session                      | [auth-web.md](references/auth-web.md)                                                                                                                                                   |
| Native macOS / OS-owned step                   | [computer-use.md](references/computer-use.md)                                                                                                                                           |
| Video chapters: steps, checks, flags on a clip | [video-chapters.md](references/video-chapters.md)                                                                                                                                                                                  |
| Temporal evidence: Web/Electron, iOS, native   | [recording-cdp.md](references/recording-cdp.md), [recording-ios-simulator.md](references/recording-ios-simulator.md), [recording-native-macos.md](references/recording-native-macos.md) |
