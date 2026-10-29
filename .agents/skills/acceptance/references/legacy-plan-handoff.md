# Legacy plan handoff lookup

Use only when the actual publication response lacks an acceptance URL or a
text-only operation plan needs no publication. Prefer already acquired server,
operation and run facts; query only missing state. This read-only recipe is a
compatibility fallback, not a discovery sequence for every round.

Run the complete recipe below only when its server, operation state and run
association are all unacquired. With partial context, retain the known values
and query only missing state using the corresponding CLI subcommand help.

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
const query = (...args) =>
  JSON.parse(execFileSync('lh', [...args, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
// `lh acceptance plan` is the current spelling; an older CLI only has `lh verify plan`.
let state;
try {
  state = query('acceptance', 'plan', 'state', operationId);
} catch {
  state = query('verify', 'plan', 'state', operationId);
}
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
existing run. Do not invent an acceptance ID, hand off a `/verify/` link (it only
redirects to the acceptance page),
create a replacement acceptance, or ingest a duplicate round to obtain a link.
