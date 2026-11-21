import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ClaudeAgentSdkSession,
  resolveClaudeSdkExecutablePath,
  spawnClaudeCodeCliProcess,
} from './claudeAgentSdkSession';
import { resolveClaudeCodeTranscriptPath } from './ensureResumeTranscript';

const resolveCliSpawnPlanMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());
const sdkQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: sdkQueryMock }));

vi.mock('./cliSpawn', () => ({ resolveCliSpawnPlan: resolveCliSpawnPlanMock }));
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  spawn: spawnMock,
}));

describe('resolveClaudeSdkExecutablePath', () => {
  beforeEach(() => {
    resolveCliSpawnPlanMock.mockReset();
  });

  it.each(['C:\\Users\\user\\AppData\\Roaming\\npm\\claude.cmd', 'C:\\tools\\claude.BAT'])(
    'unwraps a Windows Node shim for the Agent SDK: %s',
    async (commandPath) => {
      const scriptPath =
        'C:\\Users\\user\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js';
      resolveCliSpawnPlanMock.mockResolvedValue({
        args: [scriptPath],
        command: 'C:\\Program Files\\nodejs\\node.exe',
      });

      await expect(resolveClaudeSdkExecutablePath(commandPath, process.env, 'win32')).resolves.toBe(
        scriptPath,
      );
      expect(resolveCliSpawnPlanMock).toHaveBeenCalledWith(commandPath, [], process.env);
    },
  );

  it('uses a native executable targeted by a Windows shim', async () => {
    const commandPath = 'C:\\tools\\claude.cmd';
    const executablePath = 'C:\\tools\\claude.exe';
    resolveCliSpawnPlanMock.mockResolvedValue({ args: [], command: executablePath });

    await expect(resolveClaudeSdkExecutablePath(commandPath, process.env, 'win32')).resolves.toBe(
      executablePath,
    );
  });

  it('reports an unresolved Windows shim before the SDK tries to spawn it', async () => {
    const commandPath = 'C:\\tools\\claude.cmd';
    resolveCliSpawnPlanMock.mockResolvedValue({ args: [], command: commandPath });

    await expect(resolveClaudeSdkExecutablePath(commandPath, process.env, 'win32')).rejects.toThrow(
      'Unable to resolve the Claude Code Windows shim',
    );
  });

  it('keeps a native Windows executable', async () => {
    const commandPath = 'C:\\tools\\claude.exe';

    await expect(resolveClaudeSdkExecutablePath(commandPath, process.env, 'win32')).resolves.toBe(
      commandPath,
    );
    expect(resolveCliSpawnPlanMock).not.toHaveBeenCalled();
  });

  it('keeps the detected executable on other platforms', async () => {
    const commandPath = '/opt/homebrew/bin/claude';

    await expect(resolveClaudeSdkExecutablePath(commandPath, process.env, 'darwin')).resolves.toBe(
      commandPath,
    );
    expect(resolveCliSpawnPlanMock).not.toHaveBeenCalled();
  });
});

describe('spawnClaudeCodeCliProcess', () => {
  const spawnOptions = {
    args: ['--output-format', 'stream-json'],
    command: '/usr/local/bin/claude',
    cwd: '/repo',
    env: { PATH: '/usr/bin' },
    signal: new AbortController().signal,
  };

  const fakeChild = () => {
    const child = new EventEmitter() as any;
    child.pid = 4321;
    child.stderr = new EventEmitter();
    return child;
  };

  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('reports the CLI child so a crashed host can reap it', () => {
    // The SDK runs a real Claude executable; without its identity, an orphan
    // left by a hard crash is still writing the transcript recovery replays.
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const onProcessSpawn = vi.fn();

    spawnClaudeCodeCliProcess(spawnOptions as any, { onProcessSpawn, onStderr: vi.fn() }, 'darwin');

    expect(onProcessSpawn).toHaveBeenCalledWith({
      args: ['/usr/local/bin/claude', '--output-format', 'stream-json'],
      command: '/usr/local/bin/claude',
      pid: 4321,
    });
    // Its own Unix process group, so reaping takes the tool children with it.
    expect(spawnMock.mock.calls[0][2]).toMatchObject({ cwd: '/repo', detached: true });
  });

  it('keeps the child out of a process group on Windows', () => {
    spawnMock.mockReturnValue(fakeChild());

    spawnClaudeCodeCliProcess(spawnOptions as any, { onStderr: vi.fn() }, 'win32');

    expect(spawnMock.mock.calls[0][2]).toMatchObject({ detached: false });
  });

  it('drains stderr the SDK no longer reads', () => {
    // The SDK only wires its own stderr option on the spawn it owns; an
    // unread pipe fills up and blocks the CLI.
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const onStderr = vi.fn();

    spawnClaudeCodeCliProcess(spawnOptions as any, { onStderr }, 'darwin');
    child.stderr.emit('data', Buffer.from('boom'));

    expect(onStderr).toHaveBeenCalledWith('boom');
  });
});

describe('ClaudeAgentSdkSession resume cost', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    sdkQueryMock.mockReset();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it('emits a resumed run its own cost, using the profile dir the CLI resumes from', async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), 'lobe-sdk-profile-'));
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'lobe-sdk-cwd-'));
    tempDirs.push(configDir, cwd);
    const sessionId = '72f65fa9-0355-45d3-b903-8f41027ed5f2';
    const transcript = (await resolveClaudeCodeTranscriptPath({ configDir, cwd, sessionId }))!;
    await mkdir(path.dirname(transcript), { recursive: true });
    await writeFile(
      transcript,
      `${JSON.stringify({ sessionId, totalCostUSD: 69.67, type: 'cost-state' })}\n`,
    );

    const messages = [
      { model: 'claude-sonnet-4-6', session_id: sessionId, subtype: 'init', type: 'system' },
      {
        is_error: false,
        result: 'done',
        session_id: sessionId,
        subtype: 'success',
        total_cost_usd: 76.43,
        type: 'result',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    ];
    sdkQueryMock.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        yield* messages;
      },
      close: vi.fn(),
    }));

    const events: any[] = [];
    const session = new ClaudeAgentSdkSession({
      args: [],
      commandPath: 'claude',
      configDir,
      cwd,
      env: {} as NodeJS.ProcessEnv,
      onEvents: (batch) => {
        events.push(...batch);
      },
      onRawMessage: () => {},
      onRuntimeStatus: () => {},
      onSessionId: () => {},
      onStderr: () => {},
      operationId: 'op-sdk-resume',
      resumeSessionId: sessionId,
      sessionId: 'session-1',
      stdinPayload: `${JSON.stringify({
        message: { content: 'continue', role: 'user' },
        type: 'user',
      })}\n`,
    });
    await session.run();

    const resultUsage = events.find(
      (e) => e.type === 'step_complete' && e.data?.phase === 'result_usage',
    );
    expect(resultUsage?.data.costUsd).toBeCloseTo(6.76);
  });
});

describe('ClaudeAgentSdkSession plugins', () => {
  afterEach(() => {
    sdkQueryMock.mockReset();
  });

  const optionsFor = async (args: string[]) => {
    sdkQueryMock.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {},
      close: vi.fn(),
    }));
    await new ClaudeAgentSdkSession({
      args,
      commandPath: 'claude',
      cwd: os.tmpdir(),
      env: {} as NodeJS.ProcessEnv,
      onEvents: () => {},
      onRawMessage: () => {},
      onRuntimeStatus: () => {},
      onSessionId: () => {},
      onStderr: () => {},
      operationId: 'op-sdk-plugins',
      sessionId: 'session-1',
      stdinPayload: `${JSON.stringify({ message: { content: 'hi', role: 'user' }, type: 'user' })}\n`,
    }).run();
    return sdkQueryMock.mock.calls[0][0].options;
  };

  // `extraArgs` holds one value per flag, so a user's own `--plugin-dir` and the
  // one carrying the `lh` guide would overwrite each other there.
  it('loads every `--plugin-dir` as a session plugin', async () => {
    const options = await optionsFor(['--plugin-dir', '/user/plugin', '--plugin-dir', '/lobehub']);

    expect(options.plugins).toEqual([
      { path: '/user/plugin', type: 'local' },
      { path: '/lobehub', type: 'local' },
    ]);
    expect(options.extraArgs?.['plugin-dir']).toBeUndefined();
  });

  it('passes an appended system prompt through to the CLI', async () => {
    const options = await optionsFor(['--append-system-prompt', 'guide']);

    expect(options.extraArgs).toEqual({ 'append-system-prompt': 'guide' });
    expect(options).not.toHaveProperty('plugins');
  });
});

describe('ClaudeAgentSdkSession.stopTask', () => {
  afterEach(() => {
    sdkQueryMock.mockReset();
  });

  const newSession = () =>
    new ClaudeAgentSdkSession({
      args: [],
      commandPath: 'claude',
      cwd: os.tmpdir(),
      env: {} as NodeJS.ProcessEnv,
      onEvents: () => {},
      onRawMessage: () => {},
      onRuntimeStatus: () => {},
      onSessionId: () => {},
      onStderr: () => {},
      operationId: 'op-sdk-stop',
      sessionId: 'session-1',
      stdinPayload: `${JSON.stringify({ message: { content: 'hi', role: 'user' }, type: 'user' })}\n`,
    });

  it('asks the running query to stop the task', async () => {
    const stopTask = vi.fn().mockResolvedValue(undefined);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    sdkQueryMock.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        await held;
        yield* [];
      },
      close: vi.fn(),
      stopTask,
    }));

    const session = newSession();
    const running = session.run();
    await vi.waitFor(() => expect(sdkQueryMock).toHaveBeenCalled());

    await session.stopTask('bys1w0wxo');
    expect(stopTask).toHaveBeenCalledWith('bys1w0wxo');

    release();
    await running;
  });

  it('refuses once the query ended', async () => {
    sdkQueryMock.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {},
      close: vi.fn(),
      stopTask: vi.fn(),
    }));
    const session = newSession();
    await session.run();

    await expect(session.stopTask('bys1w0wxo')).rejects.toThrow('no longer running');
  });
});

describe('ClaudeAgentSdkSession input lifetime', () => {
  afterEach(() => {
    sdkQueryMock.mockReset();
  });

  const sessionWith = (script: (input: { ended: () => boolean }) => AsyncGenerator<any>) => {
    sdkQueryMock.mockImplementation(({ prompt }: { prompt: AsyncIterable<unknown> }) => {
      let inputEnded = false;
      void (async () => {
        for await (const _ of prompt) {
          // drain
        }
        inputEnded = true;
      })();
      const messages = script({ ended: () => inputEnded });
      return { [Symbol.asyncIterator]: () => messages, close: vi.fn(), stopTask: vi.fn() };
    });
    return new ClaudeAgentSdkSession({
      args: [],
      commandPath: 'claude',
      cwd: os.tmpdir(),
      env: {} as NodeJS.ProcessEnv,
      onEvents: () => {},
      onRawMessage: () => {},
      onRuntimeStatus: () => {},
      onSessionId: () => {},
      onStderr: () => {},
      operationId: 'op-sdk-input',
      resumeSessionId: 'cc-session',
      sessionId: 'session-1',
      stdinPayload: `${JSON.stringify({ message: { content: 'hi', role: 'user' }, type: 'user' })}\n`,
    });
  };

  const settle = () => new Promise((resolve) => setTimeout(resolve, 1200));
  const result = (extra: Record<string, unknown> = {}) => ({
    is_error: false,
    num_turns: 1,
    result: 'done',
    subtype: 'success',
    type: 'result',
    ...extra,
  });
  const notificationResult = (numTurns: number) =>
    result({ num_turns: numTurns, origin: { kind: 'task-notification' }, result: '' });
  const taskStarted = (id: string) => ({
    description: 'ping',
    subtype: 'task_started',
    task_id: id,
    tool_use_id: `toolu_${id}`,
    type: 'system',
  });
  const taskNotification = (id: string) => ({
    output_file: '',
    status: 'completed',
    subtype: 'task_notification',
    summary: 'ping',
    task_id: id,
    type: 'system',
  });

  // Recorded from a resumed desktop SDK run: the previous run's stopped task is
  // reported, its empty pass closes, then this run's own turn starts a task.
  it('keeps the input open for a task started after a resumed session reports leftovers', async () => {
    const seen: boolean[] = [];
    const session = sessionWith(async function* ({ ended }) {
      yield taskNotification('leftover');
      yield notificationResult(0);
      yield { model: 'claude-haiku', session_id: 'cc-session', subtype: 'init', type: 'system' };
      yield taskStarted('b1');
      yield result();
      await settle();
      seen.push(ended());
      yield taskNotification('b1');
      yield notificationResult(1);
      await settle();
      seen.push(ended());
    });

    await session.run();
    expect(seen).toEqual([false, true]);
  });

  it('keeps the input open while a second task still runs after the first one ends', async () => {
    const seen: boolean[] = [];
    const session = sessionWith(async function* ({ ended }) {
      yield taskStarted('b1');
      yield taskStarted('b2');
      yield result();
      yield taskNotification('b1');
      yield notificationResult(1);
      await settle();
      seen.push(ended());
      yield taskNotification('b2');
      yield notificationResult(1);
      await settle();
      seen.push(ended());
    });

    await session.run();
    expect(seen).toEqual([false, true]);
  });

  // Recorded from claude 2.1.308: `task_updated(killed)` then
  // `task_notification(stopped)`, and no `result` after it.
  it('ends the session when the last task is stopped between turns', async () => {
    const seen: boolean[] = [];
    const session = sessionWith(async function* ({ ended }) {
      yield taskStarted('b1');
      yield result();
      await settle();
      seen.push(ended());
      yield { ...taskNotification('b1'), status: 'stopped' };
      await settle();
      seen.push(ended());
    });

    await session.run();
    expect(seen).toEqual([false, true]);
  });

  it("leaves a task stopped mid-turn to that turn's own result", async () => {
    const seen: boolean[] = [];
    const session = sessionWith(async function* ({ ended }) {
      yield { model: 'claude-haiku', session_id: 'cc-session', subtype: 'init', type: 'system' };
      yield taskStarted('b1');
      yield { ...taskNotification('b1'), status: 'stopped' };
      await settle();
      seen.push(ended());
      yield result();
      await settle();
      seen.push(ended());
    });

    await session.run();
    expect(seen).toEqual([false, true]);
  });
});

describe('ClaudeAgentSdkSession steer', () => {
  afterEach(() => {
    sdkQueryMock.mockReset();
  });

  it('hands a steered message to the running query, with no priority, and waits for its answer', async () => {
    const steeredInputs: any[] = [];
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let queryOptions: any;
    sdkQueryMock.mockImplementation(({ options, prompt }) => {
      queryOptions = options;
      const input = prompt[Symbol.asyncIterator]();
      return {
        async *[Symbol.asyncIterator]() {
          await input.next();
          yield { session_id: 's', subtype: 'init', type: 'system' };
          ready();
          const steered = await input.next();
          steeredInputs.push(steered.value);
          // Written as the cycle ended: its result comes before the message is read.
          yield {
            is_error: false,
            subtype: 'success',
            terminal_reason: 'completed',
            type: 'result',
          };
          yield {
            isReplay: true,
            message: { content: 'x', role: 'user' },
            type: 'user',
            uuid: 'steer-1',
          };
          yield { is_error: false, result: 'ok', subtype: 'success', type: 'result' };
          // Answered: input closes, and the query ends.
          expect((await input.next()).done).toBe(true);
        },
        close: vi.fn(),
      };
    });

    const session = new ClaudeAgentSdkSession({
      args: [],
      commandPath: 'claude',
      cwd: os.tmpdir(),
      env: {} as NodeJS.ProcessEnv,
      onEvents: () => {},
      onRawMessage: () => {},
      onRuntimeStatus: () => {},
      onSessionId: () => {},
      onStderr: () => {},
      operationId: 'op-steer',
      replayUserMessages: true,
      sessionId: 'session-1',
      stdinPayload: `${JSON.stringify({ message: { content: 'go', role: 'user' }, type: 'user' })}\n`,
    });
    const running = session.run();
    await started;

    expect(
      session.steer(
        {
          message: { content: 'also this', role: 'user' },
          parent_tool_use_id: null,
          type: 'user',
        } as any,
        'steer-1',
      ),
    ).toBe(true);
    await running;

    expect(steeredInputs[0]).toMatchObject({ type: 'user', uuid: 'steer-1' });
    expect(steeredInputs[0]).not.toHaveProperty('priority');
    expect(queryOptions.extraArgs).toMatchObject({ 'replay-user-messages': null });
    // Input has closed: a later steer goes as a turn of its own.
    expect(session.steer({ message: { content: 'late', role: 'user' } } as any, 'steer-2')).toBe(
      false,
    );
  });
});

describe('ClaudeAgentSdkSession steer and background-task notifications', () => {
  afterEach(() => {
    sdkQueryMock.mockReset();
  });

  it('settles a notification turn that ends while a steer waits, so input still closes after it', async () => {
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let inputDone = false;
    sdkQueryMock.mockImplementation(({ prompt }) => {
      const input = prompt[Symbol.asyncIterator]();
      return {
        async *[Symbol.asyncIterator]() {
          await input.next();
          yield { session_id: 's', subtype: 'init', type: 'system' };
          yield { session_id: 's', subtype: 'task_started', task_id: 't1', type: 'system' };
          ready();
          await input.next(); // the steer
          yield { session_id: 's', subtype: 'task_notification', task_id: 't1', type: 'system' };
          // The notification's turn ends before the steer is read.
          yield {
            is_error: false,
            origin: { kind: 'task-notification' },
            subtype: 'success',
            type: 'result',
          };
          yield {
            isReplay: true,
            message: { content: 'x', role: 'user' },
            type: 'user',
            uuid: 'steer-1',
          };
          yield { is_error: false, subtype: 'success', type: 'result' };
          inputDone = (await input.next()).done === true;
        },
        close: vi.fn(),
      };
    });

    const session = new ClaudeAgentSdkSession({
      args: [],
      commandPath: 'claude',
      cwd: os.tmpdir(),
      env: {} as NodeJS.ProcessEnv,
      onEvents: () => {},
      onRawMessage: () => {},
      onRuntimeStatus: () => {},
      onSessionId: () => {},
      onStderr: () => {},
      operationId: 'op-notify',
      replayUserMessages: true,
      sessionId: 'session-1',
      stdinPayload: `${JSON.stringify({ message: { content: 'go', role: 'user' }, type: 'user' })}\n`,
    });
    const running = session.run();
    await started;
    session.steer({ message: { content: 'also', role: 'user' }, type: 'user' } as any, 'steer-1');
    await running;

    // The steer's answer closed input: no notification left pending holds it open.
    expect(inputDone).toBe(true);
  });
});
