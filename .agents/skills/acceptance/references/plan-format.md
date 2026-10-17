# Plan-driven rounds — read the plan, capture, ingest into its round

Use this path only when the invocation handed you an operation id: a verify plan
already exists and its round is waiting. Everything except where the checks come
from and where the round lands is the authored path in [report.md](./report.md):
the same `new_round` directory, `result.json`, `proposal.md`, assets, and capture
discipline — surface guides, recordings with [chapters](./video-chapters.md),
before/after pairs, screenshots you looked at. Never mix this path with an
authored ingest for one round.

## Read the frozen plan — `lh verify plan state $OPERATION_ID --json`

Returns the run's verify state plus the **frozen plan** (immutable once
confirmed):

```jsonc
{
  "verifyStatus": "planned",
  "verifyPlanConfirmedAt": "2026-06-21T07:00:00.000Z",
  "verifyPlan": [
    {
      "id": "vci_a1b2c3", // checkItemId — the stable join key
      "index": 0,
      "title": "Login flow reaches the workspace",
      "description": "After sign-in the home renders the workspace switcher",
      "required": true, // true ⇒ blocks delivery if unproven
      "verifierType": "llm",
      "verifierConfig": {
        "requiredEvidence": [
          // the artifacts you MUST capture
          { "type": "screenshot", "hint": "logged-in home with workspace switcher" },
        ],
      },
    },
  ],
}
```

- `verifyPlan[].id` is the **checkItemId** — never use `index` as a key, it is
  display ordering only.
- `verifyPlan[].verifierConfig.requiredEvidence` is the list of `{ type, hint }`
  you must satisfy. Absent or empty ⇒ this criterion is judged on text alone.
- `hint` is guidance for what the artifact should show — it is not validated, but
  follow it so the reviewer can recognize the proof.

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

```bash
lh acceptance run result submit --operation "$OPERATION_ID" --item vci_a1b2c3 --type video \
  --file "$REPORT_DIR/assets/reload.mp4" --chapters "$REPORT_DIR/assets/reload.chapters.json" \
  --by cdp --desc "…"
```

It resolves the round from the operation id, creates the check-result row on
first use (idempotent on `checkItemId`), and rejects a malformed chapter or
chapters on a non-video before uploading. Add the artifact to the case's
`evidence` in `result.json` too, so the local round stays the full record.
Leave `--verdict` off unless the task explicitly asks you to self-assert.

## Self-check coverage (do not skip)

Ingest's `missingEvidence` is the first check. To read the round back, map each
`checkItemId` to its `checkResultId` and list that row's evidence:

```jsonc
// lh acceptance run result list --operation "$OP" --json
[
  {
    "id": "vcr_x9y8z7", // checkResultId
    "checkItemId": "vci_a1b2c3", // joins back to verifyPlan[].id
    "status": "pending",
  },
]
```

```bash
lh acceptance run evidence list "$CHECK_RESULT_ID" --json # each required type present; videos carry metadata.chapters
```

Coverage rule: for each required criterion, **every** `requiredEvidence[].type`
appears at least once in its evidence list, and every video has chapters. A gap →
capture and supplement it; then hand off per SKILL.md (acceptance URL +
`coverage: n/n`).

## Resolve the plan round's handoff links

`ingest --operation --json` returns `acceptanceUrl`; copy it. Some plans need no evidence at all, and an older CLI's `result submit --json` returns only an internal `url`. In those cases, resolve
the supplied operation ID with `lh verify plan state <operationId> --json`, then
read its `verifyRunId` using `lh acceptance run get <runId> --json`. The run's
`acceptanceId` and `roundIndex` identify the existing handoff; do not substitute a
result ID, subject ID, or the most recent round from another acceptance.

Keep the same CLI server, account, and workspace as the verification. This example
reads the resolved server from `lh doctor --offline --json` (`endpoints.resolution`
check, `evidence.serverUrl`). Cloud browser links use `https://lobehub.com`;
self-hosted and development origins retain their hosts and ports. Doctor may exit
nonzero for unrelated diagnostics while still returning this field; only a valid
endpoint result is used. No repair, network doctor probe, or remote write is requested.
The example requires Node.js and the existing CLI commands, not a new CLI release:

```bash
node - "$OPERATION_ID" <<'NODE'
const { execFileSync, spawnSync } = require('node:child_process');
const operationId = process.argv[2];
if (!operationId) throw new Error('Handoff blocked: the invocation must supply an operation ID.');
const doctor = spawnSync('lh', ['doctor', '--offline', '--json'], { encoding: 'utf8' });
if (doctor.error) throw doctor.error;
const endpoint = JSON.parse(doctor.stdout).checks?.find((check) => check.id === 'endpoints.resolution');
if (!['ok', 'warn'].includes(endpoint?.status) || !endpoint.evidence?.serverUrl) {
  throw new Error('Handoff blocked: the CLI did not resolve its server URL.');
}
const server = new URL(endpoint.evidence.serverUrl);
const isCloud = server.hostname === 'lobehub.com' || server.hostname.endsWith('.lobehub.com');
const origin = isCloud ? 'https://lobehub.com' : server.origin;
const query = (...args) => JSON.parse(execFileSync('lh', [...args, '--json'], { encoding: 'utf8' }));
const state = query('verify', 'plan', 'state', operationId);
const runId = state?.verifyRunId;
if (!runId) throw new Error('Handoff blocked: the operation has no verification run.');
const run = query('acceptance', 'run', 'get', runId);
if (run?.id !== runId || run.operationId !== operationId || !run.acceptanceId || !Number.isInteger(run.roundIndex) || run.roundIndex < 1) {
  throw new Error('Handoff blocked: the operation run must already be attached to an acceptance and round.');
}
const acceptanceUrl = new URL(`/acceptance/${encodeURIComponent(run.acceptanceId)}`, origin);
console.log(JSON.stringify({
  acceptanceId: run.acceptanceId, verifyRunId: runId, roundIndex: run.roundIndex,
  acceptanceUrl: acceptanceUrl.href,
}, null, 2));
NODE
```

Using the IDs printed by the lookup, read back
`lh acceptance view <acceptanceId> --json` and confirm its round ledger contains
this `verifyRunId` and `roundIndex`, then copy the lookup's `acceptanceUrl` into the final
handoff with the observed evidence coverage. The lookup neither settles the
round nor supplies a verifier verdict or user acceptance.

If the lookup fails or the run has no acceptance association, preserve the
evidence and report the handoff as blocked so the owning workflow can link the
existing run. Do not invent an acceptance ID, expose the internal `/verify/` URL,
create a replacement acceptance, or ingest a duplicate round to obtain a link.
