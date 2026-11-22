import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { AntigravityLiveInput, ClaudeCodeLiveInput } from '@lobechat/heterogeneous-agents/spawn';
import { describe, expect, it, vi } from 'vitest';

import { endLiveCliRun, writeCliPrompt } from '../heterogeneousAgentLiveInput';
import type { AgentSession } from '../heterogeneousAgentSession';
import { steerAgentSession } from '../heterogeneousAgentSteer';

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const params = { messageId: 'steer-1', prompt: 'also run the tests', sessionId: 's1' };
const session = (extra: Partial<AgentSession>) =>
  ({
    agentType: 'claude-code',
    args: [],
    command: 'claude',
    sessionId: 's1',
    ...extra,
  }) as AgentSession;

const readLines = (stream: PassThrough) => {
  const lines: any[] = [];
  stream.on('data', (chunk: Buffer) => {
    for (const raw of chunk.toString().split('\n')) if (raw) lines.push(JSON.parse(raw));
  });
  return lines;
};

describe('steerAgentSession', () => {
  it('writes into a live Claude Code CLI under the delivery id, with no priority', async () => {
    const stdin = new PassThrough();
    const written = readLines(stdin);
    const liveInput = new ClaudeCodeLiveInput(stdin);

    await expect(steerAgentSession(session({ liveInput }), params, '/tmp')).resolves.toEqual({
      status: 'accepted',
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(written[0]).toMatchObject({ type: 'user', uuid: 'steer-1' });
    // Read at the next tool boundary: `priority: 'now'` would abort the running tool.
    expect(written[0]).not.toHaveProperty('priority');
    expect(JSON.stringify(written[0].message)).toContain('also run the tests');
  });

  it('refuses once the live input closed, so the message runs as the next turn', async () => {
    const liveInput = new ClaudeCodeLiveInput(new PassThrough());
    liveInput.close();

    await expect(steerAgentSession(session({ liveInput }), params, '/tmp')).resolves.toEqual({
      status: 'rejected',
    });
  });

  it('hands the message to the Claude Code SDK input stream', async () => {
    const steer = vi.fn(() => true);

    await expect(
      steerAgentSession(session({ sdkSession: { steer } as any }), params, '/tmp'),
    ).resolves.toEqual({ status: 'accepted' });
    expect(steer).toHaveBeenCalledWith(expect.objectContaining({ type: 'user' }), 'steer-1');
  });

  it('steers a Codex app-server turn', async () => {
    const steer = vi.fn(async () => 'rejected' as const);
    const codex = session({ agentType: 'codex', appServerSession: { steer } as any });

    await expect(steerAgentSession(codex, params, '/tmp')).resolves.toEqual({ status: 'rejected' });
    expect(steer).toHaveBeenCalledWith(
      [expect.objectContaining({ text: 'also run the tests', type: 'text' })],
      'steer-1',
    );
  });

  it('steers a live Antigravity CLI with text and image attachments', async () => {
    const stdin = new PassThrough();
    const written = readLines(stdin);
    const liveInput = new AntigravityLiveInput(stdin);
    const agy = session({ agentType: 'antigravity', command: 'agy', liveInput });

    await expect(steerAgentSession(agy, params, '/tmp')).resolves.toEqual({
      status: 'accepted',
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(written[0]).toEqual({
      event: 'user',
      message: { content: expect.stringContaining('also run the tests') },
    });
    expect(liveInput.takeSteerUuid()).toBe('steer-1');

    const cacheDir = await mkdtemp(path.join(tmpdir(), 'agy-desktop-steer-test-'));
    const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';
    try {
      await expect(
        steerAgentSession(
          agy,
          {
            ...params,
            imageList: [{ id: 'img-1', url: `data:image/png;base64,${image}` }],
            messageId: 'steer-image',
          },
          cacheDir,
        ),
      ).resolves.toEqual({ status: 'accepted' });
      const filePath = JSON.parse(written[1].message.content.match(/^- (".+")$/m)![1]);
      expect(await readFile(filePath)).toEqual(Buffer.from(image, 'base64'));
      expect(liveInput.takeSteerUuid()).toBe('steer-image');
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it('steers a Pi run', async () => {
    const steer = vi.fn(async () => {});
    const pi = session({ agentType: 'pi', piRpcSession: { steer } as any });

    // Pi reports a read message by its text: hand back exactly what it received.
    await expect(steerAgentSession(pi, params, '/tmp')).resolves.toEqual({
      deliveredText: 'also run the tests',
      status: 'accepted',
    });
    expect(steer).toHaveBeenCalledWith('also run the tests', undefined);
  });

  it.each([
    ['an ACP agent', session({ agentType: 'copilot' })],
    ['Codex exec', session({ agentType: 'codex' })],
    ['a one-shot Claude Code CLI', session({ process: {} as any })],
  ])('has no way into %s', async (_label, target) => {
    await expect(steerAgentSession(target, params, '/tmp')).resolves.toEqual({
      status: 'unsupported',
    });
  });
});

describe('live Claude Code CLI input', () => {
  it('closes stdin after the prompt for a one-shot run', async () => {
    const stdin = new PassThrough();
    const ended = vi.fn();
    stdin.on('finish', ended);
    stdin.resume();

    expect(writeCliPrompt(stdin, '{"type":"user"}\n', false)).toBeUndefined();
    await new Promise((resolve) => setImmediate(resolve));
    expect(ended).toHaveBeenCalled();
  });

  it('ends the run once, at a clean exit after a finished turn, like `lh hetero exec`', () => {
    const stdin = new PassThrough();
    stdin.resume();
    const input = writeCliPrompt(stdin, '{"type":"user","message":{}}\n', true)!;
    input.observe('{"type":"result","is_error":false,"terminal_reason":"completed"}\n');
    const completeRuntime = vi.fn(() => []);
    const exit = { code: 0, sawError: false, signal: null };

    endLiveCliRun({ completeRuntime }, input, exit);
    expect(completeRuntime).toHaveBeenCalledWith({ reason: 'complete', transport: 'cli-live' });

    completeRuntime.mockClear();
    endLiveCliRun({ completeRuntime }, input, { ...exit, code: 2 });
    endLiveCliRun({ completeRuntime }, input, { ...exit, sawError: true });
    expect(completeRuntime).not.toHaveBeenCalled();
  });
});
