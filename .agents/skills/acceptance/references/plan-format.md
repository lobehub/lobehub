# Plan-driven rounds — read the plan, capture, ingest into its round

Use this path only when the invocation handed you an operation id: a verify plan
already exists and its round is waiting. Operation plans live on LobeHub, so this
path always publishes — it has no local render. Everything except where the checks come
from and where the round lands is the authored path in [report.md](./report.md):
the same `new_round` directory, `result.json`, `proposal.md`, assets, and capture
discipline — surface guides, recordings with [chapters](./video-chapters.md),
before/after pairs, screenshots inspected by their designated owner. Never mix this path with an
authored ingest for one round.

## Read the frozen plan — `lh acceptance plan state`

A CLI that predates `lh acceptance plan` has the same command as
`lh verify plan state`.

Use the CLI's plan-state help to read the supplied operation's frozen plan.
Keep its check item IDs, definitions, required flags and evidence declarations
unchanged. `verifyPlan[].id` is the stable check-item key; `index` is display
ordering. `verifierConfig.requiredEvidence` declares `{ type, hint }` requirements;
empty means that criterion is judged on deliverable text. Reuse an acquired
plan state instead of querying it again to learn the response shape.

## Write the round against the frozen plan

Allocate the round under the subject the invocation named (`task-T-12`, or the
operation when there is none) and copy each frozen item into `plan[]` unchanged,
so the local report reads the same as the page:

```bash
REPORT_DIR=$(new_round "task-$TASK_IDENTIFIER" plan-round)
```

| Field in `result.json` | From the frozen plan                                                          |
| ---------------------- | ----------------------------------------------------------------------------- |
| `plan[].id`            | `verifyPlan[].id` — verbatim                                                  |
| `plan[].title`         | `verifyPlan[].title`                                                          |
| `requiredEvidence`     | `verifyPlan[].verifierConfig.requiredEvidence[].type`                         |
| `cases[].id`           | the `verifyPlan[].id` the case proves — ingest rejects any id outside the plan |

Then pick the surface for each item and capture into `$REPORT_DIR/assets/`
exactly as an authored round does. Every recording gets its chapters while you
drive it; each case's `observation` says what you saw. Leave `status` honest —
it is your record, not the verdict.

Only items with a non-empty `requiredEvidence` need an artifact; the rest are
judged on the deliverable text — don't fabricate evidence for them. The `hint`
usually implies the surface (SKILL.md, Pick the surface).

Apply [acceptance-checker.md](acceptance-checker.md) before execution and at final handoff
of the first round; follow-up rounds have no acceptance-checker. Preserve frozen check IDs;
report coverage gaps instead of silently changing the supplied plan. The
acceptance-checker's review does not replace the configured verifier or authorize
overriding its verdict.

## Publish into the operation's round

```bash
lh acceptance run ingest "$REPORT_DIR" --operation "$OPERATION_ID" --json
```

With `--operation`, ingest finds the round the operation already owns and writes
into it — it never creates another round or acceptance. It attaches every case's
evidence (chapters, comparisons and captions included) to that round's rows and
posts `proposal.md`. It publishes no verdicts and no `report.md`: the round's
verifier judges every item and writes the report when it settles, so put your
narrative in the final response.

Read the JSON: `mode` is `plan-round`; `missingEvidence`, `failedEvidence` and
`unexecuted` must be empty. A case id outside the plan fails before anything is
written and lists the valid ids.

An older CLI without plan-round ingest fails on `--operation` with a duplicate
run error — check first: `lh acceptance run ingest --help` describes
`--operation` as publishing into the run's existing round. Without it, submit
each artifact with `result submit` (below), chapters included.

## Supplement one artifact

A single missing or failed artifact — a retry, or a verifier asking for one more
capture — goes in with `result submit`, not a second ingest (re-ingesting
duplicates every artifact):

Discover the result-submission syntax from its help. Preserve the supplied
operation and check-item IDs, artifact type/path, caption and video chapters.

It resolves the round from the operation id, creates the check-result row on
first use (idempotent on `checkItemId`), and rejects a malformed chapter or
chapters on a non-video before uploading. Add the artifact to the case's
`evidence` in `result.json` too, so the local round stays the full record.
Leave `--verdict` off unless the task explicitly asks you to self-assert.

## Self-check coverage (do not skip)

Ingest's `missingEvidence` is the first check. To read the round back, map each
`checkItemId` to its `checkResultId` and list that row's evidence:

Discover the result/evidence read commands from their help only if needed.
Join each result's `checkItemId` to its `checkResultId`, then inspect its evidence.
Use complete already acquired publication results when they establish coverage;
query only missing rows or changed evidence, rather than rereading every result.

Coverage rule: for each required criterion, **every** `requiredEvidence[].type`
appears at least once in its evidence list, and every video has chapters. A gap →
capture and supplement it; then hand off per SKILL.md (acceptance URL +
`coverage: n/n`).

## Resolve the plan round's handoff links

`ingest --operation --json` returns `acceptanceUrl`; copy it. Some plans need no evidence at all, and an older CLI's `result submit --json` returns only an internal `url`. In those cases, resolve
the supplied operation ID with `lh acceptance plan state <operationId> --json`, then
read its `verifyRunId` using `lh acceptance run get <runId> --json`. The run's
`acceptanceId` and `roundIndex` identify the existing handoff; do not substitute a
result ID, subject ID, or the most recent round from another acceptance.

Reuse acquired operation/run facts before querying anything. If the CLI cannot
return the acceptance URL directly, read
[the legacy read-only lookup](legacy-plan-handoff.md) only for that compatibility
case. Preserve the existing server, account, workspace and operation/run association.
No publishing, replacement acceptance or duplicate round may be used to obtain a link.
