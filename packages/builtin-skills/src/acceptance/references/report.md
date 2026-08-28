# Structured Report Rounds (`lh acceptance run ingest`)

Per-criterion `result submit` (SKILL.md Step 3) assumes a verify plan already
exists. When it doesn't — a standalone delivery, a task run without
`$LOBE_OPERATION_ID`, or any run where **you** author the checks — publish a
**structured report round** instead: a self-contained directory that
`lh acceptance run ingest` uploads as one immutable verification round. The
acceptance page renders itself from `result.json`: provenance, the overall
conclusion, and the check list from `plan[]` paired with `cases[]`, each with
its evidence inline — **images render as figures, before/after pairs render
under tinted comparison bands**. A chat-only summary or a bare markdown report
never gets that rendering; the structured round does.

## Contents

- [No operation ID needed](#no-operation-id-needed)
- [Immutable rounds](#rounds-are-immutable)
- [Directory layout](#directory-layout)
- [Workflow](#workflow)
- [result.json schema](#resultjson-schema)
- [Rules](#rules)

Rule of thumb: **plan exists → per-criterion submit; you author the checks →
structured round ingest.** Never mix both for the same delivery round.

## No operation id needed

`--operation` is optional on every command in this skill. Without one, author
the checks and use one of these first-class paths:

```bash
REPORT_DIR=./acceptance-report

# A. first external-project round — creates a standalone acceptance automatically
lh acceptance run ingest "$REPORT_DIR" \
  --requirement "<one-sentence business goal>" --json

# Re-verification — append a new immutable round to the same acceptance
lh acceptance run ingest "$REPORT_DIR" --acceptance "$ACCEPTANCE_ID" --json

# Existing LobeHub subject — group by a Task, Topic, or Document
lh acceptance run ingest "$REPORT_DIR" --subject topic:tpc_xxx --json

# B. atomic fallback — create the round first, then submit into it with --run
RUN=$(lh acceptance run create --title "…" --goal "…" --json | jq -r .id)
lh acceptance run result submit --run "$RUN" --item "$CHECK_ITEM_ID" …
```

Prefer **A**: per-criterion submits without a plan produce checks with no
declared intent, so the page has nothing to pair the outcome against.

## Rounds are immutable

Each ingest creates a **new** round. After fixing something, never edit or
re-submit into the previous round to make it look green — publish the
re-verification as the next round. The acceptance
(`/acceptance/<acceptanceId>`) aggregates the rounds in order, so the repair
history is the point, not something to hide. Reuse the same `--subject` across
rounds for a LobeHub object, or pass `--acceptance <acceptanceId>` after an
external project's first standalone round.

Before composing a repair round, read the aggregate:

```bash
lh acceptance view "$ACCEPTANCE_ID" --json
```

- Omit checks whose latest `userReview.action` is `accept` unless the repair can
  regress them.
- Address non-stale rejects and reuse their exact stable check ids.
- A semantic replacement declares `supersedes: ["old-id"]`; every later round
  reusing the successor id repeats its full `supersedes` chain.

## Directory layout

Any directory works — no repo convention required:

```
<report-dir>/
├── result.json     # THE report — the page renders from this
├── report.md       # narrative tail only (verdict notes, follow-ups, score)
└── assets/         # evidence files referenced from cases[].evidence
```

## Workflow

1. **Write `plan[]` BEFORE you run anything.** Each item is
   `{ id, title, category, verifier, method, expected, requiredEvidence,
supersedes? }`.
   A planned item that never produces a case renders as **未执行** rather than
   vanishing — cut coverage in the open.
   **HARD RULE: every item must be an outcome the reader can judge.** Never
   plan a programmatic gate (tests / type-check / lint / build) as a check —
   ingest drops them, and a gates-only round fails to publish. See
   [what is not an acceptance check](#hard-rule--what-is-not-an-acceptance-check).
2. **Collect evidence into `assets/` as you test.** Screenshots must be
   **visually verified with the Read tool before being cited** — never cite an
   image you haven't looked at. For metrics, time series, model or benchmark
   comparisons, distributions, matrices, and tables, use native Acceptance
   structured visualizations: put review-sized values in `cases[].datasets`,
   declare the view in `cases[].visualizations`, and retain the raw CSV/JSON,
   benchmark output, trace, profile, or vectors in `evidence`. Do not generate a
   PNG/GIF when a supported renderer can faithfully express the data. See
   [Structured visualizations](#structured-visualizations).
3. **Fill `cases[]` as you go** — one entry per tested behavior
   (`{ id, name, category, surface, status, observation, evidence }`), reusing
   the plan item's `id`. `status`: `pass` / `fail` / `blocked` (couldn't run —
   a blocked case is not a pass).
4. **Set `title` and `summary.verdict`** (`pass` / `fail` / `partial`) — without
   them the run lists as "未命名验证" with a permanent amber "?" glyph. Write the
   one-paragraph verdict into `summary.conclusion`.
5. **`report.md` is the narrative tail only** — this-round notes, follow-ups,
   score. Do NOT repeat the scope block or a case table; those double up on the
   page. Write it in the language the user is conversing in.
6. **Publish:**

   ```bash
   lh acceptance run ingest "$REPORT_DIR" --source agent-testing --json
   ```

   On the first ingest, add `--requirement "<one-sentence business goal>"`.
   Describe the durable goal of the whole acceptance, not this round's narrower
   implementation scope.

   Inside a LobeHub topic, the command groups the round under the current topic.
   Outside one, it creates a standalone acceptance automatically; no Task ID is
   required. To publish a repair into that same history, add
   `--acceptance <acceptanceId>` using the ID printed by the first ingest. The
   command uploads cases + evidence + report body and prints
   `/acceptance/<acceptanceId>` plus its `?r=<roundIndex>` snapshot form. Include
   only the full acceptance URL in your final reply; never expose local paths or
   internal run-page paths. Never update a prior round after a fix; publish the
   re-verification as the next round.

## result.json schema

```json
{
  "cases": [
    {
      "id": "1",
      "category": "Task hierarchy",
      "name": "task tree returns nested children",
      "surface": "cli",
      "status": "pass",
      "observation": "root returned 3 nested children, depth 2",
      "evidence": ["assets/task-tree.txt"]
    },
    {
      "id": "2",
      "category": "Model quality",
      "name": "candidate model improves average precision",
      "surface": "cli",
      "status": "pass",
      "observation": "average precision improved from 0.742 to 0.796",
      "evidence": ["assets/evaluation.json"],
      "datasets": [
        {
          "id": "model-metrics",
          "fields": [
            { "key": "metric", "type": "string" },
            { "key": "baseline", "type": "number" },
            { "key": "candidate", "type": "number" }
          ],
          "rows": [{ "metric": "Average precision", "baseline": 0.742, "candidate": 0.796 }]
        }
      ],
      "visualizations": [
        {
          "id": "model-comparison",
          "type": "metric-comparison",
          "version": 1,
          "dataset": "model-metrics",
          "title": "Model quality comparison",
          "encoding": {
            "label": "metric",
            "before": "baseline",
            "after": "candidate"
          }
        }
      ]
    }
  ],
  "createdAt": "2026-06-11T15:30:00+08:00",
  "entry": "<cli> task list --tree",
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
  "summary": {
    "total": 1,
    "passed": 1,
    "failed": 0,
    "blocked": 0,
    "verdict": "pass",
    "conclusion": "One-paragraph verdict the page shows under the title."
  },
  "surfaces": ["cli"],
  "title": "Verify task tree API"
}
```

Optional fields: `branch` / `commit` / `pullRequest` (provenance line; when
`branch` is set without `pullRequest`, ingest asks `gh` for the PR),
`summary.score` (0–100, only when the verdict has a subjective component),
`subject` (usually passed via `--subject` instead).

### Structured visualizations

A case containing reviewable structured data should provide `datasets[]` plus
`visualizations[]`. Supported version-1 renderers are `metric-comparison`,
`line-chart`, `bar-chart`, `scatter-plot`, `heatmap`, and `table`. Each
visualization references one dataset by `id` and maps declared fields through
`encoding`.

Inline datasets use declared `fields[]` and object `rows[]`; keep them to a
review-sized summary. Retain raw benchmark results, CSV/JSON, traces, profiles,
and vectors in `evidence`: the visualization is a decision aid, not a replacement
for the audit trail. Do not merely upload a data file and expect Acceptance to
infer a chart; declare both the dataset and visualization explicitly.

Native renderers are the default because they preserve machine-readable values,
accessibility, theme adaptation, and consistent comparison semantics. Generate a
static chart only when none of the supported renderers can faithfully represent
the result, and explain that limitation in the case observation.

Every visualization requires unique non-empty `id`, `type`, `dataset`, and
`version: 1`; `dataset` must reference a declared dataset id. `title` and
`context` are optional non-empty strings. Every encoding field name below must
reference a field declared by that dataset.

| Renderer            | Required encoding                                              | Optional encoding                                                                         |
| ------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `metric-comparison` | `label`, `before`, `after`                                     | `beforeSamples`, `afterSamples`, `direction`, `statistic`, `target`, `unit`               |
| `line-chart`        | `x`, non-empty `series[]`; each series requires `field`        | series `label`, series `style` (`muted` \| `primary` \| `accent`), `xLabel`, `yLabel`     |
| `bar-chart`         | `category`, non-empty `series[]`; each series requires `field` | series `label`, `valueLabel`                                                              |
| `scatter-plot`      | `x`, `y`                                                       | `color`, `label`, `xLabel`, `yLabel`                                                      |
| `heatmap`           | `x`, `y`, `value`                                              | none                                                                                      |
| `table`             | none; `encoding` itself may be omitted                         | non-empty `columns[]`; `highlights[]` entries require `field` and `mode` (`min` \| `max`) |

Minimal valid encoding examples (replace every field-name string with a key
declared in the referenced dataset):

```json
[
  {
    "id": "quality-delta",
    "type": "metric-comparison",
    "version": 1,
    "dataset": "metrics",
    "encoding": { "label": "metric", "before": "baseline", "after": "candidate" }
  },
  {
    "id": "loss-over-time",
    "type": "line-chart",
    "version": 1,
    "dataset": "training",
    "encoding": {
      "x": "step",
      "series": [
        { "field": "baselineLoss", "label": "Baseline", "style": "muted" },
        { "field": "candidateLoss", "label": "Candidate", "style": "primary" }
      ],
      "xLabel": "Step",
      "yLabel": "Loss"
    }
  },
  {
    "id": "scores-by-model",
    "type": "bar-chart",
    "version": 1,
    "dataset": "scores",
    "encoding": {
      "category": "model",
      "series": [{ "field": "score", "label": "Score" }],
      "valueLabel": "Accuracy"
    }
  },
  {
    "id": "latency-quality",
    "type": "scatter-plot",
    "version": 1,
    "dataset": "runs",
    "encoding": {
      "x": "latency",
      "y": "quality",
      "color": "model",
      "label": "run",
      "xLabel": "Latency (ms)",
      "yLabel": "Quality"
    }
  },
  {
    "id": "error-matrix",
    "type": "heatmap",
    "version": 1,
    "dataset": "errors",
    "encoding": { "x": "predicted", "y": "actual", "value": "count" }
  },
  {
    "id": "benchmark-table",
    "type": "table",
    "version": 1,
    "dataset": "benchmarks",
    "encoding": {
      "columns": ["model", "latency", "score"],
      "highlights": [
        { "field": "latency", "mode": "min" },
        { "field": "score", "mode": "max" }
      ]
    }
  }
]
```

Dataset field `type` is one of `boolean`, `category`, `number`, `string`, or
`temporal`; field keys and dataset/view ids must be unique. Rows may contain only
declared keys with string, number, boolean, or null values. The combined inline
row limit is 10,000.

### Closed vocabularies — the pipeline acts on these, they are not labels

| field                           | values                                                                                                | what it does                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `verifier`                      | `program` \| `agent` \| `llm` (default `agent`)                                                       | How the verdict is reached. A command-asserted check is `program`; calling it `agent` hides what actually judged it. |
| `requiredEvidence`              | `screenshot` \| `gif` \| `video` \| `audio` \| `text` \| `markdown` \| `dom_snapshot` \| `transcript` | The artifact this check **must** produce. The coverage gate **fails** an item whose required medium is missing.      |
| `surfaces` / per-case `surface` | `web` \| `desktop` \| `cli` \| `mobile` \| `bot` (`electron` → `desktop`)                             | The product surface a check ran **on**. A test kind (`unit`, `backend`) or runtime mode is not a surface.            |

`category` names the user-facing requirement area (e.g. `Task hierarchy`,
`Rate-limit recovery`) — never a technical surface. `method` / `expected` stay
free prose; they render under the check next to the outcome.

### HARD RULE — what is not an acceptance check

An acceptance check is something a **person decides about the delivery**. The
repo's own automated gates are not that, and they are actively harmful on the
page: twenty green "unit tests pass" rows bury the two checks that actually
needed someone to look.

**These MUST NOT appear as `plan[]` / `cases[]` items, under any phrasing:**

| Not a check                                                | Where it belongs                                     |
| ---------------------------------------------------------- | ---------------------------------------------------- |
| Unit / integration / regression / snapshot tests, coverage | one line in `report.md` → **Verification**           |
| `type-check`, `tsc`, `eslint`, lint, format, a clean build | same — a precondition of shipping, not a deliverable |
| "the test suite is green", "CI passes"                     | same                                                 |

This is enforced, not advisory. `lh acceptance run ingest` **drops every
matching item** — matched on title, category, AND `method`, so writing
"run `bun run test`" into `method` under a product-sounding title still
matches — warns with the dropped ids, and recounts `summary` from the checks
that remain. A round consisting **only** of such checks **fails to publish**.
Either way, a gate written as a check is effort spent proving something nobody
accepts: apply the rule at plan time, before the first case runs.

The line is the _subject_ of the check, not who judged it: a CLI behavior check
asserted by a command is a fine acceptance item (`verifier: "program"`). "Run
`bun run test`" is not.

**What IS an acceptance check:** what the user sees, hears, reads, or receives —
a rendered screen, a produced file, an API response shape a client depends on,
an audio clip that actually plays, a failure state that recovers.

### Before/after comparison pairs

The page renders a complete pair under tinted bands (red `before`, green
`after`). Both halves need the same string `id`; use `layout: "horizontal"` for
a left/right comparison and `layout: "vertical"` for a top/bottom comparison.
When omitted, `layout` defaults to `horizontal`. Add a `label` stating the
measured delta on each side:

```json
"evidence": [
  { "path": "assets/before.png",
    "comparison": { "id": "topic-row", "role": "before", "layout": "horizontal", "label": "before: 11px" } },
  { "path": "assets/after.png",
    "comparison": { "id": "topic-row", "role": "after", "layout": "horizontal", "label": "after: 12px" } }
]
```

Choose the layout by comparison intent, not by the source image dimensions:

- `horizontal` — before on the left, after on the right. Use it when the reader
  should compare the same region across two versions at a glance. This is the
  normal choice for full-page or full-window before/after screenshots.
- `vertical` — before on top, after below. Use it when preserving each image's
  full width matters more than simultaneous scanning, such as a very wide,
  shallow toolbar or timeline strip.

A comparison pair means the same view in two states — sequential steps of a
flow are ordinary ordered evidence with captions, not a pair.

## Rules

- **No evidence, no claim** — every `pass`/`fail` in `cases[]` links at least
  one asset.
- **Non-visual behavioral claims need dual text evidence** — attach a concise
  reviewer-facing reasoning document and a separate audit-facing execution
  artifact containing the exact command/request and observed values. Neither
  unsupported prose nor an unexplained log dump is sufficient.
- **Final handoff exposes only Acceptance** — use `/acceptance/<acceptanceId>` or
  its `?r=<roundIndex>` snapshot. Never include images, local paths, local file
  links, or internal run-page paths in chat.
- **Report failures faithfully** — a failing case with clear evidence is a good
  report; a vague green one is not.
- If coverage was cut, say so in `report.md` — silent truncation reads as
  "covered everything".
