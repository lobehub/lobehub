---
name: agent-testing
description: >
  Agentic end-to-end testing for any project: backend verification via the
  project CLI, frontend verification via agent-browser (web), and desktop
  verification via CDP (Electron). Drives the real surface, captures visually
  confirmed evidence, and publishes a structured report to the LobeHub verify
  platform. Triggers on 'cli test', 'test with cli', 'verify with cli',
  'backend test with cli', 'local test', 'test in electron', 'test desktop',
  'manual test', 'test report', or any local end-to-end verification task.
---

# Agent Testing (Agentic End-to-End Verification)

One skill for agentic end-to-end testing of any project — backend through the
project CLI, web through a browser, desktop through Electron/CDP. Every session
follows three phases:

```text
PLAN (Steps 0–2) → EXECUTE (Steps 3–6) → FINISH (Step 7)
```

Do not enter Execute until Plan has confirmed both the environment state and the
execution plan. Treat Steps 3–6 as one continuous execution phase: select the
surface, run the cases, produce the report, and publish it. Always end with
Finish unless the user explicitly asks to keep the environment running.

**Everything project-specific comes from an adapter, not from this skill.** The
concrete start/stop commands, ports, auth, surfaces, and probes for the project
under test live in `.agents/acceptance/PROJECT.md`. This skill supplies the process,
the evidence discipline, and the surface methodology; `PROJECT.md` supplies the
commands. When a step below says "from `PROJECT.md`", read that file for the
actual command instead of guessing. See
[references/project-adapter.md](./references/project-adapter.md).

## Phase 1 — Plan

Confirm what will run and whether the environment is ready before changing or
starting anything.

Skill-internal setup — loading this skill, reading the living logs and reference
files — is silent preparation: never narrate it to the user ("I'll load the
mandatory living logs first…" is noise). The first user-visible message of a
session is about the user's test — the target confirmation (Step 0) or the
Phase 1 approval gate — in one message, not a setup announcement followed by the
same question again.

### Step 0 — Ground the target, then read the two living-log layers (mandatory)

**A test target must exist before anything else happens.** When the invocation
carries none (bare skill invocation, no pending ask in the conversation), ground
it first — do NOT read the living logs or touch the environment yet:

1. Take the target from the user's words in this conversation when they exist —
   the task lives in their words, not in git (common-mistakes: task from the ask,
   not the branch).
2. Otherwise, infer the most likely candidate from observable context (current
   branch, recent commits, working-tree changes) and confirm it with one
   structured question — the candidate as the recommended option, clearly labeled
   as a guess. Never start executing against an unconfirmed guess.
3. Only when nothing is inferable, ask one direct open question. Asking "what
   should I verify" is the one legitimate opening question — but asking it
   open-ended when a candidate was inferable wastes the user's turn.

**Once the target is known**, read both layers of both living logs in full and
hold them in mind for this run. Reading them before a target exists wastes
context that may be compacted away before Execute — they inform execution, not
target selection.

- **Generic layer** (ships with this skill, read-only here):
  [references/common-mistakes.md](./references/common-mistakes.md) and
  [references/probe-mock-patterns.md](./references/probe-mock-patterns.md).
  Two mistakes that keep biting:
  - **Never declare a case `passed` from grep/skeleton-count heuristics — open the
    actual screenshot with Read and confirm it rendered the expected content.** A
    blank/white page also has 0 skeletons and still matches persistent nav text.
  - **If the goal is verifying error/failure states, do NOT stop at happy-path
    when injection is hard.** Escalate (see the pattern library) until you have
    real failure-state evidence.
- **Project layer** (writable, owned by the project): `.agents/acceptance/common-mistakes.md`
  and `.agents/acceptance/probe-mock-patterns.md`, when they exist. These carry what
  earlier runs learned about THIS project.

**The project layer is a living log — append to it during the run**, in English:

- User gives negative feedback → new case in `.agents/acceptance/common-mistakes.md`
  (Wrong approach / Why / What it breaks / Correct approach).
- You hit any probe/mock that is blocked, bypassed, or needs a workaround → new
  item in `.agents/acceptance/probe-mock-patterns.md` (Situation / Doesn't work /
  Works).

Write project-specific learnings to the **project layer only**. Never edit the
generic layer from a consumer repo — it is read-only and updated by PR to the CLI
repo. **Confidentiality of the generic layer:** its entries must be
product-independent. If a learning turns out to be product-independent and worth
sharing, genericize it and open a PR upstream; keep anything naming a project's
packages, routes, schemas, env vars, service names, or business logic in the
project layer.

### Step 0.5 — Adapter check (mandatory when `PROJECT.md` is missing)

If `.agents/acceptance/PROJECT.md` does not exist, run the first-run bootstrap in
[references/project-adapter.md](./references/project-adapter.md) BEFORE anything
else: explore the repo (package.json / README / CI workflows / Makefile / compose
files), draft a `PROJECT.md` from the fixed section skeleton, present it to the
user for confirmation, and write it only after approval. Do not start a dev
server or write test steps against an unconfirmed adapter.

When `PROJECT.md` exists, read it now — every concrete command in Steps 1–7 comes
from it. When observed reality diverges from it during the run, fix the adapter in
place (adapter drift is a living-log entry: amend the file during the run).

### Step 1 — Prepare the execution plan

Skip directly to Step 2 if: the test is a single re-run after a fix, the plan was
already agreed on, or the user gave exact commands.

Prepare the proposed surface, cases, expected evidence, assumptions, and report
deliverable. Do not ask for approval yet: Step 2 must establish the real
environment state first so the user can approve one complete, evidence-backed plan
instead of separate plan and environment prompts.

### Step 2 — Confirm environment state and auth (mandatory)

Step 2 is about getting the environment ready: **dependencies are healthy** and
**auth is green**. A test run that dies halfway on a missing dependency or a login
wall wastes the whole session — clear both gates BEFORE writing a single test
step. The concrete commands for each check come from `PROJECT.md`; the rules below
are the ones that hold for every project.

#### 2.0 Resolve the current test environment

Before starting a dev server, checking auth, opening agent-browser, or writing
test steps, resolve and confirm the environment `PROJECT.md` describes — the base
URLs, ports, and required services. Do not rely on a hard-coded port table: read
the values from the project's own env resolver (per `PROJECT.md` §2). If the
resolved values do not match a running dev server, fix/export the env first, then
continue.

#### 2.1 Dependencies are installed

Install per `PROJECT.md` §2. **Universal rule: a monorepo root install does not
always cover every app.** If the project has standalone sub-packages with their
own `node_modules` (the adapter says which), install in each one the test will
touch — a stale standalone install typically fails at build/launch with an
unresolved workspace import.

#### 2.2 Run long-lived scripts from the repo root

Background commands inherit the current working directory. Relative paths in this
skill and in `PROJECT.md` are repo-root-relative, so a script launched while `cwd`
is a sub-package can fail with `No such file or directory`. Verify `pwd` is the
repo root before launching long-running scripts.

#### 2.3 Start the dev environment

Start the environment per `PROJECT.md` §2 (dev server, plus any required services
such as a database, cache, queue, or object store). **Universal rules:**

- Prefer the project's own already-configured local environment when one exists;
  do not clobber a user's running config.
- Any service the feature under test depends on is a **hard prerequisite**, not an
  "only when needed" nicety. If a run touches a code path that dispatches to a
  queue/worker/object store, that service must be up first or the run dies before
  reaching the code under test — and the failure often reads as unrelated to the
  env. `PROJECT.md` §6 lists these constraints; gate on them.

#### 2.4 Auth is green for the selected surface

**Auth is the gate for automated testing, but the gate is surface-scoped.** Pick
the intended surface first when it is already clear from the task, then check only
that surface. Do not block a web test on CLI auth or a desktop login state unless
the test spans those surfaces. Run the per-surface status check from `PROJECT.md`
§3. If a surface is signed out, **inject the login state directly** (seeded
session, cookie/state restore, CLI/API-minted tokens — per `PROJECT.md` §3);
**never drive an interactive login/OAuth flow** — those open login pages in the
user's browser and hijack their session. When no injectable state exists, report
auth as ❌ Blocked and ask the user for one manual sign-in, naming the exact
blocking step.

#### 2.5 Screen-recording preflight (OS-capture surfaces only)

macOS `screencapture` / osascript captures come out **entirely black** when Screen
Recording (TCC) permission is missing OR — just as often — the **display is
asleep / locked / on a screensaver** (permission is fine, but there is nothing lit
to capture; this bites after a long idle run). A black PNG is easy to mistake for
a real capture, so gate BEFORE any OS-capture step:

```bash
# $SKILL_DIR = wherever this skill is installed
"$SKILL_DIR/scripts/check-screen-recording.sh" # exit 0 = OS capture will work
```

It checks both layers — permission and a real one-frame blackness probe — and
prints the exact fix. `capture-app-window.sh` runs it automatically and refuses to
write a black artifact (bypass with `SKIP_SCREEN_CHECK=1`). This gate is **only**
for OS-capture surfaces. CDP-based evidence (`agent-browser screenshot`,
`cdp-screenshot.sh`, `record-app-screen.sh`) renders from the browser engine and
is unaffected. Because the display can sleep mid-run, keep it awake for the whole
capture session:

```bash
caffeinate -dimsu & # prevent display/idle sleep for the run; kill when done
```

#### Phase 1 approval gate — report environment + plan to the user

At the end of Step 2, always send one user-facing Plan feedback before entering
Execute. Read and follow [references/plan.md](./references/plan.md). It requires:

- an overall environment verdict with concrete checks and evidence;
- emoji-prefixed status markers in the verdict and every table row
  (`✅ Ready`, `⚠️ Warning`, `❌ Blocked`, `⏳ Pending`);
- the proposed execution plan, cases, and expected evidence;
- every unresolved prerequisite, clearly assigned to the agent or the user;
- an explicit statement that nothing is needed from the user when that is true;
- one structured confirmation question after the feedback.

Resolve safe, agent-owned environment mechanics before presenting the gate. Ask
the user only for prerequisites that genuinely require their authority, secret,
device action, or product decision. Do not enter Phase 2 until the user approves
the plan and all blocking user-owned prerequisites are satisfied.

## Phase 2 — Execute

Carry the approved plan through surface selection, verification, reporting, and
publication without reopening environment decisions unless observed state
invalidates the plan.

### Step 3 — Pick the surface by change scope

| Change scope                                       | Default surface                                                                       | Why                                                               | Guide                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| **Backend** (router / service / model / migration) | **CLI**                                                                               | Fastest loop, text-assertable output, zero UI flakiness           | [surfaces/cli.md](./surfaces/cli.md)           |
| **Pure frontend** (components, store, styles, UX)  | **Electron** (agent-browser + CDP) if the project ships a desktop shell, else **Web** | Primary product shape; live state introspection                   | [surfaces/electron.md](./surfaces/electron.md) |
| **Full-stack** (new API + UI consuming it)         | **Web** (browser + local dev server)                                                  | One surface where network requests and UI are observable together | [surfaces/web.md](./surfaces/web.md)           |

Which of these surfaces the project actually has, and how each one launches, comes
from `PROJECT.md` §4. Escalate, don't duplicate: verify a backend change with the
CLI first; only add a UI pass when the change actually affects the UI.

**Verify the change runs where you think it does — confirm runtime, don't assume.**
Some features have two execution paths and the UI silently picks one (e.g. a client
runtime vs a server/queue runtime). A test that exercises the wrong path can pass
green without ever touching the code under test. Before trusting a result, **prove
which runtime ran** — a server-side operation row, a queue step, a server-only log
line. If the UI won't take the intended path, drive it directly (call the server
endpoint) so that runtime actually executes.

#### Environment support (local macOS vs cloud Linux)

The decisive constraint per surface is **how evidence (screenshots) is captured**:
CDP-based capture (`agent-browser screenshot`) renders from the browser engine and
needs no real display; OS-level capture (`screencapture`, osascript) is macOS-only.

| Surface  | macOS (local) | Linux / cloud (headless)                                  | Screenshot mechanism                                   |
| -------- | ------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| CLI      | ✅            | ✅                                                        | n/a — text output                                      |
| Web      | ✅            | ✅ headless Chromium works natively                       | CDP — no display needed                                |
| Electron | ✅            | ⚠️ runs, but needs a display server: wrap with `xvfb-run` | CDP works under Xvfb; `capture-app-window.sh` does NOT |

When a test must stay cloud-portable, prefer CDP-based evidence over OS-level
capture wherever both exist.

### Step 4 — Run

Surface guides above carry the detailed workflows. Shared infrastructure:

| Need                               | Where                                                                |
| ---------------------------------- | -------------------------------------------------------------------- |
| `agent-browser` command reference  | [references/agent-browser.md](./references/agent-browser.md)         |
| osascript patterns (general macOS) | [references/osascript.md](./references/osascript.md)                 |
| Screen recording                   | [references/record-app-screen.md](./references/record-app-screen.md) |

#### Scripts

All under `<skill-dir>/scripts/` (resolve `<skill-dir>` to wherever this skill is
installed; `chmod +x` is applied on install):

| Script                          | Usage                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `report-init.sh`                | Scaffold a structured report grouped by acceptance subject (Step 5)                             |
| `fixture.mjs`                   | Per-check fixtures: `init-check`, `list`, and `compose` an ingest-ready round (Step 5)          |
| `record-gif.sh`                 | Frame-sequence → GIF for time-based behavior (streaming, timers, animations)                    |
| `check-screen-recording.sh`     | Preflight: OS screen-capture works (macOS Screen Recording + display awake)                     |
| `cdp-screenshot.sh`             | Electron/Chrome screenshot via RAW CDP (bypasses the agent-browser daemon); `--check` preflight |
| `capture-app-window.sh`         | Screenshot a specific app window (general; macOS OS capture)                                    |
| `record-app-screen.sh`          | Record app screen (CDP screenshots → video + gallery)                                           |
| `agent-browser-klm.mjs`         | Wrap `agent-browser`, run the real action, append a GOMS-KLM interaction atom JSONL             |
| `agent-browser-klm-analyze.mjs` | Summarize interaction JSONL into `result.json.interactionCost`                                  |

Project-specific probes and env scripts (the "jump straight to app state" fast
paths) live in the project's own `.agents/acceptance/scripts/` and are described in
`PROJECT.md` §5 — not here.

#### Agent-browser interaction-cost tracing (optional, UI runs)

For UI verification runs, drive cost-bearing browser actions through the KLM
wrapper so the same action also records a user-equivalent interaction atom:

```bash
TRACE="$DIR/interaction-trace.jsonl"
SESSION=your-session # from PROJECT.md

"$SKILL_DIR/scripts/agent-browser-klm.mjs" \
  --klm-trace "$TRACE" --klm-phase login --klm-check case-1 \
  --session "$SESSION" click @e3

"$SKILL_DIR/scripts/agent-browser-klm.mjs" mental \
  --klm-trace "$TRACE" --klm-phase first-view --m 2 --score 3 \
  --confidence 0.75 --reason "First view requires understanding state and next action"
```

The wrapper forwards every non-`--klm-*` argument to `agent-browser`. Physical
actions are inferred from the browser command (`click → P+K`, `fill/type →
P+T(n)`, `press → K`, `wait → R`). Mental operators (`M`) are explicit agent
estimates recorded with the `mental` subcommand. Analyze before publishing:

```bash
"$SKILL_DIR/scripts/agent-browser-klm-analyze.mjs" \
  --trace "$TRACE" --result "$DIR/result.json" --write
```

This writes `result.json.interactionCost`; `acceptance run ingest` stores it on the
run metadata so the report can render a separate interaction-cost section.

### Step 5 — Structured report (mandatory deliverable)

Every automated test session ends with a structured, evidence-backed report — not
a chat-only summary. Scaffold it up front and fill it as you test:

```bash
# Pass the acceptance subject up front so every round is grouped correctly.
DIR=$("$SKILL_DIR/scripts/report-init.sh" --subject topic:tpc_xxx my-feature "Verify my feature")
# ... test, saving screenshots / CLI transcripts into $DIR/assets/ ...
# fill $DIR/result.json (scenario, context, plan[], cases[], summary.conclusion) — the report;
# $DIR/report.md holds only the narrative tail (follow-ups / notes / score)
```

Reports live in `.records/reports/<subject-key>/<timestamp>-<slug>/` (instruct
the project to gitignore `.records/`), grouped by acceptance. The subject
directory contains an `acceptance.json` marker and one subdirectory per
immutable round. Passing `--subject` also pre-fills `result.json.subject`.
Format and evidence rules: [references/report.md](./references/report.md).

#### Fixtures: reusable per-check inputs

When a check needs reusable seed data or replay steps, keep it under
`.records/fixtures/<subject-key>/<check-id>/`: `check.json` stores the plan and
case template; `seed/` stores reusable inputs. Execution outputs such as
screenshots and transcripts remain in the round's `assets/` and must never be
copied back into a fixture.

```bash
F="$SKILL_DIR/scripts/fixture.mjs"
$F init-check --subject topic:tpc_xxx palette-long-list
$F list --subject topic:tpc_xxx
DIR=$($F compose --subject topic:tpc_xxx --slug round4 --title "Full regression" \
  palette-open palette-long-list)
```

Hard rules worth front-loading:

- **Report language = the user's conversation language.** Write `report.md` and
  every human-facing string in `result.json` (case `name`/`observation`,
  `summary.conclusion`, scope `focus`/`entry`) in the language the user is
  conversing in. `result.json` keys/status values stay English.
- **`result.json` is the report; the verify page renders it.** Each tested
  behavior is one entry in `cases[]` (`{ name, result, observation, evidence }`);
  the page builds the scope header from `scenario`+`context`, the check list from
  `plan[]`+`cases[]`, and the verdict from `summary.conclusion`. Do NOT hand-build
  a case table or a scope block in `report.md` — they double up on the page.
- **Visual evidence lives in `result.json`, NOT in `report.md`.** Attach each
  screenshot/GIF to its case via `cases[].evidence`; the page renders it next to
  the check. Do NOT embed images/GIFs in `report.md`.
- **Non-visual behavioral claims use dual text evidence.** Attach two separate
  text artifacts to the same case: a reviewer-facing **reasoning** document and
  an audit-facing **execution** document. The reasoning artifact explains the
  claim, setup/threat model, method, pass criteria, interpretation, and limits.
  The execution artifact preserves the exact command/request plus relevant raw
  observations, then maps those observations back to the claim. Neither prose
  without observed values nor an unexplained log dump is sufficient. Keep both
  artifacts in the current round; never require a reviewer to join explanation
  from one immutable round with logs from another. See
  [references/report.md](./references/report.md#dual-text-evidence-for-non-visual-behavior).
- **Final replies link ONLY the published `/acceptance/<id>` page — never a
  `/verify/<id>` URL. Put no images or local file links in the chat reply.**
  The acceptance page is the stable cross-round decision surface and renders
  each round's evidence inline. For a fixed this-round snapshot, append
  `?r=<roundIndex>` to the same acceptance URL (the ingest CLI prints it as
  `round snapshot`) — that deep-links this round's full report. You may mention
  the local report directory as plain text. Always leave whitespace between a
  URL and any following text — CJK punctuation glued right after it (`…4c74（本轮`)
  gets swallowed into the href by chat autolinkers and breaks the link.
- **Time-based behavior needs a GIF, not a screenshot.** Streaming output, a
  ticking timer, loading states, animations — record with `scripts/record-gif.sh`
  and attach the GIF as that case's evidence; a static screenshot cannot prove it.

### Step 6 — Publish to the LobeHub verify platform (mandatory)

The local report under `.records/reports/` is the working artifact; the
**deliverable is the report opened on the verify platform**. Do not stop at local
files — push the session up with the CLI so the user (and later reviewers) can open
it at a stable URL with the evidence rendered inline.

**Publish targets PRODUCTION defaults (`https://app.lobehub.com`), not a local-dev
override profile.** When the product-under-test runs against a local env, the CLI
may be pointed at that local server through override env vars — those overrides are
for _running_ the test, and they are wrong for _publishing_: a localhost run yields
a URL nobody else can open, and a local env's stub storage makes file-evidence
uploads fail. Publish in a CLEAN environment that strips those overrides so `lh`
falls back to its production defaults and the user's real login. Clear whatever
override vars the project uses; for reference, clearing a local-server override
profile looks like:

```bash
# Strip local-dev CLI overrides so `lh` uses production defaults + the user's real login.
env -u LOBEHUB_SERVER -u LOBE_API_KEY -u LOBEHUB_CLI_API_KEY -u LOBEHUB_CLI_HOME \
  lh acceptance run ingest "$DIR" --source agent-testing --open --json
```

Production auth is the user's own device-code login. Verify it first in the same
clean env; if it returns "No authentication found", have the user log in
(`lh login` prints a URL + code), then re-run the publish.

**Check the CLI version before publishing.** The publish flags this step relies on
(`--subject`, `--source agent-testing`) require `lh` >= the version recorded in
this skill's `.skill-meta.json`. The `lh` on PATH in a consumer repo is often
older and fails only at this final step (`unknown option '--subject'`). Run
`lh --version` first; when it is older than the marker version, publish through
`npx @lobehub/cli@latest` instead of the PATH binary.

`acceptance run ingest` reads `$DIR` and, in one call, creates a new immutable
verification run, attaches it to the subject acceptance, and uploads everything:

- `result.json.plan[]` → the frozen check plan, with a business-scenario
  `category` on every item (categories name requirements or features, never
  execution surfaces such as Desktop / CLI / Backend);
- `result.json.cases[]` → one check result each, paired to its plan item by `id`;
  a planned item with no case renders as **未执行** instead of silently vanishing;
- each case's `evidence` file(s) → uploaded and attached to that result;
- `report.md` → the report body, plus the `summary` stats.

It prints the `verifyRunId`, `acceptanceId`, `roundIndex`, and the acceptance
paths. The final reply leads with
`https://app.lobehub.com/acceptance/<acceptanceId>` as the latest cross-round
state; for a fixed per-round snapshot use the same URL with `?r=<roundIndex>`
(printed as `round snapshot`). Never link `/verify/<id>` in the reply — the
verify run stays the internal immutable record behind the acceptance page.

#### Every run belongs to a subject acceptance (mandatory)

Every run MUST be chained onto a task, topic, or document **acceptance aggregate**,
so every round lands on one auditable decision page. When the harness runs inside a
LobeHub topic, `acceptance run ingest` automatically uses `LOBEHUB_TOPIC_ID` as
`topic:<id>` — do not ask the user for it and do not omit the acceptance. Outside a
LobeHub topic, an explicit subject is required and publishing without one fails:

```bash
# SUBJECT is task:$TASK_ID, topic:$TOPIC_ID, or document:$DOC_ID
env -u LOBEHUB_SERVER -u LOBE_API_KEY -u LOBEHUB_CLI_API_KEY -u LOBEHUB_CLI_HOME \
  lh acceptance run ingest "$DIR" --source agent-testing --subject "$SUBJECT" \
  --requirement "$REQUIREMENT" --open --json
```

`--subject` accepts `task:<id> | topic:<id> | document:<id>`; `result.json` may
instead use the string form or
`{ "type": "task", "id": "<id>", "requirement": "<goal>" }`.

**Always supply the acceptance requirement on the first ingest.** It is not
generated automatically. Write the one-sentence business goal against which the
whole acceptance is judged, not the current round's narrower scope. A recorded
requirement is immutable; an initially empty value may be backfilled by the first
later round that supplies one.

The first ingest creates the acceptance and every ingest creates its next
immutable round. The user closes the loop on `/acceptance/<acceptanceId>`; the
same state is available through
`lh acceptance view|accept|reject <id | type:id>`.

When no subject exists yet (first verification in a repo, no tracked task),
create one with the CLI instead of asking the user for an id — a dedicated task
is the natural acceptance subject for the run:

```bash
env -u LOBEHUB_SERVER -u LOBE_API_KEY -u LOBEHUB_CLI_API_KEY -u LOBEHUB_CLI_HOME \
  lh task create -n "<project>: <what this run verifies>" -i "<one-line goal>"
# prints: Task created: T-<n> <name> — the T-<n> identifier works directly:
SUBJECT="task:T-<n>"
```

Tell the user which task was created. Reuse the same subject for every follow-up
round in that repo so all rounds land on one acceptance page.

#### Before a follow-up round: read user feedback

When the subject already has an acceptance, planning starts from its current
state rather than memory:

```bash
env -u LOBEHUB_SERVER -u LOBE_API_KEY -u LOBEHUB_CLI_API_KEY -u LOBEHUB_CLI_HOME \
  lh acceptance view "$SUBJECT" --json
```

- `checks[].userReview.action === "accept"`: user-settled; omit it from the new
  plan and do not re-run it.
- `action === "reject"` with `stale: false`: address its comment and annotations,
  and reuse the exact stable check id so the next result lands on the same row.
- For a semantic replacement, create a new id with `supersedes: ['old-id']`.
  A fresh id without `supersedes` creates an unrelated parallel check.
- Treat `stale: true` feedback as history already consumed by a newer round.

#### Every verification run is an immutable snapshot

One call to `acceptance run ingest` creates one immutable `/verify/<id>` snapshot. Never
overwrite, replace, prune, or re-ingest into an earlier run. A fix followed by
re-verification MUST create another run on the same acceptance, preserving the
earlier plan, results, evidence, and verdict exactly as observed. Use a fresh
report directory for every execution round.

Notes:

- `result.json` cases use `{ id?, name, result, observation?, evidence? }`;
  `evidence` is a path (or array) relative to `$DIR`. `result`/`verdict` map onto
  `passed | failed | uncertain`.
- Finer control is available through the atomic commands — `acceptance run create`,
  `acceptance run result ingest`, `acceptance run evidence upload` (`--file` or `--content`),
  `acceptance run report upsert`.
- File evidence uploads through the platform's storage. Against a stub or
  unreachable bucket (common in local dev) the PUT fails; `acceptance run ingest` warns,
  **skips that one artifact**, and still finishes — so the published session is
  real and openable but **missing the skipped evidence**. Publish against real
  storage (production defaults) if the evidence must appear.

## Phase 3 — Finish

Close the run cleanly and leave behind only intentional, auditable artifacts.

### Step 7 — Teardown and handoff (default: stop what you started)

A test run leaves processes and code edits behind. Clean them up by default once
the report is published — a dev server left listening or an injection left in a
source file silently corrupts the next run (and the next agent's mental model).

- **Stop what you started.** Stop the dev server and any services you started,
  using the stop commands from `PROJECT.md` §2. Stop only what THIS run started —
  never a global process-name kill, and never a listener you didn't launch. If the
  user started their own dev server, leave it.
- **Revert every code injection.** Any fault-injection or debug global you added
  (see [references/probe-mock-patterns.md](./references/probe-mock-patterns.md))
  must be undone and verified: restore the file, then `grep -rn AGENT-TEST` returns
  nothing. Never leave an injection or a debug global behind. Note: when you
  injected into a file that already had uncommitted changes, `git checkout --` is
  the WRONG revert — it wipes the branch's edits too; snapshot the file first and
  restore from the snapshot (probe-mock-patterns covers this).
- **Keep the report + evidence.** `.records/reports/**` is the deliverable — do NOT
  delete it in teardown; it is gitignored and the published acceptance run points at
  it.
- **Check `git status` before reporting the tree clean.** Some dev servers write
  managed files on start; reverting them can make them look like per-start churn.
  Confirm what is dirty rather than assuming.

Skip teardown only when the user explicitly wants the environment left up (e.g.
"leave the dev server running, I'll keep poking at it").

## Directory map

```text
agent-testing/
├── SKILL.md                    # this router
├── surfaces/
│   ├── cli.md                  # backend verification via the project CLI
│   ├── web.md                  # full-stack verification in the browser
│   └── electron.md             # desktop verification over CDP
├── references/                 # shared knowledge (generic, read-only in consumers)
│   ├── plan.md                 # Phase 1 approval-gate format
│   ├── report.md               # result.json / report.md / evidence spec
│   ├── agent-browser.md        # agent-browser CLI reference
│   ├── osascript.md            # general macOS automation
│   ├── record-app-screen.md    # screen recording
│   ├── project-adapter.md      # PROJECT.md template + first-run bootstrap
│   ├── common-mistakes.md      # GENERIC living log — read-only, PR upstream
│   └── probe-mock-patterns.md  # GENERIC living log — read-only, PR upstream
└── scripts/                    # generic scripts
```

## Gotchas

- agent-browser: see [references/agent-browser.md](./references/agent-browser.md#gotchas)
- Electron: see [surfaces/electron.md](./surfaces/electron.md#electron-gotchas)
- osascript: see [references/osascript.md](./references/osascript.md#gotchas)
