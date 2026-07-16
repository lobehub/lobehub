# Structured Test Reports

Every automated test session ends with a structured, evidence-backed report.
A chat-only summary is not an acceptable deliverable: the report is what the
user (or a reviewer, or a later agent) audits without replaying the session.

## Location & layout

Reports live under `.records/reports/` (gitignored, like all `.records/`
output):

```
.records/reports/<YYYYMMDD-HHMMSS>-<slug>/
├── report.md      # narrative TAIL only (跟进 / 本轮验证 / 评分) — rendered as the page's "Details"
├── result.json    # the structured source: scenario + context + cases + summary.conclusion
└── assets/        # evidence: screenshots, HAR files, CLI transcripts
```

**`result.json` is the report — `report.md` is just its tail.** The published
verify page (`/verify/<id>`) renders itself from `result.json`: one line of
provenance (PR / branch / commit / date / surfaces), the overall conclusion from
`summary.conclusion` directly under the title, and the check list from `plan[]`
paired with `cases[]`. So `report.md` must NOT repeat the scope block or a 用例
table — those double up on the page. It carries only the non-duplicate narrative
(仍需跟进 / 本轮验证 / 评分), rendered as the page's collapsible "Details".

## Workflow

1. **Scaffold up front** — before running the first test step:

   ```bash
   DIR=$(./.agents/skills/agent-testing/scripts/report-init.sh < slug > "<title>")
   ```

   The script creates the directory, pre-fills branch / commit / date in both
   files, and prints the directory path. The scaffold uses the compact report
   shape below; translate its headings and table labels to the user's language
   before delivery if needed.

2. **Collect evidence as you test** — every asserted behavior gets one evidence
   item in `$DIR/assets/`:
   - UI (static state): `agent-browser screenshot` or `capture-app-window.sh`,
     then **verify the screenshot with the Read tool before citing it** —
     never cite an image you haven't looked at.

   - UI (time-based behavior): **screenshot vs GIF is a judgment you must
     make per case.** If the assertion is about change over time — streaming
     output, a ticking timer, loading/progress states, animations,
     appear/disappear transitions — a static screenshot cannot prove it.
     Record a frame sequence and synthesize a GIF:

     ```bash
     # start recording (background), trigger the behavior, wait for it to finish
     ../scripts/record-gif.sh "$DIR/assets/case2-streaming.gif" 12 2 &
     GIF_PID=$!
     # ... drive the scenario ...
     wait $GIF_PID
     ```

     Embed it like an image: `![case 2](assets/case2-streaming.gif)`. Verify
     at least the first/last frames visually (Read the GIF) before citing.

   - UI (before/after comparison): capture and visually verify both original
     screenshots. Do not ask the agent to compose them into a new image. In the
     case's `evidence` array, pair them with a shared comparison id.

     **A `comparison` pair means ONE view in two states** — the same surface
     before and after a change (the red/green role bands say "was / is now").
     Two sequential steps of a FLOW (a dialog, then the state after submitting
     it) are NOT a before/after: labeling them so misstates the semantics and
     reads as if the first shot were a defect. For flow steps, attach plain
     ordered evidence items and let each caption name its step:

     ```json
     "evidence": [
       {
         "path": "assets/before.png",
         "comparison": {
           "id": "topic-row",
           "role": "before",
           "layout": "vertical",
           "label": "副标题 11px，行高 40px"
         }
       },
       {
         "path": "assets/after.png",
         "comparison": {
           "id": "topic-row",
           "role": "after",
           "layout": "vertical",
           "label": "副标题 12px，行高 44px"
         }
       }
     ]
     ```

     The verify page renders a complete pair with each screenshot under its own
     tinted band — red for `before`, green for `after` — so which state you are
     looking at survives a glance. A group contains exactly one `before` and one
     `after`, and **both halves need the same string `id`**; a half without an `id`
     can never pair. Incomplete groups render as ordinary evidence.

     Two fields are worth setting on every pair:

     - **`layout`** — `horizontal` (default, side by side) or `vertical` (stacked).
       Pick by the shape of the crop: a tall, narrow capture (a sidebar, a form,
       a list) reads well side by side; a **wide, short strip** (a toolbar, a
       one-line footer) must be `vertical`, because two of them in a two-column
       grid become illegible slivers. Set it on both halves.
     - **`label`** — the caption shown next to the role word in the band. This is
       where the before/after contrast is actually _stated_: put the measured
       delta on each side (`"11px，行高 40px"` vs `"12px，行高 44px"`), so the two
       captions read as a comparison rather than repeating the case title.

   - CLI: exact command + trimmed output (`$CLI task list | tee "$DIR/assets/task-list.txt"`).

   - Network: `agent-browser network requests` dumps or HAR files.

3. **Write `plan[]` BEFORE you run anything.** The approved plan from Step 1 is
   part of the report, not scaffolding you throw away: each item is
   `{ id, title, verifier, method, expected, requiredEvidence }` — what you will
   check, how it is judged, how you will exercise it, what would make it pass,
   and the artifact it must produce. `verifier` and `requiredEvidence` are closed
   sets the pipeline acts on (see the schema below); `method` / `expected` are
   prose. `cases[]` later reuses the same `id`s, which is what lets the report
   pair intent against outcome. A planned item that never produces a case renders
   as **未执行** rather than vanishing, so cut coverage in the open — silently
   dropping a check now shows up as a hole in the report.

4. **Fill `result.json` as you go** — it is the report. Each tested behavior is
   one entry in `cases[]` (`{ id, name, result, observation, evidence }`), where
   `evidence` is a path under `assets/` (screenshot / GIF / transcript). Set the
   scope fields (`scenario: "coding"`, `branch`, `commit`, `surfaces`, `entry`)
   and write the one-paragraph verdict into `summary.conclusion`. The page pairs
   each check with its evidence inline, so you don't hand-build a table.
   `report.md` holds only the narrative tail (跟进 / 本轮验证 / 评分).

5. **Set the verdict** in both `report.md` and `result.json`, then link the
   report directory in your final answer to the user. If UI evidence exists,
   list the key screenshot/GIF links in the final chat response. Use Markdown
   link text as the evidence caption, for example:
   `[Image #1 - observed outcome](<report-dir>/assets/case1.png)`.

6. **Publish to LobeHub** (Step 4 of the skill) — upload the finished session so
   it's viewable in-app, not just on disk. **Publish to PRODUCTION
   (`app.lobehub.com`) with the user's real login, NOT the local dev CLI** —
   strip the local dev overrides so `lh` uses its production defaults:

   ```bash
   env -u LOBEHUB_SERVER -u LOBE_API_KEY -u LOBEHUB_CLI_API_KEY -u LOBEHUB_CLI_HOME \
     lh verify ingest-report "$DIR" --source agent-testing --open --json
   ```

   This creates a new immutable verification run, attaches it to the required
   subject acceptance, uploads the cases, evidence, and report body, then prints
   both `/verify/<verifyRunId>` and `/acceptance/<acceptanceId>`.
   Include that full production link in the final reply alongside the local
   report dir. See SKILL.md → Step 4 for why production (a localhost URL isn't
   shareable and a local stub S3 fails file-evidence uploads), the production
   login check, and the atomic commands (`verify run|result|evidence|report …`).

## Report language (hard rule)

**`report.md` MUST be written in the language the user is conversing in** —
the whole file, headings included. If the conversation is in Chinese, the
report is in Chinese; do not mix English prose into it. The scaffold headings
are placeholders — translate them when filling if the user is not conversing in
the scaffold language. Exceptions that stay as-is: code/commands, identifiers,
log excerpts, and `result.json` (its keys and status values are machine-read
and stay English; the `title` and case `name` fields follow the user's
language).

## report.md sections

Default report shape:

| Section          | Content                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------- |
| **Scope**        | What changed / what is being verified; branch, commit, date, surface, entry URL/page, focus  |
| **Cases**        | Compact table: `# \| Case \| Result \| Key observation \| Evidence`                          |
| **Verdict**      | Overall verdict first (`pass` / `partial` / `fail`), then the concise reasons and follow-ups |
| **Verification** | Commands or automated checks run in this session, with trimmed results                       |
| **Score**        | Pass/fail/blocked counts, optional 0–100 score                                               |

The case table is the main reading surface. Prefer one clear row per user
scenario or regression assertion, and put the screenshot/GIF directly in the
`Evidence` cell:

```markdown
| #   | Case                     | Result | Key observation                                                   | Evidence                                         |
| --- | ------------------------ | ------ | ----------------------------------------------------------------- | ------------------------------------------------ |
| 1   | Create a new page        | pass   | Title and body persisted after refresh                            | ![created page](assets/new-page-created.png)     |
| 2   | Respect requested length | fail   | Requested about 600 Chinese characters; final body was about 1286 | ![final article](assets/write-article-final.png) |
```

## Inline visual evidence

Screenshots and GIFs must be embedded so the report shows the image inline:

```markdown
![case 1 result](assets/case1-result.png)
![streaming response](assets/case2-streaming.gif)
```

Do **not** use these as the primary evidence for UI cases:

```markdown
[case 1 result](assets/case1-result.png)
assets/case1-result.png
file:///tmp/case1-result.png
```

Links are acceptable for non-visual artifacts such as CLI transcripts, HAR
files, or long logs. For videos, embed a representative screenshot/GIF inline in
the case row and link the full video as supplemental evidence.

Avoid the old wide table with separate `steps`, `expected`, and `actual`
columns unless the test is purely non-visual and truly needs that breakdown.
For UI reports, those columns make screenshot-backed reading harder. Put
procedural detail in the row's key observation only when it changes the
interpretation of the result.

Use an extra evidence/detail section only when the inline table cannot carry
the material cleanly, such as long CLI transcripts, HAR summaries, or multiple
screenshots for one case. In that situation, keep the table evidence cell as an
inline visual proof for UI cases or a concise link for non-visual artifacts,
then put the longer material under `Verification` or a brief
`Additional Evidence` section.

Status values: `pass` / `fail` / `blocked` (couldn't run — e.g. auth or env
missing; a blocked case is not a pass).

## result.json schema

**Two fields are the report's identity in every list surface — treat them as
REQUIRED on every ingest:**

- `title` (top level) — without it the run lists as "未命名验证" forever.
- `summary.verdict` (`pass` / `fail` / `partial`) — without it the list glyph is
  a permanent amber "?" instead of the green pass. The CLI now derives a
  fallback from the cases, but an explicit verdict is still the author's job.
- Every `comparison` pair side should carry a `label` — the role band renders
  it as the explanation ("优化前：清单头部被挤压…"); a pair without labels shows
  two bare role words and reads as unexplained.

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
      "verifier": "program",
      "method": "lh task list --tree against a 3-level fixture",
      "expected": "root shows 3 nested children at depth 2",
      "requiredEvidence": ["text"]
    }
  ],
  "pullRequest": {
    "number": 17152,
    "title": "feat(task): nested task tree",
    "url": "https://github.com/lobehub/lobe-chat/pull/17152"
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
`id`s with `cases[]`. Every agent-testing plan item must carry a `category` that
names its user-facing business scenario or requirement area (for example `Task
hierarchy`, `Rate-limit recovery`, or `Browser actions`). It must not name a
technical surface such as `Desktop`, `CLI`, or `Backend`: Acceptance groups are
organized by what the user is accepting, while `surface` separately records
where the check ran. A plan item with no matching case renders as **未执行**:
cutting coverage is allowed, hiding that you cut it is not.

Two of its fields are a **closed vocabulary**, because the pipeline acts on them
— they are not labels:

| field              | values                                                                       | what it does                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `verifier`         | `program` \| `agent` \| `llm` (default `agent`)                              | How the verdict is reached. A command-asserted check is `program`; calling it `agent` hides what actually judged it.       |
| `requiredEvidence` | `screenshot` \| `gif` \| `video` \| `text` \| `dom_snapshot` \| `transcript` | The artifact this check **must** produce. The executor's coverage gate **fails** an item whose required medium is missing. |

An out-of-vocabulary value in either fails the ingest — an unrecognized medium
would silently gate on nothing, which is worse than no gate at all.

`method` (how you would exercise it) and `expected` (what would make it pass)
stay **free prose** — they carry intent no enum can, and both render under the
check on the page next to the outcome.

A plan item may also carry a per-item `surface` (same closed set as the run-level
`surfaces` below; `electron` normalizes to `desktop`). It says which product
surface THIS check ran on. It is metadata, never an Acceptance grouping key. An
unknown value is warned about and dropped, never stored.

`surfaces` is a **closed set** — `web` | `desktop` | `cli` | `mobile` | `bot` —
and names the product surface a check ran **on**. `electron` is accepted and
normalized to `desktop`. Anything else fails the ingest, so don't reach for it:

- A **test kind** is not a surface. `unit`, `backend`, `database`, `type-check`
  do not belong here; a backend change verified through the CLI has surface
  `cli`.
- A **runtime mode** is not a surface. "packaged build (app.isPackaged=true)",
  "CDP dev instance" — that detail belongs on the plan item's `method`.

`entry` is the command or URL exercised (`lh task list --tree`,
`/chat/settings`) — **not** a PR title and not a description of the change.

`pullRequest` is optional: when it is absent, the ingest asks `gh` for the PR of
`branch` and fills it in. Write it explicitly only when the report verifies a PR
that isn't the branch's own.

`score` is optional — use it when the verdict has a subjective component (UI
polish, copy quality); omit it for purely binary runs. `verdict` is the single
word the user reads first: `pass`, `fail`, or `partial`.

`subject` identifies the business subject whose **acceptance aggregate** owns
this immutable run: either
`"subject": "task:<id>"` (`task` | `topic` | `document`) or
`{ "type": "task", "id": "task_…", "requirement": "one-sentence acceptance bar" }`.
The `--subject` flag overrides this field. Inside a LobeHub conversation, both
may be omitted because `ingest-report` defaults to
`topic:$LOBEHUB_TOPIC_ID`; outside a topic, an explicit subject is mandatory.
Every ingest creates a new immutable run. Never update a prior run after a fix;
publish the re-verification as the next round on the same acceptance.

`interactionCost` is optional and run-level. For UI runs driven through
`agent-browser`, create `interaction-trace.jsonl` with
`scripts/agent-browser-klm.mjs`, then run
`scripts/agent-browser-klm-analyze.mjs --trace "$DIR/interaction-trace.jsonl" --result "$DIR/result.json" --write`. The summary is a user-equivalent GOMS-KLM
estimate: physical browser actions are derived from agent-browser commands,
while mental operators (`M`) are explicit agent estimates recorded with the
wrapper's `mental` subcommand.

When published (Step 4), `verify ingest-report` maps each case onto a check
result: `name`→title, `status`/`result`→verdict, `observation` (or
`keyObservation`)→the result's key observation, and `evidence` paths→uploaded
artifacts. `summary.{total,passed,failed,blocked}` and `verdict` become the
report's stats + overall verdict; `report.md` becomes the report body.

## Rules

- **No evidence, no claim** — every `pass`/`fail` in the case table must link
  at least one asset. UI cases must inline-embed their primary screenshot/GIF;
  non-visual CLI/network cases may link transcripts, HAR files, or logs.
- **Screenshots must be visually verified** with the Read tool before being
  cited.
- **Report failures faithfully** — a failing case with clear evidence is a good
  report; a vague green one is not.
- If coverage was cut (cases skipped, surfaces not exercised), say so in the
  Verdict section — silent truncation reads as "covered everything".
