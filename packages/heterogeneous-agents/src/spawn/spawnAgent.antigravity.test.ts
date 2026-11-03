import type * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import type * as os from 'node:os';
import { PassThrough } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as resolveCliCommand from './resolveCliCommand';

const spawnCalls: Array<{ args: string[]; command: string; options: any }> = [];
let nextFakeProc: any = null;

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof childProcess>('node:child_process');
  return {
    ...actual,
    spawn: vi.fn((command: string, args: string[], options: any) => {
      spawnCalls.push({ args, command, options });
      return nextFakeProc;
    }),
  };
});

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, platform: vi.fn(() => 'linux') };
});

vi.mock('./resolveCliCommand', async () => {
  const actual = await vi.importActual<typeof resolveCliCommand>('./resolveCliCommand');
  return { ...actual, detectHeterogeneousCliCommand: vi.fn() };
});

/** A child that replays `stdoutChunks` once started, then exits cleanly. */
const createFakeProc = ({ stdoutChunks }: { stdoutChunks: string[] }) => {
  const proc = new EventEmitter() as any;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdinWrites: string[] = [];
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = {
    end: vi.fn(),
    once: vi.fn(),
    write: vi.fn((chunk: string, cb?: () => void) => {
      stdinWrites.push(chunk);
      cb?.();
      return true;
    }),
  };
  proc.kill = vi.fn();
  proc.killed = false;
  proc.pid = 12_345;

  const start = () => {
    setImmediate(() => {
      for (const c of stdoutChunks) stdout.write(c);
      stdout.end();
      stderr.end();
      proc.emit('exit', 0, null);
    });
  };

  return { proc, start, stdinWrites };
};

describe('spawnAgent — Antigravity', () => {
  beforeEach(() => {
    spawnCalls.length = 0;
    nextFakeProc = null;
    vi.mocked(resolveCliCommand.detectHeterogeneousCliCommand).mockResolvedValue({
      available: true,
      path: 'agy',
    });
  });

  it('spawns Antigravity, streams native events and preserves the resumed conversation', async () => {
    const fake = createFakeProc({
      stdoutChunks: [
        JSON.stringify({ event: 'init', conversation_id: 'agy-session', init: {} }) + '\n',
        JSON.stringify({
          event: 'step_update',
          step_update: {
            conversation_id: 'agy-session',
            step_index: 8,
            step_type: 'agent_response',
            state: 'DONE',
            text_delta: 'continued',
          },
        }) + '\n',
        JSON.stringify({
          event: 'result',
          result: { conversation_id: 'agy-session', status: 'SUCCESS', response: 'continued' },
        }) + '\n',
      ],
    });
    nextFakeProc = fake.proc;
    const { spawnAgent } = await import('./spawnAgent');
    const handle = await spawnAgent({
      agentType: 'antigravity',
      operationId: 'op-agy',
      prompt: 'continue',
      resumeSessionId: 'agy-session',
    });
    fake.start();
    const events = [];
    for await (const event of handle.events) events.push(event);
    await handle.exit;
    expect(spawnCalls[0].command).toBe('agy');
    expect(spawnCalls[0].options.shell).not.toBe(true);
    expect(spawnCalls[0].args).toEqual([
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--dangerously-skip-permissions',
      '--conversation',
      'agy-session',
    ]);
    expect(JSON.parse(fake.stdinWrites[0])).toEqual({
      event: 'user',
      message: { content: 'continue' },
    });
    expect(fake.proc.stdin.end).toHaveBeenCalled();
    expect(
      events.filter((event) => event.type === 'stream_chunk' && event.data.chunkType === 'text'),
    ).toHaveLength(1);
    expect(events.some((event) => event.type === 'error')).toBe(false);
  });
});
