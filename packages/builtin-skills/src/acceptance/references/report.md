# Structured Report Rounds (`lh acceptance run ingest`)

Per-criterion `result submit` (SKILL.md Step 3) assumes a verify plan already
exists. When it doesn't — a standalone delivery, a task run without
`$LOBE_OPERATION_ID`, or any run where **you** author the checks — publish a
**structured report round** instead: a self-contained directory that
`lh acceptance run ingest` uploads as one immutable verification round. The
verify page renders itself from `result.json`: provenance, the overall
conclusion, and the check list from `plan[]` paired with `cases[]`, each with
its evidence inline — **images render as figures, before/after pairs render
under tinted comparison bands**. A chat-only summary or a bare markdown report
never gets that rendering; the structured round does.

Rule of thumb: **plan exists → per-criterion submit; you author the checks →
structured round ingest.** Never mix both for the same delivery round.

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
   `{ id, title, category, verifier, method, expected, requiredEvidence }`.
   A planned item that never produces a case renders as **未执行** rather than
   vanishing — cut coverage in the open.
2. **Collect evidence into `assets/` as you test.** Screenshots/charts must be
   **visually verified with the Read tool before being cited** — never cite an
   image you haven't looked at. Numeric results worth seeing (loss curves,
   latency distributions) should ship as a rendered chart image, not only a
   table of digits.
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
   lh acceptance run ingest <report-dir> --subject topic:tpc_xxx --source agent-testing --json
   ```

   Inside a LobeHub topic `--subject` may be omitted (defaults to the current
   topic); outside one it is mandatory (`task:` | `topic:` | `document:`). The
   command creates a new immutable round, uploads cases + evidence + report
   body, and prints `/verify/<verifyRunId>` and `/acceptance/<acceptanceId>` —
   include the full URLs in your final reply. Never update a prior round after
   a fix; publish the re-verification as the next round.

## result.json schema

```json
{
  "title": "Verify task tree API",
  "createdAt": "2026-06-11T15:30:00+08:00",
  "surfaces": ["cli"],
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
  "cases": [
    {
      "id": "1",
      "category": "Task hierarchy",
      "name": "task tree returns nested children",
      "surface": "cli",
      "status": "pass",
      "observation": "root returned 3 nested children, depth 2",
      "evidence": ["assets/task-tree.txt"]
    }
  ],
  "summary": {
    "total": 1, "passed": 1, "failed": 0, "blocked": 0,
    "verdict": "pass",
    "conclusion": "One-paragraph verdict the page shows under the title."
  }
}
```

Optional fields: `branch` / `commit` / `pullRequest` (provenance line; when
`branch` is set without `pullRequest`, ingest asks `gh` for the PR),
`summary.score` (0–100, only when the verdict has a subjective component),
`subject` (usually passed via `--subject` instead).

### Closed vocabularies — the pipeline acts on these, they are not labels

| field | values | what it does |
| --- | --- | --- |
| `verifier` | `program` \| `agent` \| `llm` (default `agent`) | How the verdict is reached. A command-asserted check is `program`; calling it `agent` hides what actually judged it. |
| `requiredEvidence` | `screenshot` \| `gif` \| `video` \| `text` \| `dom_snapshot` \| `transcript` | The artifact this check **must** produce. The coverage gate **fails** an item whose required medium is missing. |
| `surfaces` / per-case `surface` | `web` \| `desktop` \| `cli` \| `mobile` \| `bot` (`electron` → `desktop`) | The product surface a check ran **on**. A test kind (`unit`, `backend`) or runtime mode is not a surface. |

`category` names the user-facing requirement area (e.g. `Task hierarchy`,
`Rate-limit recovery`) — never a technical surface. `method` / `expected` stay
free prose; they render under the check next to the outcome.

### Before/after comparison pairs

The page renders a complete pair under tinted bands (red `before`, green
`after`). Both halves need the same string `id`; set `layout`
(`horizontal` default; `vertical` for wide, short strips) and a `label` stating
the measured delta on each side:

```json
"evidence": [
  { "path": "assets/before.png",
    "comparison": { "id": "topic-row", "role": "before", "layout": "vertical", "label": "before: 11px" } },
  { "path": "assets/after.png",
    "comparison": { "id": "topic-row", "role": "after", "layout": "vertical", "label": "after: 12px" } }
]
```

A comparison pair means the same view in two states — sequential steps of a
flow are ordinary ordered evidence with captions, not a pair.

## Rules

- **No evidence, no claim** — every `pass`/`fail` in `cases[]` links at least
  one asset.
- **Report failures faithfully** — a failing case with clear evidence is a good
  report; a vague green one is not.
- If coverage was cut, say so in `report.md` — silent truncation reads as
  "covered everything".
