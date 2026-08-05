import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildCodexAppServerArgs,
  buildCodexAppServerInput,
  buildCodexAppServerThreadParams,
  CodexAppServerSession,
  getCodexAppServerUnsupportedArgs,
} from './codexAppServerSession';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, spawn: spawnMock };
});

interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
}

const createAppServerProcess = ({ autoComplete = true, requestApproval = false } = {}) => {
  const child = new EventEmitter() as any;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const requests: RpcMessage[] = [];

  const send = (message: Record<string, unknown>) => {
    stdout.write(`${JSON.stringify(message)}\n`);
  };

  child.pid = 987_654;
  child.killed = false;
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });
  child.stdin = {
    on: vi.fn(),
    write: vi.fn((chunk: string) => {
      const message = JSON.parse(chunk.trim()) as RpcMessage;
      requests.push(message);

      queueMicrotask(() => {
        switch (message.method) {
          case 'initialize': {
            send({ id: message.id, result: { userAgent: 'codex-test' } });
            return;
          }
          case 'thread/start':
          case 'thread/resume': {
            send({
              id: message.id,
              result: { model: 'gpt-5.5-codex', thread: { id: 'thread-1' } },
            });
            return;
          }
          case 'turn/start': {
            send({ id: message.id, result: { turn: { id: 'turn-1' } } });
            if (requestApproval) {
              send({
                id: 'approval-1',
                method: 'item/commandExecution/requestApproval',
                params: {
                  command: 'pwd',
                  itemId: 'command-1',
                  threadId: 'thread-1',
                  turnId: 'turn-1',
                },
              });
            }
            send({
              method: 'turn/started',
              params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'inProgress' } },
            });
            if (!autoComplete) return;
            send({
              method: 'item/started',
              params: {
                item: {
                  aggregatedOutput: null,
                  command: 'pwd',
                  exitCode: null,
                  id: 'command-1',
                  status: 'inProgress',
                  type: 'commandExecution',
                },
                threadId: 'thread-1',
                turnId: 'turn-1',
              },
            });
            send({
              method: 'item/commandExecution/outputDelta',
              params: {
                delta: '/work',
                itemId: 'command-1',
                threadId: 'thread-1',
                turnId: 'turn-1',
              },
            });
            send({
              method: 'item/commandExecution/outputDelta',
              params: {
                delta: 'space\n',
                itemId: 'command-1',
                threadId: 'thread-1',
                turnId: 'turn-1',
              },
            });
            send({
              method: 'item/completed',
              params: {
                item: {
                  aggregatedOutput: '/workspace\n',
                  command: 'pwd',
                  exitCode: 0,
                  id: 'command-1',
                  status: 'completed',
                  type: 'commandExecution',
                },
                threadId: 'thread-1',
                turnId: 'turn-1',
              },
            });
            send({
              method: 'turn/plan/updated',
              params: {
                explanation: null,
                plan: [
                  { status: 'completed', step: 'Inspect' },
                  { status: 'inProgress', step: 'Implement' },
                ],
                threadId: 'thread-1',
                turnId: 'turn-1',
              },
            });
            send({
              method: 'item/started',
              params: {
                item: {
                  changes: [],
                  id: 'file-1',
                  status: 'inProgress',
                  type: 'fileChange',
                },
                threadId: 'thread-1',
                turnId: 'turn-1',
              },
            });
            send({
              method: 'turn/diff/updated',
              params: {
                diff: '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n',
                threadId: 'thread-1',
                turnId: 'turn-1',
              },
            });
            send({
              method: 'item/completed',
              params: {
                item: {
                  changes: [
                    {
                      diff: '@@ -1 +1 @@\n-old\n+new\n',
                      kind: { type: 'update' },
                      path: 'a.ts',
                    },
                  ],
                  id: 'file-1',
                  status: 'completed',
                  type: 'fileChange',
                },
                threadId: 'thread-1',
                turnId: 'turn-1',
              },
            });
            send({
              method: 'item/agentMessage/delta',
              params: {
                delta: 'hello ',
                itemId: 'message-1',
                threadId: 'thread-1',
                turnId: 'turn-1',
              },
            });
            send({
              method: 'item/agentMessage/delta',
              params: {
                delta: 'world',
                itemId: 'message-1',
                threadId: 'thread-1',
                turnId: 'turn-1',
              },
            });
            send({
              method: 'item/completed',
              params: {
                item: {
                  id: 'message-1',
                  text: 'hello world',
                  type: 'agentMessage',
                },
                threadId: 'thread-1',
                turnId: 'turn-1',
              },
            });
            send({
              method: 'thread/tokenUsage/updated',
              params: {
                threadId: 'thread-1',
                tokenUsage: {
                  total: {
                    cachedInputTokens: 2,
                    inputTokens: 10,
                    outputTokens: 4,
                    reasoningOutputTokens: 1,
                    totalTokens: 14,
                  },
                },
                turnId: 'turn-1',
              },
            });
            send({
              method: 'turn/completed',
              params: {
                threadId: 'thread-1',
                turn: { id: 'turn-1', status: 'completed' },
              },
            });
            return;
          }
          case 'turn/interrupt': {
            send({ id: message.id, result: {} });
            send({
              method: 'turn/completed',
              params: {
                threadId: 'thread-1',
                turn: { id: 'turn-1', status: 'interrupted' },
              },
            });
          }
        }
      });
      return true;
    }),
  };

  return { child, requests, send };
};

afterEach(() => {
  vi.restoreAllMocks();
  spawnMock.mockReset();
});

describe('CodexAppServerSession', () => {
  it('maps app-server notifications through the existing Codex event pipeline', async () => {
    const { child, requests } = createAppServerProcess();
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const events: any[] = [];
    const statuses: any[] = [];
    const sessionIds: string[] = [];

    const session = new CodexAppServerSession({
      args: [
        '--model',
        'gpt-5.5-codex',
        '--cd',
        'nested',
        '--ephemeral',
        '-c',
        'model_reasoning_effort="high"',
      ],
      clientVersion: '1.0.0',
      commandPath: 'codex',
      cwd: '/workspace',
      env: process.env,
      input: [{ text: 'hello', text_elements: [], type: 'text' }],
      onEvents: (batch) => {
        events.push(...batch);
      },
      onRawMessage: vi.fn(),
      onRuntimeStatus: (status) => statuses.push(status),
      onSessionId: (sessionId) => sessionIds.push(sessionId),
      onStderr: vi.fn(),
      operationId: 'operation-1',
      sessionId: 'session-1',
    });

    await session.run();

    expect(spawnMock).toHaveBeenCalledWith(
      'codex',
      ['-c', 'model_reasoning_effort="high"', 'app-server'],
      expect.objectContaining({ cwd: '/workspace', stdio: ['pipe', 'pipe', 'pipe'] }),
    );
    expect(requests.map(({ method }) => method).filter(Boolean)).toEqual([
      'initialize',
      'initialized',
      'thread/start',
      'turn/start',
    ]);
    expect(requests).toContainEqual({
      id: expect.any(Number),
      method: 'thread/start',
      params: {
        approvalPolicy: 'never',
        cwd: '/workspace/nested',
        ephemeral: true,
        model: 'gpt-5.5-codex',
        sandbox: 'danger-full-access',
      },
    });
    expect(sessionIds).toEqual([]);
    expect(
      events
        .filter((event) => event.type === 'stream_chunk' && event.data?.chunkType === 'text')
        .map((event) => event.data.content),
    ).toEqual(['hello ', 'world']);
    expect(events.some((event) => event.type === 'tool_start')).toBe(true);
    expect(events.some((event) => event.type === 'tool_result')).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'stream_chunk' &&
          event.data?.chunkType === 'tool_state' &&
          event.data?.pluginState?.stdout === '/workspace\n',
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'tool_result' && event.data?.pluginState?.changes?.[0]?.kind === 'update',
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'stream_chunk' &&
          event.data?.pluginState?.todos?.items?.[1]?.text === 'Implement',
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'stream_chunk' &&
          event.data?.pluginState?.changes?.[0]?.diffText?.includes('+++ b/a.ts'),
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === 'agent_runtime_end')).toBe(true);
    expect(
      events.some(
        (event) => event.type === 'step_complete' && event.data?.usage?.totalTokens === 14,
      ),
    ).toBe(true);
    expect(statuses.map(({ state }) => state)).toEqual(['starting', 'running', 'idle', 'closed']);
    expect(statuses.every(({ transport }) => transport === 'codex-app-server')).toBe(true);
  });

  it('interrupts an active turn through RPC instead of killing the process', async () => {
    const { child, requests } = createAppServerProcess({ autoComplete: false });
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const events: any[] = [];
    const statuses: any[] = [];
    const session = new CodexAppServerSession({
      args: [],
      clientVersion: '1.0.0',
      commandPath: 'codex',
      cwd: '/workspace',
      env: process.env,
      input: [{ text: 'wait', text_elements: [], type: 'text' }],
      onEvents: (batch) => {
        events.push(...batch);
      },
      onRawMessage: vi.fn(),
      onRuntimeStatus: (status) => statuses.push(status),
      onSessionId: vi.fn(),
      onStderr: vi.fn(),
      operationId: 'operation-1',
      sessionId: 'session-1',
    });

    const run = session.run();
    await vi.waitFor(() => expect(statuses.some(({ state }) => state === 'running')).toBe(true));
    await session.interrupt();
    await run;

    expect(requests).toContainEqual({
      id: expect.any(Number),
      method: 'turn/interrupt',
      params: { threadId: 'thread-1', turnId: 'turn-1' },
    });
    expect(child.kill).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({ reason: 'interrupted' }),
        type: 'agent_runtime_end',
      }),
    );
  });

  it('surfaces a process exit that races between thread setup and turn start', async () => {
    const { child } = createAppServerProcess({ autoComplete: false });
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    const session = new CodexAppServerSession({
      args: [],
      clientVersion: '1.0.0',
      commandPath: 'codex',
      cwd: '/workspace',
      env: process.env,
      input: [{ text: 'hello', text_elements: [], type: 'text' }],
      onEvents: vi.fn(),
      onRawMessage: vi.fn(),
      onRuntimeStatus: vi.fn(),
      onSessionId: () => child.emit('exit', 1, null),
      onStderr: vi.fn(),
      operationId: 'operation-1',
      sessionId: 'session-1',
    });

    await expect(session.run()).rejects.toThrow(
      'Codex app-server exited before the turn completed (code 1, signal null)',
    );
  });

  it('resumes a non-interactive thread and cancels unexpected approval requests', async () => {
    const { child, requests } = createAppServerProcess({ requestApproval: true });
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const onSessionId = vi.fn();

    const session = new CodexAppServerSession({
      args: ['-s', 'read-only', '-a', 'never'],
      clientVersion: '1.0.0',
      commandPath: 'codex',
      cwd: '/workspace',
      env: process.env,
      input: [{ text: 'continue', text_elements: [], type: 'text' }],
      onEvents: vi.fn(),
      onRawMessage: vi.fn(),
      onRuntimeStatus: vi.fn(),
      onSessionId,
      onStderr: vi.fn(),
      operationId: 'operation-1',
      resumeSessionId: 'thread-existing',
      sessionId: 'session-1',
    });

    await session.run();

    expect(requests).toContainEqual({
      id: expect.any(Number),
      method: 'thread/resume',
      params: {
        approvalPolicy: 'never',
        cwd: '/workspace',
        sandbox: 'read-only',
        threadId: 'thread-existing',
      },
    });
    expect(requests).toContainEqual({ id: 'approval-1', result: { decision: 'cancel' } });
    expect(onSessionId).toHaveBeenCalledWith('thread-1');
  });

  it('ignores terminal notifications for another thread', async () => {
    const { child, send } = createAppServerProcess({ autoComplete: false });
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const statuses: any[] = [];

    const session = new CodexAppServerSession({
      args: [],
      clientVersion: '1.0.0',
      commandPath: 'codex',
      cwd: '/workspace',
      env: process.env,
      input: [{ text: 'hello', text_elements: [], type: 'text' }],
      onEvents: vi.fn(),
      onRawMessage: vi.fn(),
      onRuntimeStatus: (status) => statuses.push(status),
      onSessionId: vi.fn(),
      onStderr: vi.fn(),
      operationId: 'operation-1',
      sessionId: 'session-1',
    });

    const run = session.run();
    await vi.waitFor(() => expect(statuses.some(({ state }) => state === 'running')).toBe(true));
    send({
      method: 'turn/completed',
      params: {
        threadId: 'another-thread',
        turn: { id: 'another-turn', status: 'completed' },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(statuses.some(({ state }) => state === 'idle')).toBe(false);

    await session.interrupt();
    await run;
  });
});

describe('Codex app-server payload builders', () => {
  it('starts only the app-server subcommand and translates runtime flags into thread params', () => {
    expect(buildCodexAppServerArgs()).toEqual(['app-server']);
    expect(
      buildCodexAppServerArgs([
        '--model',
        'gpt-5.5-codex',
        '-c',
        'model_reasoning_effort="high"',
        '--config=service_tier="fast"',
      ]),
    ).toEqual([
      '-c',
      'model_reasoning_effort="high"',
      '--config=service_tier="fast"',
      'app-server',
    ]);
    expect(
      buildCodexAppServerThreadParams(
        [
          '--model',
          'gpt-5.5-codex',
          '-s',
          'read-only',
          '-a',
          'never',
          '--cd',
          'nested',
          '--ephemeral',
          '-c',
          'model_reasoning_effort="high"',
          '-c',
          'model_provider="openai"',
          '--config=service_tier="fast"',
        ],
        '/workspace',
      ),
    ).toEqual({
      approvalPolicy: 'never',
      cwd: '/workspace/nested',
      ephemeral: true,
      model: 'gpt-5.5-codex',
      modelProvider: 'openai',
      sandbox: 'read-only',
      serviceTier: 'fast',
    });
    expect(buildCodexAppServerThreadParams(['--full-auto'], '/workspace')).toMatchObject({
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
    });
    expect(
      buildCodexAppServerThreadParams(['--dangerously-bypass-approvals-and-sandbox'], '/workspace'),
    ).toMatchObject({ approvalPolicy: 'never', sandbox: 'danger-full-access' });
  });

  it('falls back for unsupported or interactive CLI arguments instead of dropping them', () => {
    expect(getCodexAppServerUnsupportedArgs(['--profile', 'work'])).toEqual(['--profile']);
    expect(getCodexAppServerUnsupportedArgs(['--ignore-user-config'])).toEqual([
      '--ignore-user-config',
    ]);
    expect(getCodexAppServerUnsupportedArgs(['--full-auto'])).toEqual(['--full-auto']);
    expect(getCodexAppServerUnsupportedArgs(['-a', 'on-request'])).toEqual(['-a']);
    expect(getCodexAppServerUnsupportedArgs(['-c', 'approval_policy="untrusted"'])).toEqual(['-c']);
    expect(getCodexAppServerUnsupportedArgs(['--search'])).toEqual(['--search']);
    expect(getCodexAppServerUnsupportedArgs(['--model', '--ephemeral'])).toEqual(['--model']);
    expect(getCodexAppServerUnsupportedArgs(['--sandbox', 'invalid'])).toEqual(['--sandbox']);
    expect(
      getCodexAppServerUnsupportedArgs([
        '--dangerously-bypass-approvals-and-sandbox',
        '--sandbox',
        'read-only',
      ]),
    ).toEqual(['--dangerously-bypass-approvals-and-sandbox']);
    expect(getCodexAppServerUnsupportedArgs(['--ephemeral'], { resume: true })).toEqual([
      '--ephemeral',
    ]);
    expect(
      getCodexAppServerUnsupportedArgs([
        '--model',
        'gpt-5.5-codex',
        '-c',
        'service_tier="fast"',
        '--cd=src',
        '--ephemeral',
      ]),
    ).toEqual([]);
  });

  it('converts Codex text and --image args into v2 turn inputs', () => {
    expect(
      buildCodexAppServerInput({
        args: ['--image', '/tmp/a.png', '--image', '/tmp/b.jpg'],
        stdin: 'describe these',
      }),
    ).toEqual([
      { text: 'describe these', text_elements: [], type: 'text' },
      { path: '/tmp/a.png', type: 'localImage' },
      { path: '/tmp/b.jpg', type: 'localImage' },
    ]);
  });
});
