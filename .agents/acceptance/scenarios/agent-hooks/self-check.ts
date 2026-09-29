import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { controlHook, hookTypes, notificationHooks, runWithHooks } from './harness';
import { startReceiver } from './receiver';
import { fixtures } from './responses';

const dir =
  process.env.HOOK_SELF_CHECK_DIR ?? (await mkdtemp(path.join(tmpdir(), 'hooks-d-self-check-')));
await mkdir(dir, { recursive: true });
const log = path.join(dir, 'receiver.jsonl');
const receiver = await startReceiver({ log });
try {
  assert.equal((await fetch(`${receiver.url}/health`)).status, 200);
  assert.equal(Buffer.byteLength(fixtures['size-boundary'].body), 65536);
  assert.equal(Buffer.byteLength(fixtures.oversized.body), 65537);
  assert.equal(JSON.parse(fixtures.oversized.body).hookSpecificOutput.permissionDecision, 'allow');
  assert.equal(
    JSON.parse(fixtures['context-boundary'].body).hookSpecificOutput.additionalContext.length,
    10000,
  );
  for (const [name, fixture] of Object.entries(fixtures)) {
    const response = await fetch(`${receiver.url}/hooks/${name}`, {
      method: 'POST',
      headers: { authorization: 'synthetic-never-record-me' },
      body: JSON.stringify({
        hookType: 'beforeToolCall',
        toolCallId: `synthetic-${name}`,
        secret: 'synthetic-never-record-me',
      }),
    });
    assert.equal(response.status, fixture.status ?? 200);
    assert.equal(await response.text(), fixture.body);
  }
  await assert.rejects(
    fetch(`${receiver.url}/hooks/late-allow`, {
      method: 'POST',
      body: '{}',
      signal: AbortSignal.timeout(30),
    }),
  );
  assert.equal((await fetch(`${receiver.url}/hooks/missing`, { method: 'POST' })).status, 404);
  assert.equal(notificationHooks(receiver.url).length, 16);
  assert.equal(new Set(hookTypes).size, 16);
  const control = controlHook(receiver.url, 'deny', 'block');
  assert.equal(control.matcher, '^d-fixture/');
  assert.equal(controlHook(receiver.url, 'late-allow', 'block', 5).webhook?.timeout, 5);
  assert.equal(
    notificationHooks(receiver.url, 'fetch', 'deny')[0].webhook?.url,
    `${receiver.url}/hooks/deny`,
  );
  // This is a harness self-check, NOT a real Agent execution or acceptance evidence.
  let injected = false;
  await runWithHooks(
    {
      async execAgent(params) {
        injected = params.hooks?.[0] === control;
      },
    },
    { agentId: 'synthetic', prompt: 'synthetic' },
    [control],
  );
  assert.equal(injected, true);
} finally {
  await receiver.close();
}
const records = await readFile(log, 'utf8');
assert.ok(records.includes('client-disconnected'));
assert.ok(!records.includes('synthetic-never-record-me'));
assert.equal(
  records
    .trim()
    .split('\n')
    .filter((line) => JSON.parse(line).phase === 'received').length,
  Object.keys(fixtures).length + 1,
);
if (!process.env.HOOK_SELF_CHECK_DIR) await rm(dir, { recursive: true });
console.info(
  JSON.stringify({
    kind: 'harness-self-check-only',
    fixtures: Object.keys(fixtures).length,
    hookTypes: 16,
    abortObserved: true,
    redactionChecked: true,
    productAcceptance: 'not-run',
  }),
);
