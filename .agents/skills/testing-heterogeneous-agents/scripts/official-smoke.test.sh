#!/usr/bin/env bash
# Self-test for the official heterogeneous-provider matrix harness. The
# agent-browser executable is fully stubbed: no browser, external CLI, or model
# request is made.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS="$SCRIPT_DIR/official-smoke.mjs"
TEST_TMP="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cat > "$TEST_TMP/fake-agent-browser.mjs" <<'JS'
#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const logFile = process.env.HETERO_SMOKE_STUB_LOG;
const mode = process.env.HETERO_SMOKE_STUB_MODE;
const stateFile = process.env.HETERO_SMOKE_STUB_STATE;
const source = readFileSync(0, 'utf8');

const emit = (value) => process.stdout.write(`${JSON.stringify(JSON.stringify(value))}\n`);
const readState = () =>
  existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { count: 0, operations: {} };
const writeState = (state) => writeFileSync(stateFile, JSON.stringify(state));

if (source.includes('getServerDefaultHeterogeneousCapability')) {
  appendFileSync(logFile, 'preflight\n');
  emit({
    binaries: {
      'claude-code': { available: true, path: '/fake/bin/claude', version: '1.2.3' },
      codex: { available: false },
      'grok-build': { available: false },
      'kimi-code': { available: false },
      pi: { available: false },
    },
    capability: {
      agents: ['claude-code', 'codex'],
      enabled: true,
      model: 'lobehub-default',
      models: {
        'claude-code': [{ model: 'claude-smoke-a' }, { model: 'claude-smoke-b' }],
        codex: [{ model: 'codex-smoke' }],
      },
    },
    electron: { electronVersion: '99.0.0', platform: 'darwin' },
    isSignedIn: true,
    remoteConfig: { active: true, remoteServerUrl: null, storageMode: 'cloud' },
    topicId: 'topic-smoke',
  });
  process.exit(0);
}

if (source.includes("state: 'missing'")) {
  const operationId = source.match(/\}\)\("([^"]+)"\)\s*$/)?.[1];
  if (mode === 'lose-ownership') {
    appendFileSync(logFile, `poll ${operationId} missing\n`);
    emit({ state: 'missing' });
    process.exit(0);
  }

  const state = readState();
  const operation = state.operations[operationId];
  if (!operationId || !operation) {
    console.error('could not find fake operation for poll');
    process.exit(7);
  }

  operation.polls += 1;
  if (operation.polls === 1) {
    appendFileSync(logFile, `poll ${operationId} running\n`);
    writeState(state);
    emit({ state: 'running' });
  } else {
    appendFileSync(logFile, `poll ${operationId} done\n`);
    delete state.operations[operationId];
    writeState(state);
    emit({ result: operation.result, state: 'done' });
  }
  process.exit(0);
}

if (!source.includes('heterogeneousAgent.startSession')) {
  console.error('unknown eval script');
  process.exit(8);
}
if (!source.includes("kind: 'server-default'")) {
  console.error('cell did not use the server-default provider binding');
  process.exit(4);
}

const value = (key) => source.match(new RegExp(`"${key}":"([^"]+)"`))?.[1];
const agentType = value('agentType');
const ingress = value('ingress');
const marker = value('marker');
const model = value('model');
const operationId = value('operationId');
if (!agentType || !ingress || !marker || !model || !operationId) {
  console.error('could not parse cell input');
  process.exit(5);
}
if (
  agentType === 'claude-code' &&
  (!source.includes('"DISABLE_AUTOUPDATER":"1"') || !source.includes('"DISABLE_UPDATES":"1"'))
) {
  console.error('Claude cell did not disable updater paths');
  process.exit(6);
}

const state = readState();
state.count += 1;
const sessionId = `session-${state.count}`;
const listeners = new Map();
const ipc = {
  emit(channel, payload) {
    for (const listener of listeners.get(channel) || []) listener({}, payload);
  },
  on(channel, listener) {
    listeners.set(channel, [...(listeners.get(channel) || []), listener]);
  },
  removeListener(channel, listener) {
    listeners.set(channel, (listeners.get(channel) || []).filter((item) => item !== listener));
  },
};
globalThis.window = {
  electron: { ipcRenderer: ipc },
  electronAPI: {
    invoke: async (channel) => {
      if (channel === 'heterogeneousAgent.startSession') return { sessionId };
      if (channel === 'heterogeneousAgent.sendPrompt') {
        queueMicrotask(() => {
          ipc.emit('heteroAgentEvent', {
            event: {
              data: { chunkType: 'text', content: marker, model, provider: 'lobehub' },
              type: 'stream_chunk',
            },
            sessionId,
          });
          ipc.emit('heteroAgentSessionComplete', { sessionId });
        });
        return {
          relayInvocation:
            state.count === 2
              ? {
                  acceptedAt: '2026-09-01T00:00:00.000Z',
                  agentType,
                  ingress,
                  model,
                  operationId,
                  provider: 'lobehub',
                }
              : null,
          success: true,
        };
      }
      if (
        channel === 'heterogeneousAgent.cancelSession' ||
        channel === 'heterogeneousAgent.stopSession'
      ) {
        return undefined;
      }
      throw new Error(`unexpected fake IPC invocation: ${channel}`);
    },
  },
};

const started = eval(source);
let record;
for (let attempt = 0; attempt < 100; attempt += 1) {
  record = globalThis.window.__LOBE_HETERO_OFFICIAL_SMOKE_RUNS?.[operationId];
  if (record?.state === 'done') break;
  await new Promise((resolve) => setTimeout(resolve, 1));
}
if (record?.state !== 'done') {
  console.error('generated cell script did not finish');
  process.exit(9);
}

state.operations[operationId] = {
  polls: 0,
  result: record.result,
};
writeState(state);
appendFileSync(logFile, `start ${agentType} ${model} ${operationId}\n`);
process.stdout.write(`${started}\n`);
JS
chmod +x "$TEST_TMP/fake-agent-browser.mjs"

export HETERO_SMOKE_STUB_LOG="$TEST_TMP/invocations.log"
export HETERO_SMOKE_STUB_STATE="$TEST_TMP/cell-count"

# The live confirmation gate must run before even the browser/CLI
# preflight, so a mistyped run command has no side effects.
set +e
unconfirmed_output="$(node "$HARNESS" run --browser "$TEST_TMP/fake-agent-browser.mjs" 2>&1)"
unconfirmed_code=$?
set -e
[[ "$unconfirmed_code" -eq 2 ]] || fail "unconfirmed run exited $unconfirmed_code instead of 2"
[[ "$unconfirmed_output" == "official-smoke: "* ]] ||
  fail "unexpected diagnostic prefix: $unconfirmed_output"
[[ ! -e "$HETERO_SMOKE_STUB_LOG" ]] || fail "unconfirmed run reached agent-browser preflight"

# `list` must read the live-shaped matrix but never execute a cell or create a
# report, even if a report directory option is supplied.
list_output="$(
  node "$HARNESS" list \
    --browser "$TEST_TMP/fake-agent-browser.mjs" \
    --json \
    --report-dir "$TEST_TMP/list-report"
)"
node -e '
  const value = JSON.parse(process.argv[1]);
  if (value.matrix.length !== 3) throw new Error(`expected 3 list cells, got ${value.matrix.length}`);
  if (value.matrix.filter((cell) => cell.cliAvailable).length !== 2) {
    throw new Error("expected two ready Claude model cells");
  }
' "$list_output"
[[ ! -e "$TEST_TMP/list-report" ]] || fail "list created a report directory"
[[ ! -e "$HETERO_SMOKE_STUB_STATE" ]] || fail "list executed a model cell"

: > "$HETERO_SMOKE_STUB_LOG"
set +e
run_output="$(
  node "$HARNESS" run \
    --browser "$TEST_TMP/fake-agent-browser.mjs" \
    --confirm-live \
    --report-dir "$TEST_TMP/report" \
    --timeout 1 \
    --topic-id topic-smoke 2>&1
)"
run_code=$?
set -e

[[ "$run_code" -eq 1 ]] || fail "expected run exit 1 for a failed cell, got $run_code: $run_output"
[[ "$run_output" == *"1 passed, 1 failed, 1 blocked"* ]] ||
  fail "unexpected run summary: $run_output"

node - "$TEST_TMP/report" <<'JS'
const fs = require('node:fs');
const path = require('node:path');

const reportDir = process.argv[2];
const result = JSON.parse(fs.readFileSync(path.join(reportDir, 'result.json'), 'utf8'));
const expected = { blocked: 1, failed: 1, passed: 1, total: 3, verdict: 'fail' };
for (const [key, value] of Object.entries(expected)) {
  if (result.summary[key] !== value) {
    throw new Error(`summary.${key}: expected ${value}, got ${result.summary[key]}`);
  }
}
if (result.plan.length !== 3 || result.cases.length !== 3) {
  throw new Error(`expected three plans/cases, got ${result.plan.length}/${result.cases.length}`);
}
const statuses = result.cases.map((item) => item.status).sort().join(',');
if (statuses !== 'blocked,fail,pass') throw new Error(`unexpected statuses: ${statuses}`);
const rows = result.cases[0].datasets?.[0]?.rows;
if (!rows || rows.length !== 3) throw new Error('matrix visualization does not contain all three rows');
for (const item of result.cases) {
  if (item.evidence.length !== 1 || !fs.existsSync(path.join(reportDir, item.evidence[0]))) {
    throw new Error(`missing evidence for ${item.id}`);
  }
}
const blocked = result.cases.find((item) => item.status === 'blocked');
if (!blocked.observation.includes('no installer or updater')) {
  throw new Error('blocked observation does not preserve the no-install/update safety contract');
}
const failed = result.cases.find((item) => item.status === 'fail');
const failedEvidence = JSON.parse(
  fs.readFileSync(path.join(reportDir, failed.evidence[0]), 'utf8'),
);
if (!failedEvidence.markerObserved || failedEvidence.observedModels.length !== 1) {
  throw new Error('missing-relay case did not exercise the marker/display-metadata false positive');
}
if (failedEvidence.relayVerified || failedEvidence.relayInvocation !== null) {
  throw new Error('missing durable relay attestation incorrectly passed verification');
}
if (!failed.observation.includes('without authoritative proof')) {
  throw new Error(`missing-relay failure was not explained: ${failed.observation}`);
}
const passed = result.cases.find((item) => item.status === 'pass');
const passedEvidence = JSON.parse(
  fs.readFileSync(path.join(reportDir, passed.evidence[0]), 'utf8'),
);
if (!passedEvidence.relayVerified || passedEvidence.relayInvocation?.provider !== 'lobehub') {
  throw new Error('matching durable relay attestation did not pass verification');
}
JS

node - "$HETERO_SMOKE_STUB_LOG" <<'JS'
const fs = require('node:fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n');
if (lines[0] !== 'preflight') throw new Error(`expected preflight first: ${JSON.stringify(lines)}`);
const starts = lines.filter((line) => line.startsWith('start '));
if (starts.length !== 2) throw new Error(`expected exactly two starts: ${JSON.stringify(lines)}`);
if (!starts.some((line) => line.includes('claude-code claude-smoke-a'))) {
  throw new Error(`missing first Claude start: ${JSON.stringify(starts)}`);
}
if (!starts.some((line) => line.includes('claude-code claude-smoke-b'))) {
  throw new Error(`missing second Claude start: ${JSON.stringify(starts)}`);
}
for (const start of starts) {
  const operationId = start.split(' ').at(-1);
  const polls = lines.filter((line) => line.startsWith(`poll ${operationId} `));
  if (polls.length !== 2 || !polls[0].endsWith('running') || !polls[1].endsWith('done')) {
    throw new Error(`unexpected polling for ${operationId}: ${JSON.stringify(polls)}`);
  }
}
JS

# If the renderer loses the launched cell state, the host no longer owns the
# underlying session. The harness must stop before launching another live cell.
rm -f "$HETERO_SMOKE_STUB_STATE"
: > "$HETERO_SMOKE_STUB_LOG"
export HETERO_SMOKE_STUB_MODE=lose-ownership
set +e
abort_output="$(
  node "$HARNESS" run \
    --browser "$TEST_TMP/fake-agent-browser.mjs" \
    --confirm-live \
    --report-dir "$TEST_TMP/abort-report" \
    --timeout 1 \
    --topic-id topic-smoke 2>&1
)"
abort_code=$?
set -e
unset HETERO_SMOKE_STUB_MODE

[[ "$abort_code" -eq 1 ]] || fail "ownership loss exited $abort_code instead of 1: $abort_output"
[[ "$abort_output" == *"ABORTED matrix: renderer lost the in-page cell state before completion"* ]] ||
  fail "ownership loss did not abort the matrix: $abort_output"

node - "$TEST_TMP/abort-report" "$HETERO_SMOKE_STUB_LOG" <<'JS'
const fs = require('node:fs');
const path = require('node:path');

const reportDir = process.argv[2];
const logFile = process.argv[3];
const result = JSON.parse(fs.readFileSync(path.join(reportDir, 'result.json'), 'utf8'));
if (result.summary.failed !== 1 || result.summary.passed !== 0 || result.summary.blocked !== 0) {
  throw new Error(`unexpected abort summary: ${JSON.stringify(result.summary)}`);
}
if (!result.summary.conclusion.includes('2 pending')) {
  throw new Error(`abort summary omitted pending cells: ${result.summary.conclusion}`);
}
if (result.cases.length !== 1 || !result.cases[0].observation.includes('Matrix aborted')) {
  throw new Error(`abort result did not retain the failed cell: ${JSON.stringify(result.cases)}`);
}
const evidence = JSON.parse(
  fs.readFileSync(path.join(reportDir, result.cases[0].evidence[0]), 'utf8'),
);
if (evidence.ownershipLost !== true) throw new Error('abort evidence did not mark ownership loss');

const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
const starts = lines.filter((line) => line.startsWith('start '));
if (starts.length !== 1 || !starts[0].includes('claude-code claude-smoke-a')) {
  throw new Error(`matrix continued after ownership loss: ${JSON.stringify(lines)}`);
}
if (!lines.some((line) => line.startsWith('poll ') && line.endsWith(' missing'))) {
  throw new Error(`missing ownership-loss poll: ${JSON.stringify(lines)}`);
}
JS

echo "official heterogeneous-provider smoke harness tests passed"
