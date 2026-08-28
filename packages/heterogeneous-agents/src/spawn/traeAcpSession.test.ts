import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildTraeAcpArgs,
  buildTraeAcpPrompt,
  listTraeAcpModels,
  parseTraeAcpModelCatalog,
  type TraeAcpPromptBlock,
  TraeAcpSession,
  type TraeAcpSessionOptions,
} from './traeAcpSession';

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
                    promptCapabilities: { image: true },
                  },
                  protocolVersion: 1,
                },
              });
              return;
            }
            case 'session/new':
            case 'session/load': {
              send({ id: message.id, result: { sessionId: 'trae-session-1' } });
              return;
            }
            case 'session/set_model': {
              send({ id: message.id, result: {} });
              return;
            }
            case 'session/set_config_option': {
              send({ id: message.id, result: { configOptions: [] } });
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
  overrides: Partial<TraeAcpSessionOptions> = {},
): TraeAcpSessionOptions => ({
  args: ['--feature=test'],
  clientVersion: '1.2.3',
  commandPath: 'traecli',
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

const collectEvents = (options: TraeAcpSessionOptions) => {
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

describe('TRAE ACP helpers', () => {
  it('builds the fixed ACP server argv before user arguments', () => {
    expect(buildTraeAcpArgs(['--feature=test'])).toEqual([
      'acp',
      'serve',
      '--yolo',
      '--feature=test',
    ]);
  });

  it('builds ACP text prompt blocks', async () => {
    await expect(buildTraeAcpPrompt('hello')).resolves.toEqual([{ text: 'hello', type: 'text' }]);
  });

  it('parses latest ACP model config options, including grouped values', () => {
    expect(
      parseTraeAcpModelCatalog({
        configOptions: [
          {
            category: 'model',
            currentValue: 'seed-2.0-code',
            id: 'trae-model',
            name: 'Model',
            options: [
              {
                group: 'builtin',
                name: 'Built in',
                options: [
                  { name: 'Seed 2.0 Code', value: 'seed-2.0-code' },
                  { name: 'GPT 5.4', value: 'gpt-5.4' },
                ],
              },
            ],
            type: 'select',
          },
        ],
        models: {
          availableModels: [{ modelId: 'legacy-model', name: 'Legacy' }],
        },
      }),
    ).toEqual({
      configId: 'trae-model',
      currentModelId: 'seed-2.0-code',
      models: [
        {
          id: 'seed-2.0-code',
          label: 'Seed 2.0 Code',
          modelId: 'seed-2.0-code',
          providerId: 'trae',
        },
        { id: 'gpt-5.4', label: 'GPT 5.4', modelId: 'gpt-5.4', providerId: 'trae' },
      ],
      protocol: 'config-option',
    });
  });
});

describe('TraeAcpSession', () => {
  it('initializes ACP v1, starts a session, streams updates, and completes', async () => {
    const { child, requests, send, stderr } = createAcpProcess({
      onMessage: (message) => {
        if (message.method !== 'session/prompt') return;
        send({
          method: 'session/update',
          params: {
            sessionId: 'trae-session-1',
            update: {
              content: { text: 'Hello from TRAE', type: 'text' },
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

    await new TraeAcpSession(options).run();

    expect(spawnMock).toHaveBeenCalledWith(
      'traecli',
      ['acp', 'serve', '--yolo', '--feature=test'],
      expect.objectContaining({ cwd: '/workspace', stdio: ['pipe', 'pipe', 'pipe'] }),
    );
    expect(requests[0]).toEqual({
      id: 1,
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        clientCapabilities: {},
        clientInfo: { name: 'lobehub', title: 'LobeHub', version: '1.2.3' },
        protocolVersion: 1,
      },
    });
    expect(requests[1]).toEqual({
      id: 2,
      jsonrpc: '2.0',
      method: 'session/new',
      params: { cwd: '/workspace', mcpServers: [] },
    });
    expect(requests[2]).toEqual({
      id: 3,
      jsonrpc: '2.0',
      method: 'session/prompt',
      params: {
        prompt: [{ text: 'hello', type: 'text' }],
        sessionId: 'trae-session-1',
      },
    });
    expect(options.onSessionId).toHaveBeenCalledWith('trae-session-1');
    expect(options.onRawMessage).toHaveBeenCalled();
    expect(
      events
        .filter((event) => event.type === 'stream_chunk' && event.data?.chunkType === 'text')
        .map((event) => event.data.content),
    ).toEqual(['Hello from TRAE']);
    expect(events.some((event) => event.type === 'agent_runtime_end')).toBe(true);
    expect(options.onRuntimeStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'closed', transport: 'trae-acp' }),
    );
    expect(stderr.readableEnded).toBe(false);
  });

  it('loads a prior session and suppresses replayed history updates', async () => {
    const { child, requests, send } = createAcpProcess({
      onMessage: (message) => {
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
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const options = createSessionOptions({ resumeSessionId: 'resume-session' });
    const events = collectEvents(options);

    await new TraeAcpSession(options).run();

    expect(requests[1]).toEqual({
      id: 2,
      jsonrpc: '2.0',
      method: 'session/load',
      params: { cwd: '/workspace', mcpServers: [], sessionId: 'resume-session' },
    });
    expect(options.onSessionId).toHaveBeenCalledWith('resume-session');
    expect(
      events
        .filter((event) => event.type === 'stream_chunk' && event.data?.chunkType === 'text')
        .map((event) => event.data.content),
    ).toEqual(['live']);
  });

  it.each([
    {
      catalog: {
        configOptions: [
          {
            category: 'model',
            currentValue: 'seed-2.0-code',
            id: 'trae-model',
            name: 'Model',
            options: [{ name: 'GPT 5.4', value: 'gpt-5.4' }],
            type: 'select',
          },
        ],
      },
      expectedParams: {
        configId: 'trae-model',
        sessionId: 'resume-session',
        value: 'gpt-5.4',
      },
      setMethod: 'session/set_config_option',
    },
    {
      catalog: {
        models: {
          availableModels: [{ modelId: 'gpt-5.4', name: 'GPT 5.4' }],
          currentModelId: 'seed-2.0-code',
        },
      },
      expectedParams: { modelId: 'gpt-5.4', sessionId: 'resume-session' },
      setMethod: 'session/set_model',
    },
  ])(
    'discovers a missing resume catalog and applies the model through $setMethod',
    async ({ catalog, expectedParams, setMethod }) => {
      const primary = createAcpProcess({
        onMessage: (message, { send }) => {
          if (message.method !== 'session/load') return;
          send({ id: message.id, result: {} });
          return true;
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
            result: { ...catalog, sessionId: 'catalog-session' },
          });
          return true;
        },
      });
      spawnMock.mockReturnValueOnce(primary.child).mockReturnValueOnce(discovery.child);
      vi.spyOn(process, 'kill').mockImplementation(() => true);

      await new TraeAcpSession(
        createSessionOptions({
          initialModel: 'gpt-5.4',
          resumeSessionId: 'resume-session',
        }),
      ).run();

      expect(discovery.requests.map((request) => request.method)).toEqual([
        'initialize',
        'session/new',
        'session/close',
      ]);
      expect(primary.requests.find((request) => request.method === setMethod)).toEqual({
        id: 3,
        jsonrpc: '2.0',
        method: setMethod,
        params: expectedParams,
      });
      expect(primary.requests.at(-1)?.method).toBe('session/prompt');
    },
  );

  it('sets a model through the latest ACP config-option API', async () => {
    const configOptions = [
      {
        category: 'model',
        currentValue: 'seed-2.0-code',
        id: 'trae-model',
        name: 'Model',
        options: [
          { name: 'Seed 2.0 Code', value: 'seed-2.0-code' },
          { name: 'GPT 5.4', value: 'gpt-5.4' },
        ],
        type: 'select',
      },
    ];
    const { child, requests } = createAcpProcess({
      onMessage: (message, { send }) => {
        if (message.method === 'session/new') {
          send({ id: message.id, result: { configOptions, sessionId: 'trae-session-1' } });
          return true;
        }
        if (message.method === 'session/set_config_option') {
          send({
            id: message.id,
            result: {
              configOptions: [
                {
                  ...configOptions[0],
                  currentValue: 'gpt-5.4',
                },
              ],
            },
          });
          return true;
        }
      },
    });
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const options = createSessionOptions({ initialModel: 'gpt-5.4', onModel: vi.fn() });

    await new TraeAcpSession(options).run();

    expect(requests[2]).toEqual({
      id: 3,
      jsonrpc: '2.0',
      method: 'session/set_config_option',
      params: {
        configId: 'trae-model',
        sessionId: 'trae-session-1',
        value: 'gpt-5.4',
      },
    });
    expect(options.onModel).toHaveBeenCalledWith('gpt-5.4');
  });

  it('falls back to the older TRAE ACP model API', async () => {
    const { child, requests } = createAcpProcess({
      onMessage: (message, { send }) => {
        if (message.method === 'session/new') {
          send({
            id: message.id,
            result: {
              models: {
                availableModels: [{ modelId: 'doubao-seed-code', name: 'Doubao Seed Code' }],
              },
              sessionId: 'trae-session-1',
            },
          });
          return true;
        }
        if (message.method === 'session/prompt') {
          send({
            method: 'session/update',
            params: {
              sessionId: 'trae-session-1',
              update: {
                content: { text: 'model selected', type: 'text' },
                sessionUpdate: 'agent_message_chunk',
              },
            },
          });
        }
      },
    });
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const options = createSessionOptions({
      initialModel: 'doubao-seed-code',
      onModel: vi.fn(),
    });
    const events = collectEvents(options);

    await new TraeAcpSession(options).run();

    expect(requests[2]).toEqual({
      id: 3,
      jsonrpc: '2.0',
      method: 'session/set_model',
      params: {
        modelId: 'doubao-seed-code',
        sessionId: 'trae-session-1',
      },
    });
    expect(options.onModel).toHaveBeenCalledWith('doubao-seed-code');
    expect(events.find((event) => event.type === 'stream_start')?.data).toEqual(
      expect.objectContaining({ model: 'doubao-seed-code' }),
    );
  });

  it('rejects a selected model that the session catalog does not expose', async () => {
    const { child, requests } = createAcpProcess({
      onMessage: (message, { send }) => {
        if (message.method !== 'session/new') return;
        send({
          id: message.id,
          result: {
            configOptions: [
              {
                category: 'model',
                currentValue: 'seed-2.0-code',
                id: 'model',
                name: 'Model',
                options: [{ name: 'Seed 2.0 Code', value: 'seed-2.0-code' }],
                type: 'select',
              },
            ],
            sessionId: 'trae-session-1',
          },
        });
        return true;
      },
    });
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    await expect(
      new TraeAcpSession(createSessionOptions({ initialModel: 'removed-model' })).run(),
    ).rejects.toThrow('TRAE ACP model is unavailable: removed-model');
    expect(requests.some((request) => request.method === 'session/prompt')).toBe(false);
  });

  it('discovers models from a short-lived latest ACP session and closes it when supported', async () => {
    const { child, requests } = createAcpProcess({
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
                currentValue: 'seed-2.0-code',
                id: 'model',
                name: 'Model',
                options: [{ name: 'Seed 2.0 Code', value: 'seed-2.0-code' }],
                type: 'select',
              },
            ],
            sessionId: 'catalog-session',
          },
        });
        return true;
      },
    });
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    await expect(
      listTraeAcpModels({
        args: ['--feature=test'],
        commandPath: 'traecli',
        cwd: '/workspace',
        env: process.env,
      }),
    ).resolves.toEqual([
      {
        id: 'seed-2.0-code',
        label: 'Seed 2.0 Code',
        modelId: 'seed-2.0-code',
        providerId: 'trae',
      },
    ]);
    expect(requests.map((request) => request.method)).toEqual([
      'initialize',
      'session/new',
      'session/close',
    ]);
  });

  it('rejects resume and image prompts when capabilities are absent', async () => {
    const first = createAcpProcess({
      initializeResult: { agentCapabilities: {}, protocolVersion: 1 },
    });
    spawnMock.mockReturnValueOnce(first.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    await expect(
      new TraeAcpSession(createSessionOptions({ resumeSessionId: 'old-session' })).run(),
    ).rejects.toThrow('does not support loading sessions');
    expect(first.requests.some((request) => request.method === 'session/load')).toBe(false);

    const second = createAcpProcess({
      initializeResult: { agentCapabilities: {}, protocolVersion: 1 },
    });
    spawnMock.mockReturnValueOnce(second.child);
    const imagePrompt: TraeAcpPromptBlock[] = [
      { data: 'aGVsbG8=', mimeType: 'image/png', type: 'image' },
    ];
    await expect(
      new TraeAcpSession(createSessionOptions({ prompt: imagePrompt })).run(),
    ).rejects.toThrow('does not support image prompt blocks');
    expect(second.requests.some((request) => request.method === 'session/new')).toBe(false);
  });

  it('rejects an unsupported protocol version and JSON-RPC errors', async () => {
    const incompatible = createAcpProcess({
      initializeResult: { agentCapabilities: {}, protocolVersion: 2 },
    });
    spawnMock.mockReturnValueOnce(incompatible.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    await expect(new TraeAcpSession(createSessionOptions()).run()).rejects.toThrow(
      'unsupported protocol version: 2',
    );

    const rpcError = createAcpProcess({
      onMessage: (message, { send }) => {
        if (message.method !== 'session/new') return;
        send({ error: { code: -32_000, message: 'cannot create session' }, id: message.id });
        return true;
      },
    });
    spawnMock.mockReturnValueOnce(rpcError.child);
    await expect(new TraeAcpSession(createSessionOptions()).run()).rejects.toThrow(
      'cannot create session',
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
    const session = new TraeAcpSession(createSessionOptions());
    const run = session.run();
    await vi.waitFor(() => {
      expect(promptRequestId).toBeDefined();
    });

    await session.interrupt();
    await run;

    expect(requests).toContainEqual({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: 'trae-session-1' },
    });
  });

  it('selects a non-persistent permission option actually offered by TRAE', async () => {
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
            sessionId: 'trae-session-1',
            toolCall: {},
          },
        });
        send({ id: message.id, result: { stopReason: 'end_turn' } });
        return true;
      },
    });
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    await new TraeAcpSession(createSessionOptions()).run();

    expect(requests).toContainEqual({
      id: 'permission-1',
      jsonrpc: '2.0',
      result: { outcome: { optionId: 'allow-once', outcome: 'selected' } },
    });
  });

  it('drains a final session update that arrives after the prompt response', async () => {
    const { child, send } = createAcpProcess({
      onMessage: (message) => {
        if (message.method !== 'session/prompt') return;
        send({ id: message.id, result: { stopReason: 'end_turn' } });
        setTimeout(() => {
          send({
            method: 'session/update',
            params: {
              sessionId: 'trae-session-1',
              update: {
                content: { text: 'late final text', type: 'text' },
                sessionUpdate: 'agent_message_chunk',
              },
            },
          });
        }, 10);
        return true;
      },
    });
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const options = createSessionOptions();
    const events = collectEvents(options);

    await new TraeAcpSession(options).run();

    expect(
      events
        .filter((event) => event.type === 'stream_chunk' && event.data?.chunkType === 'text')
        .map((event) => event.data.content),
    ).toEqual(['late final text']);
  });

  it('ignores diagnostic stdout and fails pending requests on premature exit', async () => {
    const malformed = createAcpProcess({
      onMessage: (message, { send }) => {
        if (message.method !== 'initialize') return;
        malformed.stdout.write('not-json\n');
        send({
          id: message.id,
          result: {
            agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
            protocolVersion: 1,
          },
        });
        return true;
      },
    });
    spawnMock.mockReturnValueOnce(malformed.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    await expect(new TraeAcpSession(createSessionOptions()).run()).resolves.toBeUndefined();

    const exited = createAcpProcess({
      onMessage: (message, { child }) => {
        if (message.method !== 'initialize') return;
        child.emit('close', 17, null);
        return true;
      },
    });
    spawnMock.mockReturnValueOnce(exited.child);
    await expect(new TraeAcpSession(createSessionOptions()).run()).rejects.toThrow(
      'exited unexpectedly (code 17, signal null)',
    );
  });
});
