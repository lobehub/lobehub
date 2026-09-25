# Plan-driven rounds — discover, submit, self-check

Use this path only when the invocation handed you an operation id: a verify plan
already exists and you satisfy it criterion by criterion. Authoring your own
checks (the default) is [report.md](./report.md). Never mix both for one round.

`--operation` and `--run` are interchangeable on `result submit` and
`result list`; `evidence list` keys off a positional `<checkResultId>` from
`result list`.

## (a) `lh verify plan state $OPERATION_ID --json`

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

Only items with a non-empty `requiredEvidence` need an artifact; the rest are
judged on the deliverable text — don't fabricate evidence for them. The `hint`
usually implies the surface (SKILL.md, Pick the surface).

Apply [acceptance-checker.md](acceptance-checker.md) before execution and at final handoff
of the first round; follow-up rounds have no acceptance-checker. Preserve frozen check IDs;
report coverage gaps instead of silently changing the supplied plan. The
acceptance-checker's review does not replace the configured verifier or authorize
overriding its verdict. Keep existing submission and round semantics.

## Your worklist → submit by checkItemId

For each `verifyPlan[]` item with non-empty `requiredEvidence`, capture each
`type` with the selected surface guide and submit **one artifact per call** by
`checkItemId` (the same `--item` reuses the row):

| checkItemId  | title                            | requiredEvidence |
| ------------ | -------------------------------- | ---------------- |
| `vci_a1b2c3` | Login flow reaches the workspace | `screenshot`     |

```bash
OP="$OPERATION_ID"
lh acceptance run result submit --operation "$OP" --item vci_a1b2c3 --type screenshot \
  --file ./proof/home.png --by agent-browser --desc "…"
```

`lh acceptance run result submit` resolves the session from the operation id and **creates the
check-result row for you** (idempotent on `checkItemId`), then attaches the
evidence — there is no `checkResultId` to look up first. `--by` records
provenance (`agent-browser` | `cdp` | `cli` | `program`); `--file` for binaries,
`--content` for text, exactly one. Leave the verdict to the review step — add
`--verdict` only when the task explicitly asks you to self-assert. Keep the
printed run URL internal.

## Self-check coverage (do not skip)

Once you've submitted, the result rows exist. Map each `checkItemId` to its
`checkResultId` and list that row's evidence:

```jsonc
// lh acceptance run result list --operation "$OP" --json
[
  {
    "id": "vcr_x9y8z7", // checkResultId (created by submit)
    "checkItemId": "vci_a1b2c3", // joins back to verifyPlan[].id
    "status": "running",
  },
]
```

```bash
lh acceptance run evidence list "$CHECK_RESULT_ID" --json # confirm each required type is present
```

Coverage rule: for each required criterion, **every** `requiredEvidence[].type`
appears at least once in its evidence list. A missing type → capture and submit
again; then hand off per SKILL.md (acceptance URL + `coverage: n/n`).

## Resolve the plan round's handoff links

`result submit --json` returns an internal `url`, not `acceptanceUrl`. Some plans need no evidence submissions at all. In both cases, resolve
the supplied operation ID with `lh verify plan state <operationId> --json`, then
read its `verifyRunId` using `lh acceptance run get <runId> --json`. The run's
`acceptanceId` and `roundIndex` identify the existing handoff; do not substitute a
result ID, subject ID, or the most recent round from another acceptance.

Keep the same CLI server, account, and workspace as the verification. This example
reads the resolved server from `lh doctor --offline --json` (`endpoints.resolution`
check, `evidence.serverUrl`), preserving self-hosted hosts and ports. Doctor may exit
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
const origin = new URL(endpoint.evidence.serverUrl).origin;
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
