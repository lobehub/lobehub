import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AskUserBridge } from '../askUser/AskUserBridge';
import { DEFAULT_ASK_USER_TIMEOUT_MS } from '../askUser/constants';
import { AcpRpcResponseError } from './acpStdioClient';
import {
  buildCursorAcpArgs,
  buildCursorAcpPrompt,
  CursorAcpSession,
  type CursorAcpSessionOptions,
  isCursorAcpSessionNotFoundError,
} from './cursorAcpSession';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, spawn: spawnMock };
});

interface RpcMessage {
  error?: { code: number; message: string };
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
}

const createAcpProcess = ({
  askQuestion = false,
  loadError,
  serverRequest,
}: {
  askQuestion?: boolean;
  loadError?: { code: number; message: string };
  serverRequest?: RpcMessage;
} = {}) => {
  const child = new EventEmitter() as ChildProcess;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const requests: RpcMessage[] = [];
  let promptRequest: RpcMessage | undefined;
  const blockingRequest: RpcMessage | undefined =
    serverRequest ??
    (askQuestion
      ? {
          id: 'ask-1',
          method: 'cursor/ask_question',
          params: {
            questions: [
              {
                allowMultiple: false,
                id: 'scope',
                options: [
                  { id: 'narrow', label: 'Narrow' },
                  { id: 'full', label: 'Full' },
                ],
                prompt: 'How broad should the fix be?',
              },
            ],
            title: 'Scope',
            toolCallId: 'cursor-question-1',
          },
        }
      : undefined);
  const send = (message: Record<string, unknown>) =>
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
          switch (message.method) {
            case 'initialize': {
              send({
                id: message.id,
                result: {
                  agentCapabilities: { loadSession: true },
                  authMethods: [{ id: 'cursor_login', name: 'Cursor Login' }],
                  protocolVersion: 1,
                },
              });
              return;
            }
            case 'authenticate': {
              send({ id: message.id, result: {} });
              return;
            }
            case 'session/new': {
              send({ id: message.id, result: { sessionId: 'cursor-session-1' } });
              return;
            }
            case 'session/load': {
              send(
                loadError ? { error: loadError, id: message.id } : { id: message.id, result: {} },
              );
              return;
            }
            case 'session/prompt': {
              promptRequest = message;
              send({
                method: 'session/update',
                params: {
                  sessionId: 'cursor-session-1',
                  update: {
                    content: { text: 'Working', type: 'text' },
                    sessionUpdate: 'agent_message_chunk',
                  },
                },
              });
              if (askQuestion) {
                send({
                  method: 'session/update',
                  params: {
                    sessionId: 'cursor-session-1',
                    update: {
                      kind: 'other',
                      rawInput: {
                        questions: [
                          {
                            allowMultiple: false,
                            id: 'scope',
                            options: [
                              { id: 'narrow', label: 'Narrow' },
                              { id: 'full', label: 'Full' },
                            ],
                            prompt: 'How broad should the fix be?',
                          },
                        ],
                        title: 'Scope',
                      },
                      sessionUpdate: 'tool_call',
                      status: 'in_progress',
                      title: 'AskQuestion',
                      toolCallId: 'cursor-question-1',
                    },
                  },
                });
              }
              if (blockingRequest) {
                send(blockingRequest as Record<string, unknown>);
              } else {
                send({ id: message.id, result: { stopReason: 'end_turn' } });
              }
              return;
            }
          }

          if (message.id === blockingRequest?.id && message.result && promptRequest) {
            send({ id: promptRequest.id, result: { stopReason: 'end_turn' } });
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
  overrides: Partial<CursorAcpSessionOptions> = {},
): CursorAcpSessionOptions => ({
  args: ['--model', 'composer-1.5'],
  clientVersion: '1.2.3',
  commandPath: 'agent',
  cwd: '/workspace',
  env: process.env,
  onEvents: vi.fn(),
  onRawMessage: vi.fn(),
  onRuntimeStatus: vi.fn(),
  onSessionId: vi.fn(),
  onStderr: vi.fn(),
  operationId: 'operation-1',
  prompt: [{ text: 'hello', type: 'text' }],
  sessionId: 'session-1',
  ...overrides,
});

const createCursorBridge = () =>
  new AskUserBridge('operation-1', { identifier: 'claude-code', provider: 'cursor' });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  spawnMock.mockReset();
});

describe('Cursor ACP helpers', () => {
  it('places root arguments before the ACP subcommand and builds text prompt blocks', () => {
    expect(buildCursorAcpArgs(['--model', 'composer-1.5'])).toEqual([
      '--model',
      'composer-1.5',
      'acp',
    ]);
    expect(buildCursorAcpPrompt('hello')).toEqual([{ text: 'hello', type: 'text' }]);
  });

  it('rejects image prompts instead of silently dropping them', () => {
    expect(() =>
      buildCursorAcpPrompt([
        { source: { path: '/workspace/image.png', type: 'path' }, type: 'image' },
      ]),
    ).toThrow('Cursor CLI does not support image input');
  });
});

describe('CursorAcpSession', () => {
  it('initializes, authenticates, starts a session, streams updates, and completes', async () => {
    const fake = createAcpProcess();
    spawnMock.mockReturnValue(fake.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const options = createSessionOptions();
    const events: AgentStreamEvent[] = [];
    options.onEvents = (batch) => {
      events.push(...batch);
    };

    await new CursorAcpSession(options).run();

    expect(spawnMock).toHaveBeenCalledWith(
      'agent',
      ['--model', 'composer-1.5', 'acp'],
      expect.objectContaining({ cwd: '/workspace', stdio: ['pipe', 'pipe', 'pipe'] }),
    );
    expect(fake.requests.map(({ method }) => method).filter(Boolean)).toEqual([
      'initialize',
      'authenticate',
      'session/new',
      'session/prompt',
    ]);
    expect(options.onSessionId).toHaveBeenCalledWith('cursor-session-1');
    expect(events).toContainEqual(
      expect.objectContaining({
        data: { chunkType: 'text', content: 'Working' },
        type: 'stream_chunk',
      }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: 'agent_runtime_end' }));
    expect(options.onRuntimeStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'closed', transport: 'cursor-acp' }),
    );
  });

  it('loads a native ACP session when resuming', async () => {
    const fake = createAcpProcess();
    spawnMock.mockReturnValue(fake.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const options = createSessionOptions({ resumeSessionId: 'cursor-session-old' });

    await new CursorAcpSession(options).run();

    expect(fake.requests.find(({ method }) => method === 'session/load')?.params).toEqual({
      cwd: '/workspace',
      mcpServers: [],
      sessionId: 'cursor-session-old',
    });
    expect(options.onSessionId).toHaveBeenCalledWith('cursor-session-old');
  });

  it('recognizes only Cursor session/load invalid-params errors with the exact not-found message', () => {
    expect(
      isCursorAcpSessionNotFoundError(
        new AcpRpcResponseError('session/load', {
          code: -32_602,
          message: 'Session "legacy-session" not found',
        }),
      ),
    ).toBe(true);

    for (const error of [
      new AcpRpcResponseError('session/prompt', {
        code: -32_602,
        message: 'Session "legacy-session" not found',
      }),
      new AcpRpcResponseError('session/load', {
        code: -32_603,
        message: 'Session "legacy-session" not found',
      }),
      new AcpRpcResponseError('session/load', {
        code: -32_602,
        message: 'Session legacy-session not found',
      }),
    ]) {
      expect(isCursorAcpSessionNotFoundError(error)).toBe(false);
    }
  });

  it('preserves the structured RPC error when a legacy Cursor session cannot be loaded', async () => {
    const fake = createAcpProcess({
      loadError: { code: -32_602, message: 'Session "legacy-session" not found' },
    });
    spawnMock.mockReturnValue(fake.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    const run = new CursorAcpSession(
      createSessionOptions({ resumeSessionId: 'legacy-session' }),
    ).run();

    await expect(run).rejects.toSatisfy(isCursorAcpSessionNotFoundError);
    expect(fake.requests.some(({ method }) => method === 'session/prompt')).toBe(false);
  });

  it('returns an explicit cancellation instead of fabricating a skipped answer without a UI', async () => {
    const fake = createAcpProcess({ askQuestion: true });
    spawnMock.mockReturnValue(fake.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    await new CursorAcpSession(createSessionOptions()).run();

    expect(fake.requests.find(({ id }) => id === 'ask-1')?.result).toEqual({
      outcome: { outcome: 'cancelled' },
    });
  });

  it('keeps streaming session updates while AskUserBridge is waiting', async () => {
    const fake = createAcpProcess({ askQuestion: true });
    spawnMock.mockReturnValue(fake.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const bridge = createCursorBridge();
    const options = createSessionOptions({ askUserBridge: bridge });
    const events: AgentStreamEvent[] = [];
    options.onEvents = (batch) => {
      events.push(...batch);
    };
    const eventIterator = bridge.events()[Symbol.asyncIterator]();
    const run = new CursorAcpSession(options).run();

    await eventIterator.next();
    fake.send({
      method: 'session/update',
      params: {
        sessionId: 'cursor-session-1',
        update: {
          content: { text: ' still streaming', type: 'text' },
          sessionUpdate: 'agent_message_chunk',
        },
      },
    });
    await vi.waitFor(() =>
      expect(events).toContainEqual(
        expect.objectContaining({
          data: { chunkType: 'text', content: ' still streaming' },
          type: 'stream_chunk',
        }),
      ),
    );

    bridge.resolve('cursor-question-1', {
      result: { 'How broad should the fix be?': 'Full' },
    });
    await run;
  });

  it('blocks cursor/ask_question until the bridge returns selected option labels', async () => {
    const fake = createAcpProcess({ askQuestion: true });
    spawnMock.mockReturnValue(fake.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const bridge = createCursorBridge();
    const options = createSessionOptions({ askUserBridge: bridge });
    const events: AgentStreamEvent[] = [];
    options.onEvents = (batch) => {
      events.push(...batch);
    };
    const eventIterator = bridge.events()[Symbol.asyncIterator]();
    const run = new CursorAcpSession(options).run();

    const intervention = await eventIterator.next();
    expect(intervention.value).toMatchObject({
      data: {
        apiName: 'askUserQuestion',
        interactionKind: 'question',
        provider: 'cursor',
        toolCallId: 'cursor-question-1',
      },
      type: 'agent_intervention_request',
    });
    expect(JSON.parse(intervention.value!.data.arguments)).toEqual({
      questions: [
        {
          header: 'Scope',
          multiSelect: false,
          options: [
            { id: 'narrow', label: 'Narrow' },
            { id: 'full', label: 'Full' },
          ],
          question: 'How broad should the fix be?',
        },
      ],
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          toolCalling: expect.objectContaining({
            apiName: 'askUserQuestion',
            id: 'cursor-question-1',
            identifier: 'claude-code',
          }),
          toolCallId: 'cursor-question-1',
        }),
        type: 'tool_start',
      }),
    );
    expect(events.filter(({ type }) => type === 'tool_start')).toHaveLength(1);

    bridge.resolve('cursor-question-1', {
      result: { 'How broad should the fix be?': 'Full' },
    });
    await run;

    expect(fake.requests.find(({ id }) => id === 'ask-1')?.result).toEqual({
      outcome: {
        answers: [{ questionId: 'scope', selectedOptionIds: ['full'] }],
        outcome: 'answered',
      },
    });
  });

  it('preserves a custom answer and maps cancellation to Cursor outcomes', async () => {
    for (const [bridgeAnswer, expectedOutcome] of [
      [
        { result: { 'How broad should the fix be?': 'Only the crash path' } },
        {
          answers: [{ questionId: 'scope', selectedOptionIds: ['Only the crash path'] }],
          outcome: 'answered',
        },
      ],
      [{ cancelReason: 'user_cancelled', cancelled: true }, { outcome: 'cancelled' }],
    ] as const) {
      const fake = createAcpProcess({ askQuestion: true });
      spawnMock.mockReturnValue(fake.child);
      vi.spyOn(process, 'kill').mockImplementation(() => true);
      const bridge = createCursorBridge();
      const options = createSessionOptions({ askUserBridge: bridge });
      const eventIterator = bridge.events()[Symbol.asyncIterator]();
      const run = new CursorAcpSession(options).run();
      await eventIterator.next();

      bridge.resolve('cursor-question-1', bridgeAnswer);
      await run;

      expect(fake.requests.find(({ id }) => id === 'ask-1')?.result).toEqual({
        outcome: expectedOutcome,
      });
    }
  });

  it('returns only the permission option explicitly selected by the user', async () => {
    const fake = createAcpProcess({
      serverRequest: {
        id: 'permission-1',
        method: 'session/request_permission',
        params: {
          options: [
            { kind: 'allow_once', name: 'Allow once', optionId: 'allow-once' },
            { kind: 'allow_always', name: 'Always allow', optionId: 'allow-always' },
            { kind: 'reject_once', name: 'Reject', optionId: 'reject-once' },
          ],
          sessionId: 'cursor-session-1',
          toolCall: { title: 'Run the test suite', toolCallId: 'tool-1' },
        },
      },
    });
    spawnMock.mockReturnValue(fake.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const bridge = createCursorBridge();
    const events: AgentStreamEvent[] = [];
    const sessionOptions = createSessionOptions({ askUserBridge: bridge });
    sessionOptions.onEvents = (batch) => {
      events.push(...batch);
    };
    const eventIterator = bridge.events()[Symbol.asyncIterator]();
    const run = new CursorAcpSession(sessionOptions).run();

    const intervention = await eventIterator.next();
    expect(intervention.value!.data.toolCallId).toBe('cursor-permission-permission-1-tool-1');
    expect(intervention.value!.data).toMatchObject({
      interactionKind: 'permission',
      provider: 'cursor',
    });
    expect(JSON.parse(intervention.value!.data.arguments)).toEqual({
      questions: [
        {
          header: 'Permission required',
          multiSelect: false,
          options: [
            { id: 'allow-once', label: 'Allow once' },
            { id: 'allow-always', label: 'Always allow' },
            { id: 'reject-once', label: 'Reject' },
          ],
          question: 'Run the test suite',
        },
      ],
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          toolCalling: expect.objectContaining({
            apiName: 'askUserQuestion',
            id: 'cursor-permission-permission-1-tool-1',
            identifier: 'claude-code',
          }),
        }),
        type: 'tool_start',
      }),
    );
    bridge.resolve(intervention.value!.data.toolCallId, {
      result: { 'Run the test suite': 'allow-once' },
    });
    await run;

    expect(fake.requests.find(({ id }) => id === 'permission-1')?.result).toEqual({
      outcome: { optionId: 'allow-once', outcome: 'selected' },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          toolCallId: 'cursor-permission-permission-1-tool-1',
        }),
        type: 'tool_end',
      }),
    );
  });

  it('never grants a permission without a matching explicit user choice', async () => {
    for (const bridgeAnswer of [
      undefined,
      { cancelReason: 'user_cancelled', cancelled: true } as const,
      { result: { 'Run the test suite': 'Allow everything' } },
      { result: { 'Run the test suite': 'Always allow' } },
    ]) {
      const fake = createAcpProcess({
        serverRequest: {
          id: 'permission-1',
          method: 'session/request_permission',
          params: {
            options: [
              { kind: 'allow_always', name: 'Always allow', optionId: 'allow-always' },
              { kind: 'allow_once', name: 'Allow once', optionId: 'allow-once' },
            ],
            sessionId: 'cursor-session-1',
            toolCall: { title: 'Run the test suite', toolCallId: 'tool-1' },
          },
        },
      });
      spawnMock.mockReturnValue(fake.child);
      vi.spyOn(process, 'kill').mockImplementation(() => true);
      const bridge = bridgeAnswer ? createCursorBridge() : undefined;
      const run = new CursorAcpSession(createSessionOptions({ askUserBridge: bridge })).run();

      if (bridge) {
        const intervention = await bridge.events()[Symbol.asyncIterator]().next();
        bridge.resolve(intervention.value!.data.toolCallId, bridgeAnswer!);
      }
      await run;

      expect(fake.requests.find(({ id }) => id === 'permission-1')?.result).toEqual({
        outcome: { outcome: 'cancelled' },
      });
    }
  });

  it('uses exact option ids when provider permission labels are duplicated', async () => {
    const fake = createAcpProcess({
      serverRequest: {
        id: 'permission-duplicate-labels',
        method: 'session/request_permission',
        params: {
          options: [
            { kind: 'allow_once', name: 'Continue', optionId: 'allow-once' },
            { kind: 'reject_once', name: 'Continue', optionId: 'reject-once' },
          ],
          toolCall: { title: 'Edit README', toolCallId: 'tool-duplicate-labels' },
        },
      },
    });
    spawnMock.mockReturnValue(fake.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const bridge = createCursorBridge();
    const run = new CursorAcpSession(createSessionOptions({ askUserBridge: bridge })).run();

    const intervention = await bridge.events()[Symbol.asyncIterator]().next();
    expect(JSON.parse(intervention.value!.data.arguments).questions[0].options).toEqual([
      { id: 'allow-once', label: 'Continue' },
      { id: 'reject-once', label: 'Continue' },
    ]);
    bridge.resolve(intervention.value!.data.toolCallId, {
      result: { 'Edit README': 'reject-once' },
    });
    await run;

    expect(fake.requests.find(({ id }) => id === 'permission-duplicate-labels')?.result).toEqual({
      outcome: { optionId: 'reject-once', outcome: 'selected' },
    });
  });

  it.each([
    ['Accept', 'accepted'],
    ['Reject', 'rejected'],
  ] as const)('maps an explicit %s plan decision to %s', async (selection, outcome) => {
    const fake = createAcpProcess({
      serverRequest: {
        id: 'plan-request-1',
        method: 'cursor/create_plan',
        params: {
          name: 'Fix approvals',
          overview: 'Require an explicit decision.',
          plan: '1. Show the plan.\n2. Wait for the user.',
          todos: [],
          toolCallId: 'plan-1',
        },
      },
    });
    spawnMock.mockReturnValue(fake.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const bridge = createCursorBridge();
    const eventIterator = bridge.events()[Symbol.asyncIterator]();
    const run = new CursorAcpSession(createSessionOptions({ askUserBridge: bridge })).run();

    const intervention = await eventIterator.next();
    expect(JSON.parse(intervention.value!.data.arguments)).toEqual({
      questions: [
        {
          header: 'Fix approvals',
          multiSelect: false,
          options: [
            { id: 'accepted', label: 'Accept' },
            { id: 'rejected', label: 'Reject' },
          ],
          question: 'Require an explicit decision.\n\n1. Show the plan.\n2. Wait for the user.',
        },
      ],
    });
    bridge.resolve(intervention.value!.data.toolCallId, {
      result: {
        'Require an explicit decision.\n\n1. Show the plan.\n2. Wait for the user.':
          selection === 'Accept' ? 'accepted' : 'rejected',
      },
    });
    await run;

    expect(fake.requests.find(({ id }) => id === 'plan-request-1')?.result).toEqual({
      outcome: { outcome },
    });
  });

  it('cancels plan approval when there is no UI or the user cancels', async () => {
    for (const withBridge of [false, true]) {
      const fake = createAcpProcess({
        serverRequest: {
          id: 'plan-request-1',
          method: 'cursor/create_plan',
          params: { plan: 'Do the work.', todos: [], toolCallId: 'plan-1' },
        },
      });
      spawnMock.mockReturnValue(fake.child);
      vi.spyOn(process, 'kill').mockImplementation(() => true);
      const bridge = withBridge ? createCursorBridge() : undefined;
      const run = new CursorAcpSession(createSessionOptions({ askUserBridge: bridge })).run();

      if (bridge) {
        const intervention = await bridge.events()[Symbol.asyncIterator]().next();
        bridge.cancel(intervention.value!.data.toolCallId);
      }
      await run;

      expect(fake.requests.find(({ id }) => id === 'plan-request-1')?.result).toEqual({
        outcome: { outcome: 'cancelled' },
      });
    }
  });

  it('cancels plan approval when the intervention times out', async () => {
    vi.useFakeTimers();
    const fake = createAcpProcess({
      serverRequest: {
        id: 'plan-request-1',
        method: 'cursor/create_plan',
        params: { plan: 'Do the work.', todos: [], toolCallId: 'plan-1' },
      },
    });
    spawnMock.mockReturnValue(fake.child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const bridge = createCursorBridge();
    const eventIterator = bridge.events()[Symbol.asyncIterator]();
    const run = new CursorAcpSession(createSessionOptions({ askUserBridge: bridge })).run();

    await eventIterator.next();
    await vi.advanceTimersByTimeAsync(DEFAULT_ASK_USER_TIMEOUT_MS);
    await run;

    expect(fake.requests.find(({ id }) => id === 'plan-request-1')?.result).toEqual({
      outcome: { outcome: 'cancelled' },
    });
  });
});
