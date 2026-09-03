import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AskUserBridge } from '../askUser/AskUserBridge';
import { AcpRpcResponseError } from './acpStdioClient';
import {
  buildDroidAcpArgs,
  buildDroidAcpPrompt,
  DroidAcpSession,
  type DroidAcpSessionOptions,
  isDroidAcpSessionNotFoundError,
  parseDroidAcpModelCatalog,
} from './droidAcpSession';

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

type Send = (message: Record<string, unknown>) => void;

const createAcpProcess = (
  options: {
    initializeResult?: Record<string, unknown>;
    onMessage?: (
      message: RpcMessage,
      context: { child: ChildProcess; send: Send },
    ) => boolean | void;
  } = {},
) => {
  const child = new EventEmitter() as ChildProcess;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const requests: RpcMessage[] = [];
  const send: Send = (message) =>
    stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

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
                    promptCapabilities: { image: true },
                  },
                  protocolVersion: 1,
                },
              });
              return;
            }
            case 'session/new': {
              send({ id: message.id, result: { sessionId: 'droid-session-1' } });
              return;
            }
            case 'session/load': {
              send({ id: message.id, result: {} });
              return;
            }
            case 'session/set_config_option': {
              send({ id: message.id, result: {} });
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

  return { child, requests, send };
};

const createSessionOptions = (
  overrides: Partial<DroidAcpSessionOptions> = {},
): DroidAcpSessionOptions => ({
  args: ['--tag', 'lobe'],
  clientVersion: '1.2.3',
  commandPath: 'droid',
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

const collectEvents = (options: DroidAcpSessionOptions) => {
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

describe('Factory Droid ACP helpers', () => {
  it('builds the fixed ACP argv and admits only safe value-bearing options', () => {
    expect(buildDroidAcpArgs(['--tag', 'lobe', '--enabled-tools=read,write'])).toEqual([
      'exec',
      '--output-format',
      'acp',
      '--tag',
      'lobe',
      '--enabled-tools=read,write',
    ]);
  });

  it.each([
    ['--skip-permissions-unsafe'],
    ['--output-format', 'jsonl'],
    ['--model', 'gpt-5'],
    ['--auto', 'high'],
    ['--cwd', '/tmp'],
    ['--session-id', 'session-1'],
  ])('rejects host-controlled or unsafe CLI arguments: %s', (...args) => {
    expect(() => buildDroidAcpArgs(args)).toThrow('does not support CLI argument');
  });

  it('builds standard ACP text blocks and parses the model config option', async () => {
    await expect(buildDroidAcpPrompt('hello')).resolves.toEqual([{ text: 'hello', type: 'text' }]);
    expect(
      parseDroidAcpModelCatalog({
        configOptions: [
          {
            category: 'model',
            currentValue: 'claude-sonnet-4-5',
            id: 'model',
            name: 'Model',
            options: [
              { name: 'Claude Sonnet 4.5', value: 'claude-sonnet-4-5' },
              { name: 'GPT-5.4', value: 'gpt-5.4' },
            ],
            type: 'select',
          },
        ],
      }),
    ).toEqual({
      configId: 'model',
      currentModelId: 'claude-sonnet-4-5',
      models: [
        {
          id: 'claude-sonnet-4-5',
          label: 'Claude Sonnet 4.5',
          modelId: 'claude-sonnet-4-5',
          providerId: 'droid',
        },
        { id: 'gpt-5.4', label: 'GPT-5.4', modelId: 'gpt-5.4', providerId: 'droid' },
      ],
    });
  });

  it('recognizes only Droid session/load errors for missing sessions', () => {
    expect(
      isDroidAcpSessionNotFoundError(
        new AcpRpcResponseError('session/load', {
          code: -32_603,
          data: { details: 'Session missing-session not found' },
          message: 'Failed to load session',
        }),
      ),
    ).toBe(true);
    expect(
      isDroidAcpSessionNotFoundError(
        new AcpRpcResponseError('session/load', {
          code: -32_603,
          data: { details: 'Authentication required' },
          message: 'Failed to load session',
        }),
      ),
    ).toBe(false);
    expect(
      isDroidAcpSessionNotFoundError(
        new AcpRpcResponseError('session/prompt', {
          code: -32_603,
          data: { details: 'Session missing-session not found' },
          message: 'Failed to load session',
        }),
      ),
    ).toBe(false);
  });
});

describe('DroidAcpSession', () => {
  it('runs the ACP v1 lifecycle and streams the current prompt updates', async () => {
    const fake = createAcpProcess({
      onMessage: (message, { send }) => {
        if (message.method !== 'session/prompt') return;
        send({
          method: 'session/update',
          params: {
            sessionId: 'droid-session-1',
            update: {
              content: { text: 'Hello from Droid', type: 'text' },
              sessionUpdate: 'agent_message_chunk',
            },
          },
        });
        send({ id: message.id, result: { stopReason: 'end_turn' } });
        return true;
      },
    });
    spawnMock.mockReturnValue(fake.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const options = createSessionOptions();
    const events = collectEvents(options);

    await new DroidAcpSession(options).run();

    expect(spawnMock).toHaveBeenCalledWith(
      'droid',
      ['exec', '--output-format', 'acp', '--tag', 'lobe'],
      expect.objectContaining({ cwd: '/workspace', stdio: ['pipe', 'pipe', 'pipe'] }),
    );
    expect(fake.requests.slice(0, 3)).toEqual([
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          clientCapabilities: {},
          clientInfo: { name: 'lobehub', title: 'LobeHub', version: '1.2.3' },
          protocolVersion: 1,
        },
      },
      {
        id: 2,
        jsonrpc: '2.0',
        method: 'session/new',
        params: { cwd: '/workspace', mcpServers: [] },
      },
      {
        id: 3,
        jsonrpc: '2.0',
        method: 'session/prompt',
        params: {
          prompt: [{ text: 'hello', type: 'text' }],
          sessionId: 'droid-session-1',
        },
      },
    ]);
    expect(options.onSessionId).toHaveBeenCalledWith('droid-session-1');
    expect(
      events
        .filter((event) => event.type === 'stream_chunk' && event.data?.chunkType === 'text')
        .map((event) => event.data.content),
    ).toEqual(['Hello from Droid']);
    expect(events.some((event) => event.type === 'agent_runtime_end')).toBe(true);
    expect(options.onRuntimeStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'closed', transport: 'droid-acp' }),
    );
  });

  it('loads a session without replaying history and discovers a missing model catalog safely', async () => {
    const primary = createAcpProcess({
      onMessage: (message, { send }) => {
        if (message.method === 'session/load') {
          send({
            method: 'session/update',
            params: {
              sessionId: 'resume-session',
              update: {
                content: { text: 'historical', type: 'text' },
                sessionUpdate: 'agent_message_chunk',
              },
            },
          });
          send({ id: message.id, result: {} });
          return true;
        }
        if (message.method === 'session/prompt') {
          send({
            method: 'session/update',
            params: {
              sessionId: 'resume-session',
              update: {
                content: { text: 'live', type: 'text' },
                sessionUpdate: 'agent_message_chunk',
              },
            },
          });
          send({ id: message.id, result: { stopReason: 'end_turn' } });
          return true;
        }
      },
    });
    const discovery = createAcpProcess({
      initializeResult: {
        agentCapabilities: { sessionCapabilities: { close: {} } },
        protocolVersion: 1,
      },
      onMessage: (message, { send }) => {
        if (message.method !== 'session/new') return;
        send({
          id: message.id,
          result: {
            configOptions: [
              {
                category: 'model',
                currentValue: 'claude-sonnet-4-5',
                id: 'model',
                name: 'Model',
                options: [{ name: 'GPT-5.4', value: 'gpt-5.4' }],
                type: 'select',
              },
            ],
            sessionId: 'catalog-session',
          },
        });
        return true;
      },
    });
    spawnMock.mockReturnValueOnce(primary.child).mockReturnValueOnce(discovery.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const options = createSessionOptions({
      initialModel: 'gpt-5.4',
      resumeSessionId: 'resume-session',
    });
    const events = collectEvents(options);

    await new DroidAcpSession(options).run();

    expect(primary.requests.find(({ method }) => method === 'session/set_config_option')).toEqual({
      id: 3,
      jsonrpc: '2.0',
      method: 'session/set_config_option',
      params: { configId: 'model', sessionId: 'resume-session', value: 'gpt-5.4' },
    });
    expect(discovery.requests.map(({ method }) => method).filter(Boolean)).toEqual([
      'initialize',
      'session/new',
      'session/close',
    ]);
    expect(
      events
        .filter((event) => event.type === 'stream_chunk' && event.data?.chunkType === 'text')
        .map((event) => event.data.content),
    ).toEqual(['live']);
  });

  it('keeps the permission intervention separate from the approved tool lifecycle', async () => {
    const bridge = new AskUserBridge('operation-1', {
      identifier: 'droid',
      provider: 'droid',
    });
    let promptRequestId: number | string | undefined;
    const fake = createAcpProcess({
      onMessage: (message, { send }) => {
        if (message.method === 'session/prompt') {
          promptRequestId = message.id;
          send({
            method: 'session/update',
            params: {
              sessionId: 'droid-session-1',
              update: {
                rawInput: { path: 'src/index.ts' },
                sessionUpdate: 'tool_call',
                title: 'Edit file',
                toolCallId: 'tool-1',
              },
            },
          });
          send({
            id: 'permission-1',
            method: 'session/request_permission',
            params: {
              options: [
                { kind: 'reject_once', name: 'Reject', optionId: 'reject-once-exact' },
                { kind: 'allow_once', name: 'Allow once', optionId: 'allow-once-exact' },
              ],
              sessionId: 'droid-session-1',
              toolCall: { title: '', toolCallId: 'tool-1' },
            },
          });
          return true;
        }
        if (message.id === 'permission-1' && message.result) {
          send({
            method: 'session/update',
            params: {
              sessionId: 'droid-session-1',
              update: {
                rawOutput: 'file updated',
                sessionUpdate: 'tool_call_update',
                status: 'completed',
                toolCallId: 'tool-1',
              },
            },
          });
          send({ id: promptRequestId, result: { stopReason: 'end_turn' } });
          return true;
        }
      },
    });
    spawnMock.mockReturnValue(fake.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const options = createSessionOptions({ askUserBridge: bridge });
    const events = collectEvents(options);
    const run = new DroidAcpSession(options).run();
    await vi.waitFor(() => expect(bridge.pendingCount).toBe(1));

    bridge.resolve('droid-permission-permission-1-tool-1', {
      result: { 'Factory Droid requests permission': 'allow-once-exact' },
    });
    await run;

    expect(fake.requests).toContainEqual({
      id: 'permission-1',
      jsonrpc: '2.0',
      result: { outcome: { optionId: 'allow-once-exact', outcome: 'selected' } },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({ content: 'file updated', toolCallId: 'tool-1' }),
        type: 'tool_result',
      }),
    );
  });

  it('fails closed when no permission bridge is available', async () => {
    const fake = createAcpProcess({
      onMessage: (message, { send }) => {
        if (message.method !== 'session/prompt') return;
        send({
          id: 'permission-1',
          method: 'session/request_permission',
          params: {
            options: [{ kind: 'allow_once', name: 'Allow', optionId: 'allow-once' }],
            toolCall: { title: 'Edit file?', toolCallId: 'tool-1' },
          },
        });
        send({ id: message.id, result: { stopReason: 'end_turn' } });
        return true;
      },
    });
    spawnMock.mockReturnValue(fake.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    await new DroidAcpSession(createSessionOptions()).run();

    expect(fake.requests).toContainEqual({
      id: 'permission-1',
      jsonrpc: '2.0',
      result: { outcome: { outcome: 'cancelled' } },
    });
  });

  it('rejects unsupported capabilities before creating a session', async () => {
    const noLoad = createAcpProcess({
      initializeResult: { agentCapabilities: {}, protocolVersion: 1 },
    });
    spawnMock.mockReturnValueOnce(noLoad.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    await expect(
      new DroidAcpSession(createSessionOptions({ resumeSessionId: 'old-session' })).run(),
    ).rejects.toThrow('does not support loading sessions');
    expect(noLoad.requests.some(({ method }) => method === 'session/load')).toBe(false);

    const noImage = createAcpProcess({
      initializeResult: { agentCapabilities: {}, protocolVersion: 1 },
    });
    spawnMock.mockReturnValueOnce(noImage.child);
    await expect(
      new DroidAcpSession(
        createSessionOptions({
          prompt: [{ data: 'aGVsbG8=', mimeType: 'image/png', type: 'image' }],
        }),
      ).run(),
    ).rejects.toThrow('does not support image prompt blocks');
    expect(noImage.requests.some(({ method }) => method === 'session/new')).toBe(false);
  });

  it('surfaces structured authentication failures and emits a terminal error event', async () => {
    const fake = createAcpProcess({
      onMessage: (message, { send }) => {
        if (message.method !== 'session/new') return;
        send({ error: { code: -32_000, message: 'Authentication required' }, id: message.id });
        return true;
      },
    });
    spawnMock.mockReturnValue(fake.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const options = createSessionOptions();
    const events = collectEvents(options);

    await expect(new DroidAcpSession(options).run()).rejects.toThrow('Authentication required');
    expect(events).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          agentType: 'droid',
          error: expect.anything(),
        }),
        type: 'error',
      }),
    );
  });

  it('cancels an active prompt through the standard ACP notification', async () => {
    let promptRequestId: number | string | undefined;
    const fake = createAcpProcess({
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
    spawnMock.mockReturnValue(fake.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const session = new DroidAcpSession(createSessionOptions());
    const run = session.run();
    await vi.waitFor(() => expect(promptRequestId).toBeDefined());

    session.interrupt();
    await run;

    expect(fake.requests).toContainEqual({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: 'droid-session-1' },
    });
  });
});
