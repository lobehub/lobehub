import { PassThrough } from 'node:stream';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerHeteroCommand } from './hetero';

const { mockSpawnAgent } = vi.hoisted(() => ({
  mockSpawnAgent: vi.fn(),
}));

vi.mock('@lobechat/heterogeneous-agents/spawn', () => ({
  spawnAgent: mockSpawnAgent,
}));

vi.mock('../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  setVerbose: vi.fn(),
}));

/**
 * Build a fake `SpawnAgentHandle`. The async iterable yields `events`
 * synchronously and ends, so the command's `for await (const event of ...)`
 * loop terminates without hanging the test.
 */
const createFakeHandle = ({
  events = [] as any[],
  exitCode = 0,
  signal = null as NodeJS.Signals | null,
  stderrChunks = [] as string[],
}: {
  events?: any[];
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stderrChunks?: string[];
} = {}) => {
  const stderr = new PassThrough();
  setImmediate(() => {
    for (const c of stderrChunks) stderr.write(c);
    stderr.end();
  });

  const eventsIter: AsyncIterable<any> = {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < events.length) return { done: false, value: events[i++] };
          return { done: true, value: undefined };
        },
      };
    },
  };

  return {
    events: eventsIter,
    exit: Promise.resolve({ code: exitCode, signal }),
    kill: vi.fn(),
    pid: 12_345,
    stderr,
  };
};

describe('hetero exec command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Stub `process.exit` so the test runner doesn't tear down — but THROW a
    // sentinel rather than return, mirroring `process.exit`'s `never` return
    // type in production. Without throwing, the command's code after an
    // `exit(2)` keeps running and crashes on `handle.stderr` (no spawn mock).
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__${code}`);
    }) as any);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockSpawnAgent.mockReset();
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    vi.restoreAllMocks();
  });

  /** Build a fresh program with the hetero command registered. */
  const buildProgram = () => {
    const program = new Command();
    program.exitOverride();
    registerHeteroCommand(program);
    return program;
  };

  /**
   * Run the parsed command. Swallows our `__exit__<code>` sentinel so tests
   * can inspect `exitSpy.mock.calls` afterwards instead of having to wrap
   * every `parseAsync` in `expect(...).rejects`. Real production exits stay
   * `process.exit` so this only affects the test path.
   */
  const runCmd = async (argv: string[]) => {
    try {
      await buildProgram().parseAsync(argv, { from: 'user' });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('__exit__')) return;
      throw err;
    }
  };

  it('rejects unsupported agent types via process.exit(2)', async () => {
    await runCmd(['hetero', 'exec', '--type', 'kimi-cli', '--prompt', 'hi']);
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(mockSpawnAgent).not.toHaveBeenCalled();
  });

  it('rejects empty prompts via process.exit(2)', async () => {
    await runCmd(['hetero', 'exec', '--type', 'claude-code', '--prompt', '   ']);
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(mockSpawnAgent).not.toHaveBeenCalled();
  });

  it('passes --type / --prompt / --resume / --cwd / --command through to spawnAgent', async () => {
    mockSpawnAgent.mockReturnValue(createFakeHandle());

    await runCmd([
      'hetero',
      'exec',
      '--type',
      'codex',
      '--prompt',
      'do thing',
      '--resume',
      'thread_abc',
      '--cwd',
      '/tmp/work',
      '--command',
      '/usr/local/bin/codex',
    ]);

    expect(mockSpawnAgent).toHaveBeenCalledTimes(1);
    const call = mockSpawnAgent.mock.calls[0][0];
    expect(call).toMatchObject({
      agentType: 'codex',
      command: '/usr/local/bin/codex',
      cwd: '/tmp/work',
      prompt: 'do thing',
      resumeSessionId: 'thread_abc',
    });
    // operationId auto-generated when omitted (uuid v4 shape)
    expect(call.operationId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('uses the provided --operation-id verbatim', async () => {
    mockSpawnAgent.mockReturnValue(createFakeHandle());

    await runCmd([
      'hetero',
      'exec',
      '--type',
      'claude-code',
      '--prompt',
      'hi',
      '--operation-id',
      'op-server-allocated',
    ]);

    const call = mockSpawnAgent.mock.calls[0][0];
    expect(call.operationId).toBe('op-server-allocated');
  });

  it('streams events to stdout as JSONL, one line per event', async () => {
    const events = [
      { data: { foo: 1 }, operationId: 'op-1', stepIndex: 0, timestamp: 1, type: 'stream_start' },
      {
        data: { chunkType: 'text', content: 'hi' },
        operationId: 'op-1',
        stepIndex: 0,
        timestamp: 2,
        type: 'stream_chunk',
      },
    ];
    mockSpawnAgent.mockReturnValue(createFakeHandle({ events }));

    await runCmd([
      'hetero',
      'exec',
      '--type',
      'claude-code',
      '--prompt',
      'hi',
      '--operation-id',
      'op-1',
    ]);

    // Each event is one JSON line with a trailing \n.
    const lines = stdoutSpy.mock.calls.map((c) => c[0]).filter((s) => typeof s === 'string');
    expect(lines).toHaveLength(2);
    for (const line of lines as string[]) {
      expect(line.endsWith('\n')).toBe(true);
      const parsed = JSON.parse(line);
      expect(parsed.operationId).toBe('op-1');
    }
  });

  it('passes the child exit code straight through', async () => {
    mockSpawnAgent.mockReturnValue(createFakeHandle({ exitCode: 7 }));

    await runCmd(['hetero', 'exec', '--type', 'claude-code', '--prompt', 'hi']);
    expect(exitSpy).toHaveBeenCalledWith(7);
  });

  it('maps SIGINT (code === null) to POSIX exit code 130', async () => {
    mockSpawnAgent.mockReturnValue(createFakeHandle({ exitCode: null, signal: 'SIGINT' }));

    await runCmd(['hetero', 'exec', '--type', 'claude-code', '--prompt', 'hi']);
    expect(exitSpy).toHaveBeenCalledWith(130);
  });
});
