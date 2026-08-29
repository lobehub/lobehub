# PROCESS.md — how a verification run works in LobeHub

The `acceptance` skill owns the **contract**: what a check is, what counts as
evidence, what a report and an immutable round look like. This file owns the
**process**: how a run is planned, approved, executed, published, and torn down
in this repository. [`PROJECT.md`](./PROJECT.md) owns the **commands**: ports,
services, auth, surfaces, probes.

Read all three. Where this file and the skill disagree about _how to run_, this
file wins; about _what may be published_, the skill wins.

```text
PLAN (0–2)  →  EXECUTE (3–5)  →  FINISH (6)
```

Do not enter Execute until Plan has confirmed both the environment state and the
plan. Loading skills and reading logs is silent preparation — never narrate it.
The first user-visible message of a session is about the user's test, not setup.

## Phase 1 — Plan

### Step 0 — Ground the target, then read the living logs

**A test target must exist before anything else happens.** With no target in the
invocation:

1. Take it from the user's words in this conversation when they exist — the task
   lives in their words, not in git.
2. Otherwise infer the likeliest candidate from the branch, recent commits, and
   working-tree changes, and confirm it with one structured question, the guess
   labeled as a guess. Never execute against an unconfirmed guess.
3. Only when nothing is inferable, ask one direct open question.

**Once the target is known**, read both layers of both living logs in full:

- Generic (ships with the skill, read-only here):
  `.agents/skills/acceptance/references/common-mistakes.md` and
  `probe-mock-patterns.md`.
- Project (writable, ours): [`common-mistakes.md`](./common-mistakes.md) and
  [`probe-mock-patterns.md`](./probe-mock-patterns.md).

Two that keep biting: never declare a case `passed` from grep or skeleton counts
— open the screenshot with Read and confirm it rendered; and when the goal is an
error state, do not settle for happy-path because injection was hard.

**The project layer is a curated log, not a transcript of review feedback.**
Every piece of negative feedback triggers this admission check, and a candidate
passing all five is recorded automatically — no separate user request needed:

1. **Durable** — would it recur in a different feature or a later round?
2. **Project-specific** — does it depend on this product's semantics, environment,
   or infrastructure? If not, genericize it and PR it to the skill source instead.
3. **Invariant-level** — does it state the behavior or evidence contract rather
   than freezing one solution? Exact copy, pixel values, icon choices, and
   annotation coordinates belong in a spec, the component, or a regression test.
4. **Non-duplicative** — search both layers first; amend an existing case when the
   underlying failure is the same.
5. **Actionable** — can a future verifier choose a different action or reject
   invalid evidence with it? Product taste and incident narrative cannot.

A candidate that fails only for being too implementation-specific gets routed:
product behavior to the spec, UI values to the component, regressions to a test,
long incident context to `references/probe-field-notes.md`. Do not skip the
recording merely because it requires abstracting the feedback first.

### Step 1 — Prepare the plan

Skip to Step 2 if this is a re-run after a fix, the plan is already agreed, or
the user gave exact commands.

Draft the surface, cases, expected evidence, assumptions, and deliverable — but
do not ask for approval yet: Step 2 must establish real environment state first,
so the user approves one complete, evidence-backed plan.

Every case must be a delivery outcome a person can judge. Never plan the repo's
own programmatic gates (tests, coverage, type-check, lint, build) — ingest drops
them and a gates-only round fails to publish.

### Step 2 — Environment and auth

Concrete commands come from [`PROJECT.md`](./PROJECT.md); the rules below hold
regardless.

1. **Resolve the environment first** (§2). Read ports and base URLs from the
   project's own env resolver — never a hard-coded port table. If the resolved
   values do not match a running dev server, fix the env before continuing.
2. **Dependencies** (§2, §6). A root install does not cover `apps/desktop` or
   `apps/cli`; install in each standalone app the run will touch. A stale
   standalone install fails at launch with an unresolved workspace import.
3. **Run long-lived scripts from the repo root.** Background commands inherit the
   cwd, and every path here is repo-root-relative.
4. **Start the environment** (§2), including every service the feature depends on
   — a queue, cache, or object store the code path dispatches to is a hard
   prerequisite, not a nicety. Prefer the user's already-running config; never
   clobber it.
5. **Auth, scoped to the selected surface** (§3). Inject login state directly
   (seeded session, cookie/state restore, CLI-minted token). **Never drive an
   interactive login/OAuth flow** — it hijacks the user's browser session. With no
   injectable state, report ❌ Blocked and name the exact blocking step.
6. **Screen-recording preflight, only for OS-capture surfaces.** macOS
   `screencapture`/osascript returns a fully black frame when Screen Recording
   permission is missing _or_ the display is asleep. Gate on
   `.agents/acceptance/scripts/check-screen-recording.sh` (exit 0 = safe), and keep
   the display awake for the session with `caffeinate -dimsu &`. CDP capture
   (`agent-browser screenshot`, `cdp-screenshot.sh`, `record-app-screen.sh`) is
   unaffected.

### The approval gate

At the end of Step 2, for the **first run against a subject Acceptance**, send one
plan feedback and one structured confirmation question. Format, status markers,
and confirmation behavior: [`references/plan-feedback.md`](./references/plan-feedback.md).

That approval covers later iterations on the same Acceptance. On follow-up
feedback: read the Acceptance, silently re-check environment and auth, repair,
re-run the affected checks, and publish a new round — no second approval. Ask
again only on a **material boundary change**: a new surface, external system,
account, secret, permission, or destructive action; a materially changed business
goal; a user-owned blocker; or an environment change that invalidates the approved
evidence strategy. Code revisions, restarts, recaptures, retries, and new rounds
are not material changes.

## Phase 2 — Execute

### Step 3 — Pick the surface

| Change scope                                   | Surface      | Why                                                 |
| ---------------------------------------------- | ------------ | --------------------------------------------------- |
| Backend (router / service / model / migration) | **CLI**      | Fastest loop, text-assertable, no UI flakiness      |
| Pure frontend (components, store, styles, UX)  | **Electron** | The primary product shape; live state introspection |
| Full-stack (new API + the UI consuming it)     | **Web**      | Network and UI observable together                  |

Launch commands per surface are in `PROJECT.md` §4; the operating manual for each
is in the skill's `surfaces/`. Escalate, don't duplicate: verify a backend change
with the CLI first, and add a UI pass only when the change reaches the UI.

**Separate the driver from the evidence surface.** Producing the state under test
and capturing the evidence are independent choices. Drive with the cheapest
deterministic path the repo offers (a CLI command, an endpoint call, a seed
script — `PROJECT.md` §4/§5); use the evidence surface only for what it alone can
prove. Typing a long prompt through browser automation when a CLI driver exists is
slower, flakier, and no more authentic — the server-side state is identical. The
converse also holds: a CLI-driven state still needs UI evidence when the claim is
about rendering.

**Prove which runtime actually ran.** Several features have two execution paths and
the UI picks one silently (client runtime vs server/queue runtime). A test that
exercises the wrong path passes green without touching the code under test. Confirm
with a server-side operation row, a queue step, or a server-only log line; if the UI
will not take the intended path, call the server endpoint directly.

### Step 4 — Run

Project scripts live in `.agents/acceptance/scripts/` and are described in
`PROJECT.md` §5. The generic capture toolchain:

| Script                      | Use                                                                 |
| --------------------------- | ------------------------------------------------------------------- |
| `report-init.sh`            | Scaffold a report directory grouped by acceptance subject           |
| `fixture.mjs`               | Per-check fixtures: `init-check`, `list`, `compose`                 |
| `record-gif.sh`             | Frame sequence → GIF for time-based behavior                        |
| `check-screen-recording.sh` | Preflight for OS capture (permission + display awake)               |
| `cdp-screenshot.sh`         | Electron/Chrome screenshot over raw CDP (bypasses the daemon)       |
| `capture-app-window.sh`     | Screenshot one app window (macOS OS capture)                        |
| `record-app-screen.sh`      | Record an app screen (CDP frames → video + gallery)                 |
| `agent-browser-klm.mjs`     | Wrap an `agent-browser` action and append its interaction-cost atom |

macOS automation patterns: [`references/osascript.md`](./references/osascript.md).
Screen recording: [`references/record-app-screen.md`](./references/record-app-screen.md).

**Interaction cost (optional, UI runs).** Drive cost-bearing actions through the
KLM wrapper so each one also records a user-equivalent atom:

```bash
TRACE="$DIR/interaction-trace.jsonl"

.agents/acceptance/scripts/agent-browser-klm.mjs \
  --klm-trace "$TRACE" --klm-phase login --klm-check case-1 \
  --session "$SESSION" click @e3

.agents/acceptance/scripts/agent-browser-klm.mjs mental \
  --klm-trace "$TRACE" --klm-phase first-view --m 2 --score 3 \
  --confidence 0.75 --reason "First view requires reading state and choosing the next action"
```

Leave the trace in the report directory — `acceptance run ingest` prices it with
the platform's timing model. There is no analyze step, and no cost is published
when no trace exists. Contract:
`.agents/skills/acceptance/references/interaction-cost.md`.

### Step 5 — Report and publish

The report schema, the language rule, visual/dual-text/structured-visualization
evidence rules, and the immutable-round rules are the skill's
`references/report.md`. **Read it before writing the first line of
`result.json`** — a field in the wrong shape is dropped on ingest, so the round
publishes green with its evidence silently degraded.

What is specific to this repository:

- **Reports live in `.records/reports/<subject-key>/<timestamp>-<slug>/`**
  (gitignored), grouped by acceptance subject; the subject directory holds an
  `acceptance.json` marker and one subdirectory per immutable round. Scaffold with
  `report-init.sh --subject topic:tpc_xxx <slug> "<title>"`, which also pre-fills
  `result.json.subject`.

- **Reusable per-check inputs** live in `.records/fixtures/<subject-key>/<check-id>/`
  (`check.json` + `seed/`). Execution outputs stay in the round's `assets/` and are
  never copied back into a fixture.

- **Publish against PRODUCTION defaults, not the local dev profile.** The product
  under test runs locally, but publishing there yields a URL nobody can open and a
  stub bucket that silently drops evidence uploads. Strip the local overrides:

  ```bash
  env -u LOBEHUB_SERVER -u LOBE_API_KEY -u LOBEHUB_CLI_API_KEY -u LOBEHUB_CLI_HOME \
    lh acceptance run ingest "$DIR" --source agent-testing --subject "$SUBJECT" \
    --requirement "$REQUIREMENT" --open --json
  ```

  Verify auth in the same clean env first; if it reports no authentication, have
  the user run `lh login`. If a publish flag is rejected as an unknown option, the
  `lh` on PATH is stale — publish through `npx @lobehub/cli@latest` instead.

- **Choose the subject by business continuity**, not by what is easiest to create:
  an explicit instruction first; else the current conversation's `topic:<id>` (the
  default for iterative fixes and review follow-ups); else an existing `task:<id>`
  that already owns the deliverable; else `document:<id>` when the document is the
  subject; and only then a new Task via `lh task create`. When the run was started
  from a conversation, ingest attaches to it on its own — pass `--subject` only to
  override that, and never ask the user for an id the CLI already resolves. A
  terminal Acceptance on the right Topic means a **new Acceptance on that same
  Topic**, never a new Task invented to dodge it.

- **Before a follow-up round**, read the current state rather than memory:
  `lh acceptance view "$SUBJECT" --json`. Omit accepted checks, repair non-stale
  rejects under their exact stable ids, and carry every `supersedes` chain forward.

- **The final reply exposes only `https://app.lobehub.com/acceptance/<id>`** (add
  `?r=<roundIndex>` for this round's snapshot). No images, local paths, or internal
  run-page paths. Leave whitespace between the URL and any following text — CJK
  punctuation glued to it gets swallowed into the href.

## Phase 3 — Finish

### Step 6 — Teardown

Default: stop what you started. A dev server left listening or an injection left
in a source file corrupts the next run and the next agent's mental model.

- **Stop only what THIS run started**, using `PROJECT.md` §2 stop commands. Never a
  global process-name kill; never a listener you did not launch. A dev server the
  user started stays up.
- **Revert every code injection.** Restore the file and verify: `grep -rn AGENT-TEST`
  returns nothing. When you injected into a file that already had uncommitted
  changes, `git checkout --` is the WRONG revert — it wipes the branch's edits too;
  snapshot the file first and restore from the snapshot.
- **Keep the report and its evidence.** `.records/reports/**` is the deliverable and
  is gitignored; the published round points at it.
- **Check `git status` before calling the tree clean.** Some dev servers write
  managed files on start.

Skip teardown only when the user explicitly wants the environment left running.
