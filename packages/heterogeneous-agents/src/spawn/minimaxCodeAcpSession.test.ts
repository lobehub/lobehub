import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildMinimaxCodeAcpArgs,
  buildMinimaxCodeAcpPrompt,
  type MinimaxCodeAcpPromptBlock,
  MinimaxCodeAcpSession,
  type MinimaxCodeAcpSessionOptions,
} from './minimaxCodeAcpSession';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, spawn: spawnMock };
});

interface RpcMessage {
  error?: unknown;
  id?: number | string;
  jsonrpc?: string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
}

interface FakeAcpProcessOptions {
  initializeResult?: Record<string, unknown>;
  onMessage?: (message: RpcMessage, context: { child: ChildProcess; send: Send }) => boolean | void;
}

type Send = (message: Record<string, unknown>) => void;

const createAcpProcess = (options: FakeAcpProcessOptions = {}) => {
  const child = new EventEmitter() as ChildProcess;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const requests: RpcMessage[] = [];
  const send: Send = (message) => stdout.write(`${JSON.stringify(message)}\n`);

  Object.assign(child, {
    kill: vi.fn(() => true),
    killed: false,
    pid: 987_654,
    stderr,
    stdin: {
      once: vi.fn(),
      write: vi.fn((chunk: string) => {
        const message = JSON.parse(chunk.trim()) as RpcMessage;
        requests.push(message);
        queueMicrotask(() => {
          if (options.onMessage?.(message, { child, send })) return;
          switch (message.method) {
            case 'initialize': {
              send({
                id: message.id,
                result: options.initializeResult ?? {
                  agentCapabilities: {
                    loadSession: true,
                    promptCapabilities: { image: false },
                    sessionCapabilities: { resume: true },
                  },
                  protocolVersion: 1,
                },
              });
              return;
            }
            case 'session/new':
            case 'session/load':
            case 'session/resume': {
              send({ id: message.id, result: { sessionId: 'mcode-session-1' } });
              return;
            }
            case 'session/close': {
              send({ id: message.id, result: {} });
              return;
            }
            case 'session/prompt': {
              send({ id: message.id, result: { stopReason: 'end_turn' } });
            }
          }
        });
        return true;
      }),
    },
    stdout,
  });

  return { child, requests, send, stderr, stdout };
};

const createSessionOptions = (
  overrides: Partial<MinimaxCodeAcpSessionOptions> = {},
): MinimaxCodeAcpSessionOptions => ({
  args: ['--feature=test'],
  clientVersion: '1.2.3',
  commandPath: 'mcode',
  cwd: '/workspace',
  env: process.env,
  onEvents: vi.fn(),
  onRawMessage: vi.fn(),
  onRuntimeStatus: vi.fn(),
  onSessionId: vi.fn(),
  onStderr: vi.fn(),
  operationId: 'operation-1',
  prompt: 'hello',
  sessionId: 'session-1',
  ...overrides,
});

const collectEvents = (options: MinimaxCodeAcpSessionOptions) => {
  const events: AgentStreamEvent[] = [];
  options.onEvents = (batch) => {
    events.push(...batch);
  };
  return events;
};

afterEach(() => {
  vi.restoreAllMocks();
  spawnMock.mockReset();
});

describe('MiniMax Code ACP helpers', () => {
  it('builds the fixed ACP argv before user arguments', () => {
    expect(buildMinimaxCodeAcpArgs(['--feature=test'])).toEqual(['acp', '--feature=test']);
  });

  it('builds ACP text prompt blocks', async () => {
    await expect(buildMinimaxCodeAcpPrompt('hello')).resolves.toEqual([
      { text: 'hello', type: 'text' },
    ]);
  });
});

describe('MinimaxCodeAcpSession', () => {
  it('initializes ACP v1, starts a session, streams updates, and completes', async () => {
    const { child, requests, send } = createAcpProcess({
      onMessage: (message) => {
        if (message.method !== 'session/prompt') return;
        send({
          method: 'session/update',
          params: {
            sessionId: 'mcode-session-1',
            update: {
              content: { text: 'Hello from MiniMax', type: 'text' },
              sessionUpdate: 'agent_message_chunk',
            },
          },
        });
        send({ id: message.id, result: { stopReason: 'end_turn' } });
        return true;
      },
    });
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const options = createSessionOptions();
    const events = collectEvents(options);

    await new MinimaxCodeAcpSession(options).run();

    expect(spawnMock).toHaveBeenCalledWith(
      'mcode',
      ['acp', '--feature=test'],
      expect.objectContaining({ cwd: '/workspace' }),
    );
    expect(requests[0]).toMatchObject({
      method: 'initialize',
      params: {
        clientCapabilities: { auth: { terminal: true } },
        clientInfo: { name: 'lobehub', title: 'LobeHub', version: '1.2.3' },
        protocolVersion: 1,
      },
    });
    expect(requests.map((request) => request.method)).toEqual([
      'initialize',
      'session/new',
      'session/prompt',
    ]);
    expect(options.onSessionId).toHaveBeenCalledWith('mcode-session-1');
    expect(
      events
        .filter((event) => event.type === 'stream_chunk' && event.data?.chunkType === 'text')
        .map((event) => event.data.content),
    ).toEqual(['Hello from MiniMax']);
  });

  it('resumes with session/resume when the capability is advertised', async () => {
    const { child, requests } = createAcpProcess();
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    await new MinimaxCodeAcpSession(createSessionOptions({ resumeSessionId: 'old-session' })).run();

    expect(requests.map((request) => request.method)).toEqual([
      'initialize',
      'session/resume',
      'session/prompt',
    ]);
    expect(requests[1]).toMatchObject({
      method: 'session/resume',
      params: { cwd: '/workspace', mcpServers: [], sessionId: 'old-session' },
    });
  });

  it('falls back to session/load when resume is unavailable', async () => {
    const { child, requests } = createAcpProcess({
      initializeResult: {
        agentCapabilities: { loadSession: true, promptCapabilities: { image: false } },
        protocolVersion: 1,
      },
    });
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    await new MinimaxCodeAcpSession(createSessionOptions({ resumeSessionId: 'old-session' })).run();

    expect(requests.map((request) => request.method)).toEqual([
      'initialize',
      'session/load',
      'session/prompt',
    ]);
  });

  it('surfaces a resume failure instead of creating a fresh session', async () => {
    const { child, requests } = createAcpProcess({
      onMessage: (message, { send }) => {
        if (message.method !== 'session/resume') return;
        send({ error: { code: -32_000, message: 'session not found' }, id: message.id });
        return true;
      },
    });
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    await expect(
      new MinimaxCodeAcpSession(createSessionOptions({ resumeSessionId: 'old-session' })).run(),
    ).rejects.toThrow('could not resume session old-session');
    expect(requests.some((request) => request.method === 'session/new')).toBe(false);
  });

  it('rejects image prompts when the agent reports image: false', async () => {
    const { child, requests } = createAcpProcess();
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const imagePrompt: MinimaxCodeAcpPromptBlock[] = [
      { data: 'aGVsbG8=', mimeType: 'image/png', type: 'image' },
    ];

    await expect(
      new MinimaxCodeAcpSession(createSessionOptions({ prompt: imagePrompt })).run(),
    ).rejects.toThrow('does not support image prompt blocks');
    expect(requests.some((request) => request.method === 'session/new')).toBe(false);
  });

  it('maps unauthenticated session/new to the mcode login error', async () => {
    const { child } = createAcpProcess({
      onMessage: (message, { send }) => {
        if (message.method !== 'session/new') return;
        send({
          error: { code: -32_000, message: 'Authentication required' },
          id: message.id,
        });
        return true;
      },
    });
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    await expect(new MinimaxCodeAcpSession(createSessionOptions()).run()).rejects.toThrow(
      'Run `mcode login`',
    );
  });

  it('cancels an active prompt with the ACP notification', async () => {
    let promptRequestId: number | string | undefined;
    const { child, requests } = createAcpProcess({
      onMessage: (message, { send }) => {
        if (message.method === 'session/prompt') {
          promptRequestId = message.id;
          return true;
        }
        if (message.method === 'session/cancel') {
          send({ id: promptRequestId, result: { stopReason: 'cancelled' } });
          return true;
        }
      },
    });
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const session = new MinimaxCodeAcpSession(createSessionOptions());
    const run = session.run();
    await vi.waitFor(() => {
      expect(promptRequestId).toBeDefined();
    });

    await session.interrupt();
    await run;

    expect(requests).toContainEqual({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: 'mcode-session-1' },
    });
  });

  it('auto-selects a full-access permission option when offered', async () => {
    const { child, requests, send } = createAcpProcess({
      onMessage: (message) => {
        if (message.method !== 'session/prompt') return;
        send({
          id: 'permission-1',
          method: 'session/request_permission',
          params: {
            options: [
              { kind: 'allow_always', optionId: 'allow-always' },
              { kind: 'allow_once', optionId: 'allow-once' },
            ],
            sessionId: 'mcode-session-1',
            toolCall: {},
          },
        });
        send({ id: message.id, result: { stopReason: 'end_turn' } });
        return true;
      },
    });
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    await new MinimaxCodeAcpSession(createSessionOptions()).run();

    expect(requests).toContainEqual({
      id: 'permission-1',
      jsonrpc: '2.0',
      result: { outcome: { optionId: 'allow-always', outcome: 'selected' } },
    });
  });
});
