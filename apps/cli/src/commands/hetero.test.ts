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
 * Build a Promise resolving to a fake `SpawnAgentHandle`. `spawnAgent` itself
 * is async, so test mocks return the handle wrapped — same iterable contract,
 * just behind one microtask. The async iterable yields `events` synchronously
 * and ends, so the command's `for await (const event of ...)` loop terminates
 * without hanging the test.
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

  return Promise.resolve({
    events: eventsIter,
    exit: Promise.resolve({ code: exitCode, signal }),
    kill: vi.fn(),
    pid: 12_345,
    stderr,
  });
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

  it('combines --prompt + --image into mixed content blocks', async () => {
    mockSpawnAgent.mockReturnValue(createFakeHandle());

    await runCmd([
      'hetero',
      'exec',
      '--type',
      'claude-code',
      '--prompt',
      'describe',
      '--image',
      './fixture-a.png',
      '--image',
      'https://cdn.example/fixture-b.png',
    ]);

    const call = mockSpawnAgent.mock.calls[0][0];
    expect(Array.isArray(call.prompt)).toBe(true);
    expect(call.prompt).toEqual([
      { text: 'describe', type: 'text' },
      // Path is resolved against process.cwd() — match by suffix to be CI-portable.
      {
        source: expect.objectContaining({ type: 'path' }),
        type: 'image',
      },
      {
        source: { type: 'url', url: 'https://cdn.example/fixture-b.png' },
        type: 'image',
      },
    ]);
    expect(call.prompt[1].source.path).toMatch(/fixture-a\.png$/);
  });

  it('parses a data: URL --image into a base64 source', async () => {
    mockSpawnAgent.mockReturnValue(createFakeHandle());

    const dataUrl = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')}`;
    await runCmd([
      'hetero',
      'exec',
      '--type',
      'claude-code',
      '--prompt',
      'see',
      '--image',
      dataUrl,
    ]);

    const call = mockSpawnAgent.mock.calls[0][0];
    expect(call.prompt[1]).toEqual({
      source: {
        data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'),
        mediaType: 'image/png',
        type: 'base64',
      },
      type: 'image',
    });
  });

  it('reads multimodal content from --input-json <file>', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const dir = await mkdtemp(`${tmpdir()}/hetero-input-json-`);
    const file = path.join(dir, 'input.json');
    await writeFile(
      file,
      JSON.stringify([
        { text: 'analyze', type: 'text' },
        { source: { type: 'url', url: 'https://x/y.png' }, type: 'image' },
      ]),
    );

    mockSpawnAgent.mockReturnValue(createFakeHandle());
    try {
      await runCmd(['hetero', 'exec', '--type', 'claude-code', '--input-json', file]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }

    const call = mockSpawnAgent.mock.calls[0][0];
    expect(call.prompt).toEqual([
      { text: 'analyze', type: 'text' },
      { source: { type: 'url', url: 'https://x/y.png' }, type: 'image' },
    ]);
  });

  it('reports spawnAgent rejections (e.g. missing --image path) as a clean error + exit(1)', async () => {
    // spawnAgent is now async and can reject during image normalization —
    // missing local --image paths, fetch failures, etc. The CLI must catch
    // these and exit with a friendly message instead of crashing on an
    // unhandled rejection.
    mockSpawnAgent.mockReturnValue(
      Promise.reject(new Error('ENOENT: no such file or directory, open /missing.png')),
    );

    await runCmd([
      'hetero',
      'exec',
      '--type',
      'claude-code',
      '--prompt',
      'see',
      '--image',
      '/missing.png',
    ]);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('rejects --prompt + --input-json (mutually exclusive)', async () => {
    await runCmd([
      'hetero',
      'exec',
      '--type',
      'claude-code',
      '--prompt',
      'hi',
      '--input-json',
      '/tmp/bogus.json',
    ]);
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(mockSpawnAgent).not.toHaveBeenCalled();
  });
});
