import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { describe, expect, it } from 'vitest';

import { spawnDshAcpSession } from './dshAcpSession';

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

describe.skipIf(runnable)('spawnDshAcpSession — live harness (not runnable here)', () => {
  it('needs DEEPSEEK_API_KEY and the dsh CLI', () => {
    expect(runnable).toBe(false);
  });
});
