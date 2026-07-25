# Structured Test Reports

Every automated test session ends with a structured, evidence-backed report. A
chat-only summary is not an acceptable deliverable: the report is what the user (or
a reviewer, or a later agent) audits without replaying the session.

## Location & layout

Reports live under `.records/reports/` (gitignored, like all `.records/`
output), grouped by acceptance subject. One subject directory contains one
subdirectory per immutable verification round:

```
.records/reports/<subject-key>/
├── acceptance.json
├── <YYYYMMDD-HHMMSS>-<slug>/
│   ├── report.md
│   ├── result.json
│   └── assets/
└── <YYYYMMDD-HHMMSS>-<slug>/
```

`<subject-key>` is the ingest subject with `:` replaced by `-`. Scaffold with
`report-init.sh --subject topic:tpc_xxx <slug> "<title>"`; this also pre-fills
`result.json.subject`. The legacy flat layout remains readable, but new runs
should always carry their subject.

Reusable per-check inputs live separately under
`.records/fixtures/<subject-key>/<check-id>/` as `check.json` plus `seed/`.
Execution outputs remain in the round directory's `assets/`. See
`scripts/fixture.mjs` and the skill's fixture workflow.

**`result.json` is the report — `report.md` is just its tail.** The published
verify page (`/verify/<id>`) renders itself from `result.json`: one line of
provenance (PR / branch / commit / date / surfaces), the overall conclusion from
`summary.conclusion` directly under the title, and the check list from `plan[]`
paired with `cases[]`. So `report.md` must NOT repeat the scope block or a case
table — those double up on the page. It carries only the non-duplicate narrative
(follow-ups / this-round notes / score), rendered as the page's collapsible
"Details".

## Workflow

1. **Scaffold up front** — before running the first test step:

   ```bash
   # $SKILL_DIR = the skill's install dir
   DIR=$("$SKILL_DIR/scripts/report-init.sh" --subject topic:tpc_xxx my-slug "My title")
   ```

   The script creates the directory, pre-fills branch / commit / date in both
   files, and prints the directory path. Translate its headings and table labels to
   the user's language before delivery if needed.

2. **Collect evidence as you test** — every asserted behavior gets one evidence
   item in `$DIR/assets/`:
   - UI (static state): `agent-browser screenshot` or `capture-app-window.sh`, then
     **verify the screenshot with the Read tool before citing it** — never cite an
     image you haven't looked at.

   - UI (time-based behavior): **screenshot vs GIF is a judgment you make per
     case.** If the assertion is about change over time — streaming output, a
     ticking timer, loading/progress states, animations, appear/disappear
     transitions — a static screenshot cannot prove it. Record a frame sequence and
     synthesize a GIF:

     ```bash
     # start recording (background), trigger the behavior, wait for it to finish
     "$SKILL_DIR/scripts/record-gif.sh" "$DIR/assets/case2-streaming.gif" 12 2 &
     GIF_PID=$!
     # ... drive the scenario ...
     wait $GIF_PID
     ```

     Verify at least the first/last frames visually (Read the GIF) before citing.

   - UI (before/after comparison): capture and visually verify both original
     screenshots. Do not compose them into a new image. In the case's `evidence`
     array, pair them with a shared comparison id.

     A comparison pair means the same view in two states. Sequential steps of a
     flow are not before/after states; attach those as ordinary ordered evidence
     items with captions naming each step.

     ```json
     "evidence": [
       {
         "path": "assets/before.png",
         "comparison": { "id": "topic-row", "role": "before", "layout": "vertical", "label": "before: 11px, line-height 40px" }
       },
       {
         "path": "assets/after.png",
         "comparison": { "id": "topic-row", "role": "after", "layout": "vertical", "label": "after: 12px, line-height 44px" }
       }
     ]
     ```

     The verify page renders a complete pair with each screenshot under its own
     tinted band — red for `before`, green for `after`. A group contains exactly one
     `before` and one `after`, and **both halves need the same string `id`**; a half
     without an `id` can never pair. Incomplete groups render as ordinary evidence.

     Two fields are worth setting on every pair:

     - **`layout`** — `horizontal` (default, side by side) or `vertical` (stacked).
       A tall, narrow crop (a sidebar, a form, a list) reads well side by side; a
       **wide, short strip** (a toolbar, a one-line footer) must be `vertical`,
       because two of them in a two-column grid become illegible slivers. Set it on
       both halves.
     - **`label`** — the caption shown next to the role word in the band. This is
       where the before/after contrast is actually _stated_: put the measured delta
       on each side, so the two captions read as a comparison rather than repeating
       the case title.

   - CLI: use the dual-text evidence format below. Preserve the exact command +
     trimmed output (`<cli> <command> | tee "$DIR/assets/x-execution.txt"`) in
     the execution artifact, and attach a separate reasoning artifact.

   - Network: `agent-browser network requests` dumps or HAR files.

### Dual text evidence for non-visual behavior

For CLI, API, backend, policy, security, migration, and other non-visual
behavioral checks, one text file rarely serves both audiences well. A reviewer
needs to understand why the check is meaningful; an auditor needs the concrete
observations. Attach **two separate text artifacts** to the same case, in this
order:

1. **Reasoning evidence** (`<check>-reasoning.md`) — concise, reviewer-facing:
   - claim / behavior being verified;
   - setup or threat model;
   - action or attempted bypass;
   - explicit pass/fail criteria;
   - why the chosen observations support the verdict;
   - limitations and what remains unproven.
2. **Execution evidence** (`<check>-execution.txt` or `.md`) — audit-facing:
   - exact command, request, or probe;
   - relevant raw stdout/stderr, response body/status, exit code, filesystem or
     server-side observations;
   - a short annotation mapping each observed value to the pass/fail criteria.

The split is semantic, not cosmetic. Do not duplicate the same prose into both
files, and do not turn the execution artifact into a second high-level summary.
Trim unrelated noise, but retain values that make the outcome independently
auditable (for example exit codes, error text, file existence, response status,
or server receive counts).

```json
{
  "evidence": ["assets/write-boundary-reasoning.md", "assets/write-boundary-execution.txt"],
  "id": "write-boundary",
  "name": "approved writes succeed and escape attempts are denied",
  "observation": "control exit=0; four escape attempts exit non-zero and created no files",
  "status": "pass"
}
```

This is a hard default for non-visual behavioral claims, with two narrow
exceptions:

- a text artifact is only ancillary metadata for primary visual evidence (for
  example a screenshot plus a small DOM dump);
- the evidence is intrinsically self-explanatory and contains no behavioral
  inference (for example a generated schema file whose exact contents are the
  claim).

If a follow-up round corrects either half, publish both halves again in that
round. Every immutable round must be a self-contained decision snapshot; never
ask the reviewer to combine reasoning from an older round with execution logs
from the current one.

3. **Write `plan[]` BEFORE you run anything.** The approved plan from Step 1 is part
   of the report, not scaffolding you throw away: each item is
   `{ id, title, category, verifier, method, expected, requiredEvidence }` — what
   you will check, which requirement area it belongs to, how it is judged, how you
   will exercise it, what would make it pass, and the artifact it must produce.
   `verifier` and `requiredEvidence` are closed sets the pipeline acts on (schema
   below); `method` / `expected` are prose. `cases[]` later reuses the same `id`s,
   which is what lets the report pair intent against outcome. A planned item that
   never produces a case renders as **未执行** rather than vanishing, so cut coverage
   in the open.

4. **Fill `result.json` as you go** — it is the report. Each tested behavior is one
   entry in `cases[]` (`{ id, name, result, observation, evidence }`), where
   `evidence` is a path under `assets/`. Set the scope fields (`scenario`, `branch`,
   `commit`, `surfaces`, `entry`) and write the one-paragraph verdict into
   `summary.conclusion`. The page pairs each check with its evidence inline, so you
   don't hand-build a table. `report.md` holds only the narrative tail.

5. **Set the verdict** in both `report.md` and `result.json`. Describe key visual
   outcomes in prose; the published acceptance URL is the only visual pointer in
   the final chat reply.

6. **Publish** (SKILL.md Step 6) — upload the finished session so it's viewable on
   the verify platform, not just on disk. **Publish to PRODUCTION defaults with the
   user's real login, NOT a local-dev CLI override** — strip the local dev overrides
   so `lh` uses its production defaults. Clearing an override profile looks like:

   ```bash
   env -u LOBEHUB_SERVER -u LOBE_API_KEY -u LOBEHUB_CLI_API_KEY -u LOBEHUB_CLI_HOME \
     lh acceptance run ingest "$DIR" --source agent-testing --open --json
   ```

   This creates a new immutable verification run, attaches it to the required
   subject acceptance, uploads the cases, evidence, and report body, then prints
   `/acceptance/<acceptanceId>` plus its `?r=<roundIndex>` round-snapshot form.
   Include the full production acceptance link (never a `/verify/<id>` one) in the
   final reply alongside the local report dir — with whitespace after the URL, so
   an autolinker can't swallow adjacent CJK punctuation into the href. See SKILL.md →
   Step 6 for why production defaults (a localhost URL isn't shareable and a local
   stub storage fails file-evidence uploads), the production login check, and the
   atomic commands (`acceptance run …` (plus `… result`, `… evidence`, `… report`)).

## Report language (hard rule)

**`report.md` MUST be written in the language the user is conversing in** — the
whole file, headings included. If the conversation is in Chinese, the report is in
Chinese; do not mix English prose into it. The scaffold headings are placeholders —
translate them when filling. Exceptions that stay as-is: code/commands,
identifiers, log excerpts, and `result.json` (its keys and status values are
machine-read and stay English; the `title` and case `name` fields follow the
user's language).

## report.md sections

Default report shape (a case table doubles the page and is only for a purely
non-visual run; for UI runs, leave the case list to `result.json`):

| Section          | Content                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------- |
| **Verdict**      | Overall verdict first (`pass` / `partial` / `fail`), then concise reasons and follow-ups |
| **Verification** | Commands or automated checks run in this session, with trimmed results                   |
| **Score**        | Pass/fail/blocked counts, optional 0–100 score                                           |

Status values: `pass` / `fail` / `blocked` (couldn't run — e.g. auth or env
missing; a blocked case is not a pass).

## result.json schema

**Two fields are the report's identity in every list surface — treat them as
REQUIRED on every ingest:**

- `title` (top level) — without it the run lists as "未命名验证" forever.
- `summary.verdict` (`pass` / `fail` / `partial`) — without it the list glyph is a
  permanent amber "?" instead of the green pass. The CLI derives a fallback from the
  cases, but an explicit verdict is still the author's job.
- Every `comparison` pair side should carry a `label` — the role band renders it as
  the explanation; a pair without labels shows two bare role words and reads as
  unexplained.

```json
{
  "branch": "feat/task-tree",
  "cases": [
    {
      "category": "Task hierarchy",
      "id": "1",
      "name": "task tree returns nested children",
      "surface": "cli",
      "status": "pass",
      "observation": "root returned 3 nested children, depth 2",
      "evidence": ["assets/task-tree.txt"]
    }
  ],
  "commit": "abc1234",
  "createdAt": "2026-06-11T15:30:00+08:00",
  "interactionCost": {
    "model": "goms-klm@lobe-v1",
    "scope": "user-equivalent",
    "totalSeconds": 8.1,
    "activeSeconds": 6.1,
    "waitSeconds": 2,
    "operators": { "K": 1, "P": 2, "H": 0, "M": 2, "T_chars": 5, "R_ms": 2000 },
    "phases": []
  },
  "plan": [
    {
      "id": "1",
      "title": "task tree returns nested children",
      "category": "Task hierarchy",
      "verifier": "program",
      "method": "<cli> task list --tree against a 3-level fixture",
      "expected": "root shows 3 nested children at depth 2",
      "requiredEvidence": ["text"]
    }
  ],
  "pullRequest": {
    "number": 17152,
    "title": "feat(task): nested task tree",
    "url": "https://github.com/<org>/<repo>/pull/17152"
  },
  "summary": {
    "total": 1,
    "passed": 1,
    "failed": 0,
    "blocked": 0,
    "score": 100,
    "verdict": "pass"
  },
  "surfaces": ["cli"],
  "title": "Verify task tree API"
}
```

`plan[]` is the checks you committed to **before running them**, and it shares
`id`s with `cases[]`. Every plan item must carry a `category` that names its
user-facing business scenario or requirement area (for example `Task hierarchy`,
`Rate-limit recovery`, `Browser actions`). It must not name a technical surface such
as `Desktop`, `CLI`, or `Backend`: Acceptance groups are organized by what the user
is accepting, while `surface` separately records where the check ran. A plan item
with no matching case renders as **未执行**: cutting coverage is allowed, hiding that
you cut it is not.

Two of its fields are a **closed vocabulary**, because the pipeline acts on them —
they are not labels:

| field              | values                                                                       | what it does                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `verifier`         | `program` \| `agent` \| `llm` (default `agent`)                              | How the verdict is reached. A command-asserted check is `program`; calling it `agent` hides what actually judged it. |
| `requiredEvidence` | `screenshot` \| `gif` \| `video` \| `text` \| `dom_snapshot` \| `transcript` | The artifact this check **must** produce. The coverage gate **fails** an item whose required medium is missing.      |

An out-of-vocabulary value in either fails the ingest — an unrecognized medium
would silently gate on nothing, which is worse than no gate at all.

`method` (how you would exercise it) and `expected` (what would make it pass) stay
**free prose** — they carry intent no enum can, and both render under the check on
the page next to the outcome.

A plan item may also carry a per-item `surface` (same closed set as the run-level
`surfaces`; `electron` normalizes to `desktop`). It says which product surface THIS
check ran on. It is metadata, never an Acceptance grouping key.

`surfaces` is a **closed set** — `web` | `desktop` | `cli` | `mobile` | `bot` — and
names the product surface a check ran **on**. `electron` is accepted and normalized
to `desktop`. Anything else fails the ingest:

- A **test kind** is not a surface. `unit`, `backend`, `database`, `type-check` do
  not belong here; a backend change verified through the CLI has surface `cli`.
- A **runtime mode** is not a surface. "packaged build", "CDP dev instance" — that
  detail belongs on the plan item's `method`.

`entry` is the command or URL exercised (`<cli> task list --tree`, `/chat/settings`)
— **not** a PR title and not a description of the change.

`pullRequest` is optional: when absent, the ingest asks `gh` for the PR of `branch`
and fills it in. Write it explicitly only when the report verifies a PR that isn't
the branch's own.

`score` is optional — use it when the verdict has a subjective component (UI polish,
copy quality); omit it for purely binary runs. `verdict` is the single word the user
reads first: `pass`, `fail`, or `partial`.

`subject` identifies the business subject whose **acceptance aggregate** owns this
immutable run: either `"subject": "task:<id>"` (`task` | `topic` | `document`) or
`{ "type": "task", "id": "task_…", "requirement": "one-sentence acceptance bar" }`.
The `--subject` flag overrides this field. Inside a LobeHub conversation, both may
be omitted because `acceptance run ingest` defaults to `topic:$LOBEHUB_TOPIC_ID`; outside a
topic, an explicit subject is mandatory. Every ingest creates a new immutable run;
never update a prior run after a fix, publish the re-verification as the next round.

`interactionCost` is optional and run-level. For UI runs driven through
`agent-browser`, create `interaction-trace.jsonl` with `scripts/agent-browser-klm.mjs`,
then run `scripts/agent-browser-klm-analyze.mjs --trace "$DIR/interaction-trace.jsonl" --result "$DIR/result.json" --write`.

When published, `acceptance run ingest` maps each case onto a check result:
`name`→title, `status`/`result`→verdict, `observation`→the result's key
observation, and `evidence` paths→uploaded artifacts. `summary.{total,passed,failed,blocked}`
and `verdict` become the report's stats + overall verdict; `report.md` becomes the
report body.

## Rules

- **No evidence, no claim** — every `pass`/`fail` in `cases[]` must link at least
  one asset. UI cases must attach their primary screenshot/GIF as evidence;
  non-visual behavioral cases must attach both reasoning and execution text;
  transcripts, HAR files, and logs belong in the execution half.
- **Screenshots must be visually verified** with the Read tool before being cited.
- **Report failures faithfully** — a failing case with clear evidence is a good
  report; a vague green one is not.
- If coverage was cut (cases skipped, surfaces not exercised), say so in the Verdict
  section — silent truncation reads as "covered everything".
