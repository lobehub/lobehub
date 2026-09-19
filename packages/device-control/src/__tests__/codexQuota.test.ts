import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getCodexQuota } from '../codexQuota';

let fixtureDir: string;
let fixtureCommand: string;

beforeAll(async () => {
  fixtureDir = await mkdtemp(path.join(tmpdir(), 'codex-quota-'));
  fixtureCommand = path.join(fixtureDir, 'codex');
  await writeFile(
    fixtureCommand,
    `#!/usr/bin/env node
const readline = require('node:readline');
const input = readline.createInterface({ input: process.stdin });
(async () => {
  for await (const line of input) {
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
      process.stdout.write(JSON.stringify({ id: message.id, jsonrpc: '2.0', result: {} }) + '\\n');
    }
    if (message.method === 'account/rateLimits/read') {
      process.stdout.write(JSON.stringify({
        id: message.id,
        jsonrpc: '2.0',
        result: {
          rateLimits: {
            limitId: 'codex',
            primary: { resetsAt: 1800000000, usedPercent: 23, windowDurationMins: 300 },
            secondary: { resetsAt: 1800604800, usedPercent: 41, windowDurationMins: 10080 },
          },
          rateLimitsByLimitId: {
            codex_other: {
              limitName: 'Other models',
              primary: { resetsAt: 1800003600, usedPercent: 9, windowDurationMins: 300 },
            },
          },
        },
      }) + '\\n');
    }
  }
})();
`,
  );
  await chmod(fixtureCommand, 0o755);
});

afterAll(async () => {
  await rm(fixtureDir, { force: true, recursive: true });
});

describe('getCodexQuota', () => {
  it('reads and maps every rate-limit bucket through Codex app-server', async () => {
    const result = await getCodexQuota({ command: fixtureCommand, force: true });

    expect(result).toMatchObject({
      error: null,
      provider: 'codex',
      session: { resetsAt: 1_800_000_000_000, usedPercent: 23, windowMinutes: 300 },
      status: 'ok',
      weekly: { resetsAt: 1_800_604_800_000, usedPercent: 41, windowMinutes: 10_080 },
    });
    expect(result.rateLimits).toEqual([
      {
        limitId: 'codex',
        limitName: null,
        primary: { resetsAt: 1_800_000_000_000, usedPercent: 23, windowMinutes: 300 },
        secondary: { resetsAt: 1_800_604_800_000, usedPercent: 41, windowMinutes: 10_080 },
      },
      {
        limitId: 'codex_other',
        limitName: 'Other models',
        primary: { resetsAt: 1_800_003_600_000, usedPercent: 9, windowMinutes: 300 },
        secondary: null,
      },
    ]);
  });
});
