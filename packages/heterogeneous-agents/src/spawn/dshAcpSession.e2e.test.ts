import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { describe, expect, it } from 'vitest';

import { listDshAcpModels, spawnDshAcpSession } from './dshAcpSession';

/**
 * End-to-end against a REAL DeepSeek Harness runtime — real model calls and
 * real tool execution, across separate runtime processes the way LobeHub runs
 * every turn.
 *
 * Self-skips without `DEEPSEEK_API_KEY`. Requires the official DeepSeek Harness
 * CLI (`npm i -g @deepseek-ai/dsh`) on PATH, or `DSH_BIN` pointing at another
 * install. Point `DSH_HOME` at a scratch directory to keep its sessions out of
 * your own harness history.
 */

const runnable = Boolean(process.env.DEEPSEEK_API_KEY);

const turn = async (
  cwd: string,
  prompt: string,
  resumeSessionId?: string,
): Promise<{ events: AgentStreamEvent[]; sessionId?: string }> => {
  const handle = spawnDshAcpSession({
    ...(process.env.DSH_BIN ? { command: process.env.DSH_BIN } : {}),
    cwd,
    operationId: 'op-e2e',
    resumeSessionId,
  });
  const events: AgentStreamEvent[] = [];
  try {
    for await (const event of handle.prompt(prompt)) events.push(event);
  } finally {
    await handle.dispose();
  }
  return { events, sessionId: handle.sessionId };
};

const textOf = (events: AgentStreamEvent[]): string =>
  events
    .filter((e) => e.type === 'stream_chunk' && (e.data as any).chunkType === 'text')
    .map((e) => (e.data as any).content)
    .join('');

describe.runIf(runnable)('spawnDshAcpSession — live harness', () => {
  it('continues the same conversation from a new runtime process', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'dsh-e2e-'));

    const first = await turn(cwd, 'Remember the code word PELICAN. Reply only OK.');
    expect(first.sessionId).toBeTruthy();
    expect(first.events.filter((e) => e.type === 'error')).toHaveLength(0);

    const second = await turn(
      cwd,
      'What was the code word? Reply with just the word.',
      first.sessionId,
    );
    expect(second.sessionId).toBe(first.sessionId);
    expect(textOf(second.events)).toContain('PELICAN');
  }, 240_000);

  it('runs a tool inside the workspace and pairs its call with the result', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'dsh-e2e-'));

    const { events } = await turn(
      cwd,
      'Use the bash tool to run `echo dsh-e2e-proof > proof.txt && cat proof.txt`, then reply with just its output.',
    );

    expect(events.filter((e) => e.type === 'tool_start')).toHaveLength(
      events.filter((e) => e.type === 'tool_end').length,
    );
    expect(events.find((e) => e.type === 'tool_result')?.data).toMatchObject({
      content: expect.stringContaining('dsh-e2e-proof'),
    });
    expect(await readFile(path.join(cwd, 'proof.txt'), 'utf8')).toContain('dsh-e2e-proof');
  }, 240_000);
});

/**
 * Live catalog discovery against a real CLI. Self-skips unless `DSH_BIN`
 * points at a DeepSeek Harness install — no API key needed. Run it after a
 * harness upgrade to catch ACP catalog-shape drift:
 *
 *   DSH_BIN="$(command -v dsh)" DSH_HOME=/tmp/dsh-e2e bunx vitest run \
 *     src/spawn/dshAcpSession.e2e.test.ts -t "enumerates the configured model catalog"
 */
describe.skipIf(!process.env.DSH_BIN)('listDshAcpModels — live harness', () => {
  it('enumerates the configured model catalog over ACP', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'dsh-e2e-'));

    const models = await listDshAcpModels({
      commandPath: process.env.DSH_BIN!,
      cwd,
      env: process.env,
      timeoutMs: 60_000,
    });

    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(model.id).toBeTruthy();
      expect(model.modelId).toBeTruthy();
      expect(model.providerId).toBeTruthy();
    }
  }, 90_000);
});
