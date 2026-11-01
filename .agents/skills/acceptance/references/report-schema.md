# Report payload schema

Read only the needed section when the installed CLI does not expose its payload
schema. Command syntax and supported flags come from the CLI help, not this file.
Acquire a schema section once per version and reuse it for all cases.

## Minimal round payload

Every `cases[].evidence` file entry must use `{ "path": "...", "description": "..." }`.
Describe the file's contents and relevance to the criterion, following the
[shared description requirements](evidence.md#file-versus-inline-content).
Do not copy the legacy bare-path form: ingestion accepts it for compatibility,
but its filename fallback does not satisfy the description requirement.

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
      "evidence": [
        {
          "path": "assets/task-tree.txt",
          "description": "Task tree command output showing the root and its 3 nested children at depth 2."
        }
      ]
    },
    {
      "id": "2",
      "category": "Model quality",
      "name": "candidate model improves average precision",
      "surface": "cli",
      "status": "pass",
      "observation": "average precision improved from 0.742 to 0.796",
      "evidence": [
        {
          "path": "assets/evaluation.json",
          "description": "Evaluation results comparing baseline and candidate average precision, including the observed change from 0.742 to 0.796."
        }
      ],
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
    },
    {
      "id": "2",
      "title": "candidate model improves average precision",
      "category": "Model quality",
      "verifier": "program",
      "method": "Evaluate the baseline and candidate on the same held-out dataset",
      "expected": "candidate average precision exceeds the baseline",
      "requiredEvidence": ["text"]
    }
  ],
  "summary": {
    "total": 2,
    "passed": 2,
    "failed": 0,
    "blocked": 0,
    "verdict": "pass",
    "conclusion": "Both checks passed: the task tree returned the expected hierarchy, and the candidate model improved average precision from 0.742 to 0.796."
  },
  "surfaces": ["cli"],
  "title": "Verify task hierarchy and model quality"
}
```

Optional fields: `branch` / `commit` / `pullRequest` (provenance line; when
`branch` is set without `pullRequest`, ingest asks `gh` for the PR),
`summary.score` (0–100, only when the verdict has a subjective component),
`subject` (usually passed via `--subject` instead).

## Structured visualizations

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

One shape for every renderer — `id`, `type`, `version: 1`, `dataset`, and an
`encoding` whose field names are keys of that dataset (see the `line-chart`
below; the other types differ only in the encoding keys listed above):

```json
{
  "dataset": "training",
  "encoding": {
    "x": "step",
    "series": [
      { "field": "baselineLoss", "label": "Baseline", "style": "muted" },
      { "field": "candidateLoss", "label": "Candidate", "style": "primary" }
    ],
    "xLabel": "Step",
    "yLabel": "Loss"
  },
  "id": "loss-over-time",
  "type": "line-chart",
  "version": 1
}
```

Dataset field `type` is one of `boolean`, `category`, `number`, `string`, or
`temporal`; field keys and dataset/view ids must be unique. Rows may contain only
declared keys with string, number, boolean, or null values. The combined inline
row limit is 10,000.

