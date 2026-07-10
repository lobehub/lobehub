import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerHeteroCommand } from './hetero';

const { mockResolveHeteroSpawnCommand, mockSpawnAgent } = vi.hoisted(() => ({
  mockResolveHeteroSpawnCommand: vi.fn(),
  mockSpawnAgent: vi.fn(),
}));
const { mockGetTrpcClient, mockHeteroFinishMutate, mockHeteroIngestMutate } = vi.hoisted(() => ({
  mockGetTrpcClient: vi.fn(),
  mockHeteroFinishMutate: vi.fn(),
  mockHeteroIngestMutate: vi.fn(),
}));

vi.mock('@lobechat/heterogeneous-agents/spawn', () => ({
  spawnAgent: mockSpawnAgent,
}));

vi.mock('@lobechat/heterogeneous-agents/resolveCliCommand', () => ({
  resolveHeteroSpawnCommand: mockResolveHeteroSpawnCommand,
}));

vi.mock('../api/client', () => ({
  getTrpcClient: mockGetTrpcClient,
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
  eventsError,
  exitCode = 0,
  signal = null as NodeJS.Signals | null,
  stderrChunks = [] as string[],
}: {
  events?: any[];
  eventsError?: Error;
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
          if (eventsError) throw eventsError;
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
    mockResolveHeteroSpawnCommand.mockReset();
    mockResolveHeteroSpawnCommand.mockImplementation(
      async (agentType: 'claude-code' | 'codex', command?: string) => ({
        command: command ?? (agentType === 'codex' ? 'codex' : 'claude'),
      }),
    );
    mockSpawnAgent.mockReset();
    mockHeteroIngestMutate.mockReset();
    mockHeteroFinishMutate.mockReset();
    mockGetTrpcClient.mockReset();
    mockHeteroIngestMutate.mockResolvedValue({ ack: true });
    mockHeteroFinishMutate.mockResolvedValue({ ack: true });
    mockGetTrpcClient.mockResolvedValue({
      aiAgent: {
        heteroFinish: { mutate: mockHeteroFinishMutate },
        heteroIngest: { mutate: mockHeteroIngestMutate },
      },
    });
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

  it('passes Claude Code --model and --effort through as spawnAgent extraArgs', async () => {
    mockSpawnAgent.mockReturnValue(createFakeHandle());

    await runCmd([
      'hetero',
      'exec',
      '--type',
      'claude-code',
      '--prompt',
      'hi',
      '--model',
      'opus',
      '--effort',
      'high',
    ]);

    expect(mockSpawnAgent).toHaveBeenCalledTimes(1);
    expect(mockSpawnAgent.mock.calls[0][0]).toMatchObject({
      extraArgs: ['--model', 'opus', '--effort', 'high'],
    });
  });

  it('translates Codex --effort to native model_reasoning_effort config', async () => {
    mockSpawnAgent.mockReturnValue(createFakeHandle());

    await runCmd([
      'hetero',
      'exec',
      '--type',
      'codex',
      '--prompt',
      'hi',
      '--model',
      'gpt-5.5',
      '--effort',
      'xhigh',
    ]);

    expect(mockSpawnAgent).toHaveBeenCalledTimes(1);
    expect(mockSpawnAgent.mock.calls[0][0]).toMatchObject({
      extraArgs: ['--model', 'gpt-5.5', '-c', 'model_reasoning_effort="xhigh"'],
    });
  });

  it('translates Codex --speed to native service_tier config', async () => {
    mockSpawnAgent.mockReturnValue(createFakeHandle());

    await runCmd([
      'hetero',
      'exec',
      '--type',
      'codex',
      '--prompt',
      'hi',
      '--model',
      'gpt-5.5',
      '--speed',
      'fast',
    ]);

    expect(mockSpawnAgent).toHaveBeenCalledTimes(1);
    expect(mockSpawnAgent.mock.calls[0][0]).toMatchObject({
      extraArgs: ['--model', 'gpt-5.5', '-c', 'service_tier="fast"'],
    });
  });

  it('ignores --speed for Claude Code runs', async () => {
    mockSpawnAgent.mockReturnValue(createFakeHandle());

    await runCmd([
      'hetero',
      'exec',
      '--type',
      'claude-code',
      '--prompt',
      'hi',
      '--model',
      'opus',
      '--speed',
      'fast',
    ]);

    expect(mockSpawnAgent).toHaveBeenCalledTimes(1);
    expect(mockSpawnAgent.mock.calls[0][0]).toMatchObject({
      extraArgs: ['--model', 'opus'],
    });
  });

  it('passes native agent args through --agent-arg without treating them as wrapper options', async () => {
    mockSpawnAgent.mockReturnValue(createFakeHandle());

    await runCmd([
      'hetero',
      'exec',
      '--type',
      'codex',
      '--prompt',
      'hi',
      '--agent-arg=-c',
      '--agent-arg=model = "gpt-5.4"',
      '--effort',
      'xhigh',
    ]);

    expect(mockSpawnAgent).toHaveBeenCalledTimes(1);
    expect(mockSpawnAgent.mock.calls[0][0]).toMatchObject({
      command: 'codex',
      extraArgs: ['-c', 'model = "gpt-5.4"', '-c', 'model_reasoning_effort="xhigh"'],
    });
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
    mockSpawnAgent.mockRejectedValue(
      new Error('ENOENT: no such file or directory, open /missing.png'),
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

  it('finishes server-ingest runs with error when spawnAgent rejects before streaming', async () => {
    mockSpawnAgent.mockRejectedValue(new Error('spawn claude ENOENT'));

    await runCmd([
      'hetero',
      'exec',
      '--type',
      'claude-code',
      '--prompt',
      'hi',
      '--topic',
      'topic-1',
      '--operation-id',
      'op-server',
      '--render',
      'none',
    ]);

    expect(mockHeteroFinishMutate).toHaveBeenCalledTimes(1);
    expect(mockHeteroFinishMutate.mock.calls[0][0]).toMatchObject({
      agentType: 'claude-code',
      error: { message: 'spawn claude ENOENT', type: 'AgentRuntimeError' },
      operationId: 'op-server',
      result: 'error',
      topicId: 'topic-1',
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('finishes server-ingest runs with error when the agent event stream fails', async () => {
    mockSpawnAgent.mockReturnValue(
      createFakeHandle({ eventsError: new Error('spawn claude ENOENT') }),
    );

    await runCmd([
      'hetero',
      'exec',
      '--type',
      'claude-code',
      '--prompt',
      'hi',
      '--topic',
      'topic-1',
      '--operation-id',
      'op-server',
      '--render',
      'none',
    ]);

    expect(mockHeteroFinishMutate).toHaveBeenCalledTimes(1);
    expect(mockHeteroFinishMutate.mock.calls[0][0]).toMatchObject({
      error: { message: 'Error: spawn claude ENOENT', type: 'stream_error' },
      operationId: 'op-server',
      result: 'error',
      topicId: 'topic-1',
    });
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

  describe('--resume auto-retry on session-not-found', () => {
    it('retries without --resume when the error stream event indicates the session is gone', async () => {
      // First spawn: exits non-zero, emits a resume-not-found error event
      const resumeNotFoundEvent = {
        data: {
          error: 'No conversation found with session ID cc-stale',
          message: 'No conversation found with session ID cc-stale',
        },
        operationId: 'op-r1',
        stepIndex: 0,
        timestamp: 1,
        type: 'error',
      };
      mockSpawnAgent
        .mockReturnValueOnce(createFakeHandle({ events: [resumeNotFoundEvent], exitCode: 1 }))
        // Second spawn: succeeds
        .mockReturnValueOnce(createFakeHandle({ exitCode: 0 }));

      await runCmd([
        'hetero',
        'exec',
        '--type',
        'claude-code',
        '--prompt',
        'do the thing',
        '--resume',
        'cc-stale',
        '--operation-id',
        'op-r1',
      ]);

      // Two spawns: first with --resume, retry without
      expect(mockSpawnAgent).toHaveBeenCalledTimes(2);
      expect(mockSpawnAgent.mock.calls[0][0]).toMatchObject({ resumeSessionId: 'cc-stale' });
      expect(mockSpawnAgent.mock.calls[1][0]).not.toHaveProperty('resumeSessionId');
      expect(mockSpawnAgent.mock.calls[1][0].resumeSessionId).toBeUndefined();

      // Final exit code comes from the retry (0 → success)
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('retries without --resume when stderr contains a session-not-found message', async () => {
      // First spawn: exits non-zero with no events, but stderr has the pattern
      mockSpawnAgent
        .mockReturnValueOnce(
          createFakeHandle({
            exitCode: 1,
            stderrChunks: ['Error: No conversation found with session ID xyz\n'],
          }),
        )
        .mockReturnValueOnce(createFakeHandle({ exitCode: 0 }));

      await runCmd([
        'hetero',
        'exec',
        '--type',
        'claude-code',
        '--prompt',
        'continue',
        '--resume',
        'xyz',
        '--operation-id',
        'op-r2',
      ]);

      expect(mockSpawnAgent).toHaveBeenCalledTimes(2);
      expect(mockSpawnAgent.mock.calls[1][0].resumeSessionId).toBeUndefined();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('retries without --resume when the error indicates context overflow', async () => {
      const contextOverflowEvent = {
        data: {
          error: 'prompt is too long: 215168 tokens > 200000 maximum',
          message: 'prompt is too long: 215168 tokens > 200000 maximum',
        },
        operationId: 'op-ctx',
        stepIndex: 0,
        timestamp: 1,
        type: 'error',
      };
      mockSpawnAgent
        .mockReturnValueOnce(createFakeHandle({ events: [contextOverflowEvent], exitCode: 1 }))
        .mockReturnValueOnce(createFakeHandle({ exitCode: 0 }));

      await runCmd([
        'hetero',
        'exec',
        '--type',
        'claude-code',
        '--prompt',
        'next question',
        '--resume',
        'cc-longctx',
        '--operation-id',
        'op-ctx',
      ]);

      expect(mockSpawnAgent).toHaveBeenCalledTimes(2);
      expect(mockSpawnAgent.mock.calls[0][0]).toMatchObject({ resumeSessionId: 'cc-longctx' });
      expect(mockSpawnAgent.mock.calls[1][0].resumeSessionId).toBeUndefined();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('does NOT retry on a non-resume error exit', async () => {
      // Exit code 1 but no resume-related error message
      mockSpawnAgent.mockReturnValueOnce(
        createFakeHandle({ exitCode: 1, stderrChunks: ['rate limit exceeded\n'] }),
      );

      await runCmd([
        'hetero',
        'exec',
        '--type',
        'claude-code',
        '--prompt',
        'hi',
        '--resume',
        'cc-valid',
      ]);

      expect(mockSpawnAgent).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('does NOT retry when --resume is not provided', async () => {
      const errorEvent = {
        data: { error: 'No conversation found', message: 'No conversation found' },
        operationId: 'op-nr',
        stepIndex: 0,
        timestamp: 1,
        type: 'error',
      };
      mockSpawnAgent.mockReturnValueOnce(createFakeHandle({ events: [errorEvent], exitCode: 1 }));

      await runCmd([
        'hetero',
        'exec',
        '--type',
        'claude-code',
        '--prompt',
        'fresh run',
        '--operation-id',
        'op-nr',
      ]);

      // No --resume → no interception → no retry
      expect(mockSpawnAgent).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('does NOT suppress the resume-error event from JSONL output', async () => {
      const resumeNotFoundEvent = {
        data: {
          error: 'No conversation found with session ID old',
          message: 'No conversation found with session ID old',
        },
        operationId: 'op-jsonl',
        stepIndex: 0,
        timestamp: 1,
        type: 'error',
      };
      mockSpawnAgent
        .mockReturnValueOnce(createFakeHandle({ events: [resumeNotFoundEvent], exitCode: 1 }))
        .mockReturnValueOnce(createFakeHandle({ exitCode: 0 }));

      await runCmd([
        'hetero',
        'exec',
        '--type',
        'claude-code',
        '--prompt',
        'do thing',
        '--resume',
        'old',
        '--render',
        'jsonl',
      ]);

      // The error event is still emitted to JSONL (for observability) even
      // though it was withheld from the ingester.
      const lines = stdoutSpy.mock.calls
        .map((c) => c[0])
        .filter((s): s is string => typeof s === 'string');
      const errorLine = lines.find((l) => {
        try {
          return JSON.parse(l).type === 'error';
        } catch {
          return false;
        }
      });
      expect(errorLine).toBeDefined();
    });
  });

  it('sends full text snapshots before tools and waits for finish until all server ingests ack', async () => {
    const callOrder: string[] = [];
    mockHeteroIngestMutate.mockImplementation(async ({ events }: any) => {
      const first = events[0];
      callOrder.push(`ingest:${first.type}:${first.data?.chunkType ?? 'terminal'}`);
      return { ack: true };
    });
    mockHeteroFinishMutate.mockImplementation(async () => {
      callOrder.push('finish');
      return { ack: true };
    });

    mockSpawnAgent.mockReturnValue(
      createFakeHandle({
        events: [
          {
            data: { chunkType: 'text', content: 'hello ' },
            operationId: 'op-server',
            stepIndex: 0,
            timestamp: 1,
            type: 'stream_chunk',
          },
          {
            data: { chunkType: 'text', content: 'world' },
            operationId: 'op-server',
            stepIndex: 0,
            timestamp: 2,
            type: 'stream_chunk',
          },
          {
            data: {
              chunkType: 'tools_calling',
              toolsCalling: [
                {
                  apiName: 'Bash',
                  arguments: '{"cmd":"ls"}',
                  id: 'tc-1',
                  identifier: 'bash',
                  type: 'default',
                },
              ],
            },
            operationId: 'op-server',
            stepIndex: 1,
            timestamp: 3,
            type: 'stream_chunk',
          },
          {
            data: { reason: 'success' },
            operationId: 'op-server',
            stepIndex: 1,
            timestamp: 4,
            type: 'agent_runtime_end',
          },
        ],
        exitCode: 0,
      }),
    );

    await runCmd([
      'hetero',
      'exec',
      '--type',
      'claude-code',
      '--prompt',
      'hi',
      '--topic',
      'topic-1',
      '--operation-id',
      'op-server',
      '--render',
      'none',
    ]);

    expect(mockHeteroIngestMutate).toHaveBeenCalledTimes(3);
    expect(mockHeteroIngestMutate.mock.calls[0][0].events[0].data).toMatchObject({
      chunkType: 'text',
      content: 'hello world',
      snapshotMode: 'replace',
      snapshotSeq: 1,
    });
    expect(callOrder).toEqual([
      'ingest:stream_chunk:text',
      'ingest:stream_chunk:tools_calling',
      'ingest:agent_runtime_end:terminal',
      'finish',
    ]);
  });

  it('finishes with result "error" when a terminal error event is pushed despite a clean exit', async () => {
    // CC relays an API/rate-limit error as an in-stream `error` event but still
    // exits 0. The finish result must NOT be derived from the exit code alone,
    // otherwise the topic/task is wrongly marked completed.
    mockSpawnAgent.mockReturnValue(
      createFakeHandle({
        events: [
          {
            data: {
              error: 'API Error: Server is temporarily limiting requests · Rate limited',
              message: 'API Error: Server is temporarily limiting requests · Rate limited',
            },
            operationId: 'op-err',
            stepIndex: 0,
            timestamp: 1,
            type: 'error',
          },
        ],
        exitCode: 0,
      }),
    );

    await runCmd([
      'hetero',
      'exec',
      '--type',
      'claude-code',
      '--prompt',
      'hi',
      '--topic',
      'topic-1',
      '--operation-id',
      'op-err',
      '--render',
      'none',
    ]);

    expect(mockHeteroFinishMutate).toHaveBeenCalledTimes(1);
    expect(mockHeteroFinishMutate.mock.calls[0][0]).toMatchObject({
      error: {
        message: 'API Error: Server is temporarily limiting requests · Rate limited',
        type: 'AgentRuntimeError',
      },
      result: 'error',
    });
  });

  it('resets the per-message text accumulator at message boundaries (no cross-message duplication)', async () => {
    // The `replace` snapshot accumulator must not span
    // message boundaries. Two assistant messages separated by a
    // stream_end/stream_start boundary must each snapshot only their OWN
    // text — otherwise the second message re-emits the first's text verbatim.
    const textSnapshots: string[] = [];
    mockHeteroIngestMutate.mockImplementation(async ({ events }: any) => {
      for (const e of events) {
        if (e.type === 'stream_chunk' && e.data?.chunkType === 'text') {
          textSnapshots.push(e.data.content);
        }
      }
      return { ack: true };
    });

    mockSpawnAgent.mockReturnValue(
      createFakeHandle({
        events: [
          {
            data: { chunkType: 'text', content: 'first message' },
            operationId: 'op-server',
            stepIndex: 0,
            timestamp: 1,
            type: 'stream_chunk',
          },
          { data: {}, operationId: 'op-server', stepIndex: 0, timestamp: 2, type: 'stream_end' },
          {
            data: { newStep: true, provider: 'claude-code' },
            operationId: 'op-server',
            stepIndex: 1,
            timestamp: 3,
            type: 'stream_start',
          },
          {
            data: { chunkType: 'text', content: 'second message' },
            operationId: 'op-server',
            stepIndex: 1,
            timestamp: 4,
            type: 'stream_chunk',
          },
          {
            data: { reason: 'success' },
            operationId: 'op-server',
            stepIndex: 1,
            timestamp: 5,
            type: 'agent_runtime_end',
          },
        ],
        exitCode: 0,
      }),
    );

    await runCmd([
      'hetero',
      'exec',
      '--type',
      'claude-code',
      '--prompt',
      'hi',
      '--topic',
      'topic-1',
      '--operation-id',
      'op-server',
      '--render',
      'none',
    ]);

    // Second snapshot carries ONLY the second message — not "first messagesecond message".
    expect(textSnapshots).toEqual(['first message', 'second message']);
  });

  it('forwards subagent text raw (no snapshot coalescing, no cross-scope pollution of main text)', async () => {
    // Subagent text is emitted as ONE full block per turn and the server's
    // subagent path *appends* it (no snapshot semantics). It must therefore
    // bypass the main-agent `replace`-snapshot coalescing: folding it into the
    // shared accumulator would (a) splice main text into the subagent message
    // and (b) make the server append a replace-snapshot → duplicated content.
    const ingested: any[] = [];
    mockHeteroIngestMutate.mockImplementation(async ({ events }: any) => {
      for (const e of events) ingested.push(e);
      return { ack: true };
    });

    const subagent = { parentToolCallId: 'task-1', subagentMessageId: 'msg-sub-1' };

    mockSpawnAgent.mockReturnValue(
      createFakeHandle({
        events: [
          // Main-agent streamed text delta (coalesced).
          {
            data: { chunkType: 'text', content: 'hello ' },
            operationId: 'op-server',
            stepIndex: 0,
            timestamp: 1,
            type: 'stream_chunk',
          },
          // Subagent full-block text — must pass through untouched.
          {
            data: { chunkType: 'text', content: 'I checked the files.', subagent },
            operationId: 'op-server',
            stepIndex: 0,
            timestamp: 2,
            type: 'stream_chunk',
          },
          {
            data: {
              chunkType: 'tools_calling',
              toolsCalling: [
                {
                  apiName: 'Bash',
                  arguments: '{"cmd":"ls"}',
                  id: 'tc-1',
                  identifier: 'bash',
                  type: 'default',
                },
              ],
            },
            operationId: 'op-server',
            stepIndex: 1,
            timestamp: 3,
            type: 'stream_chunk',
          },
          {
            data: { reason: 'success' },
            operationId: 'op-server',
            stepIndex: 1,
            timestamp: 4,
            type: 'agent_runtime_end',
          },
        ],
        exitCode: 0,
      }),
    );

    await runCmd([
      'hetero',
      'exec',
      '--type',
      'claude-code',
      '--prompt',
      'hi',
      '--topic',
      'topic-1',
      '--operation-id',
      'op-server',
      '--render',
      'none',
    ]);

    const textEvents = ingested.filter(
      (e) => e.type === 'stream_chunk' && e.data?.chunkType === 'text',
    );

    // Subagent text forwarded verbatim: keeps its subagent tag, original
    // content, and is NOT converted into a replace snapshot.
    const subagentText = textEvents.find((e) => e.data?.subagent);
    expect(subagentText).toBeDefined();
    expect(subagentText.data.content).toBe('I checked the files.');
    expect(subagentText.data.snapshotMode).toBeUndefined();

    // Main snapshot is untainted by the subagent block.
    const mainText = textEvents.find((e) => !e.data?.subagent);
    expect(mainText).toBeDefined();
    expect(mainText.data.content).toBe('hello ');
    expect(mainText.data.snapshotMode).toBe('replace');
    expect(mainText.data.content).not.toContain('I checked');
  });

  it('--raw-dump writes a session folder with meta.json, wires onRawStdout, and tees stderr', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'hetero-rawdump-'));

    mockSpawnAgent.mockReturnValue(
      createFakeHandle({
        events: [
          {
            data: { chunkType: 'text', content: 'hi' },
            operationId: 'op-raw',
            stepIndex: 0,
            timestamp: 1,
            type: 'stream_chunk',
          },
        ],
        exitCode: 0,
        stderrChunks: ['warning: something happened\n'],
      }),
    );

    await runCmd([
      'hetero',
      'exec',
      '--type',
      'claude-code',
      '--prompt',
      'hi',
      '--operation-id',
      'op-raw',
      '--render',
      'none',
      '--raw-dump',
      root,
    ]);

    // The raw stdout tee is handed to spawnAgent (the package captures the
    // pre-adapter bytes — exercised in spawnAgent.test.ts).
    expect(typeof mockSpawnAgent.mock.calls[0][0].onRawStdout).toBe('function');

    // One session folder per exec, keyed by the operation id.
    const sessions = await readdir(root);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toContain('op-raw');
    const sessionDir = path.join(root, sessions[0]!);

    const meta = JSON.parse(await readFile(path.join(sessionDir, 'meta.json'), 'utf8'));
    expect(meta).toMatchObject({ agentType: 'claude-code', operationId: 'op-raw' });

    // stderr is teed to the attempt's log file.
    const stderrDump = await readFile(path.join(sessionDir, 'attempt-1.stderr.log'), 'utf8');
    expect(stderrDump).toContain('warning: something happened');
  });
});
