import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentStreamPipeline } from './agentStreamPipeline';
import { buildGrokAcpArgs, buildGrokAcpPrompt, GrokAcpSession } from './grokAcpSession';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, spawn: spawnMock };
});

interface RpcMessage {
  error?: Record<string, unknown>;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
}

interface FakeProcessOptions {
  authMethods?: string[];
  autoComplete?: boolean;
  defaultAuthMethodId?: string;
  protocolVersion?: number;
  sendReverseRequests?: boolean;
}

const createAcpProcess = ({
  autoComplete = true,
  authMethods = ['cached_token', 'xai.api_key'],
  defaultAuthMethodId = 'cached_token',
  protocolVersion = 1,
  sendReverseRequests = false,
}: FakeProcessOptions = {}) => {
  const child = new EventEmitter() as any;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const requests: RpcMessage[] = [];
  let promptRequest: RpcMessage | undefined;

  const send = (message: Record<string, unknown>, split = false) => {
    const line = `${JSON.stringify(message)}\n`;
    if (!split) {
      stdout.write(line);
      return;
    }
    const middle = Math.floor(line.length / 2);
    stdout.write(line.slice(0, middle));
    stdout.write(line.slice(middle));
  };

  const completePrompt = (stopReason = 'end_turn') => {
    if (!promptRequest) throw new Error('No prompt request available');
    send({
      id: promptRequest.id,
      jsonrpc: '2.0',
      result: {
        _meta: {
          modelId: 'grok-build',
          usage: { cachedReadTokens: 2, inputTokens: 8, outputTokens: 4, totalTokens: 12 },
        },
        stopReason,
      },
    });
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
    once: vi.fn(),
    write: vi.fn((chunk: string) => {
      const message = JSON.parse(chunk.trim()) as RpcMessage;
      requests.push(message);

      queueMicrotask(() => {
        switch (message.method) {
          case 'initialize': {
            send(
              {
                id: message.id,
                jsonrpc: '2.0',
                result: {
                  _meta: { defaultAuthMethodId },
                  agentCapabilities: { loadSession: true },
                  authMethods: authMethods.map((id) => ({ id })),
                  protocolVersion,
                },
              },
              true,
            );
            return;
          }
          case 'authenticate': {
            send({ id: message.id, jsonrpc: '2.0', result: {} });
            return;
          }
          case 'session/new': {
            send({ id: message.id, jsonrpc: '2.0', result: { sessionId: 'grok-session-1' } });
            return;
          }
          case 'session/load': {
            // ACP load responses do not repeat the caller-provided session id.
            send({ id: message.id, jsonrpc: '2.0', result: {} });
            return;
          }
          case 'session/prompt': {
            promptRequest = message;
            stdout.write('not-json\n');
            send({
              jsonrpc: '2.0',
              method: 'session/update',
              params: {
                _meta: { isReplay: true },
                sessionId: 'grok-session-1',
                update: {
                  content: { text: 'historical', type: 'text' },
                  sessionUpdate: 'agent_message_chunk',
                },
              },
            });
            send({
              jsonrpc: '2.0',
              method: 'session/update',
              params: {
                _meta: { eventId: 'grok-session-1-1' },
                sessionId: 'grok-session-1',
                update: {
                  content: { text: 'thinking', type: 'text' },
                  sessionUpdate: 'agent_thought_chunk',
                },
              },
            });
            send({
              jsonrpc: '2.0',
              method: 'x.ai/session_notification',
              params: {
                _meta: { eventId: 'grok-session-1-2' },
                sessionId: 'grok-session-1',
                update: {
                  promptId: 'operation-1',
                  sessionUpdate: 'response_completed',
                  stopReason: 'tool_use',
                  usage: { inputTokens: 3, outputTokens: 1 },
                },
              },
            });
            send({
              jsonrpc: '2.0',
              method: 'session/update',
              params: {
                _meta: { eventId: 'grok-session-1-3' },
                sessionId: 'grok-session-1',
                update: {
                  kind: 'read',
                  rawInput: { path: 'README.md' },
                  sessionUpdate: 'tool_call',
                  status: 'in_progress',
                  title: 'Read',
                  toolCallId: 'call-1',
                },
              },
            });
            send({
              jsonrpc: '2.0',
              method: 'session/update',
              params: {
                _meta: { eventId: 'grok-session-1-4' },
                sessionId: 'grok-session-1',
                update: {
                  content: [{ text: 'read result', type: 'text' }],
                  sessionUpdate: 'tool_call_update',
                  status: 'completed',
                  toolCallId: 'call-1',
                },
              },
            });
            send({
              jsonrpc: '2.0',
              method: 'session/update',
              params: {
                sessionId: 'grok-session-1',
                update: {
                  content: { text: 'answer', type: 'text' },
                  sessionUpdate: 'agent_message_chunk',
                },
              },
            });
            send({
              jsonrpc: '2.0',
              method: 'x.ai/session_notification',
              params: {
                _meta: { eventId: 'grok-session-1-5' },
                sessionId: 'grok-session-1',
                update: {
                  promptId: 'operation-1',
                  sessionUpdate: 'response_completed',
                  stopReason: 'end_turn',
                  usage: { inputTokens: 6, outputTokens: 3, reasoningTokens: 1 },
                },
              },
            });
            send({
              jsonrpc: '2.0',
              method: 'x.ai/session/prompt_complete',
              params: {
                sessionId: 'grok-session-1',
                promptId: 'operation-1',
                stopReason: 'end_turn',
              },
            });
            send({
              jsonrpc: '2.0',
              method: 'x.ai/session_notification',
              params: {
                _meta: { eventId: 'grok-session-1-6' },
                sessionId: 'grok-session-1',
                update: {
                  promptId: 'operation-1',
                  sessionUpdate: 'turn_completed',
                  stopReason: 'end_turn',
                  usage: { inputTokens: 6, outputTokens: 3, reasoningTokens: 1 },
                },
              },
            });
            send({
              jsonrpc: '2.0',
              method: 'session/update',
              params: {
                sessionId: 'grok-session-1',
                update: { sessionUpdate: 'future_update' },
              },
            });
            if (sendReverseRequests) {
              send({
                id: 'permission-1',
                jsonrpc: '2.0',
                method: 'session/request_permission',
                params: {
                  options: [
                    { kind: 'reject_once', optionId: 'reject' },
                    { kind: 'allow_once', optionId: 'allow' },
                  ],
                  sessionId: 'grok-session-1',
                },
              });
              send({
                id: 'question-1',
                jsonrpc: '2.0',
                method: 'x.ai/ask_user_question',
                params: { sessionId: 'grok-session-1' },
              });
              send({
                id: 'plan-1',
                jsonrpc: '2.0',
                method: 'x.ai/exit_plan_mode',
                params: { sessionId: 'grok-session-1' },
              });
            }
            if (autoComplete) completePrompt();
            return;
          }
          case 'session/cancel': {
            completePrompt('cancelled');
          }
        }
      });
      return true;
    }),
  };

  return { child, requests, send };
};

const createSession = (
  overrides: Partial<ConstructorParameters<typeof GrokAcpSession>[0]> = {},
) => {
  const events: any[] = [];
  const statuses: any[] = [];
  const sessionIds: string[] = [];
  const session = new GrokAcpSession({
    args: ['--model', 'grok-build'],
    clientVersion: '1.0.0',
    commandPath: '/usr/bin/grok',
    cwd: '/workspace',
    env: { ...process.env, PATH: '/usr/bin' },
    onEvents: (batch) => {
      events.push(...batch);
    },
    onRawMessage: vi.fn(),
    onRuntimeStatus: (status) => statuses.push(status),
    onSessionId: (sessionId) => sessionIds.push(sessionId),
    onStderr: vi.fn(),
    operationId: 'operation-1',
    prompt: [{ text: 'hello', type: 'text' }],
    sessionId: 'host-session-1',
    ...overrides,
  });
  return { events, session, sessionIds, statuses };
};

afterEach(() => {
  vi.restoreAllMocks();
  spawnMock.mockReset();
});

describe('GrokAcpSession', () => {
  it('runs ACP initialize, auth, new session, prompt, and event mapping', async () => {
    const { child, requests } = createAcpProcess();
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const { events, session, sessionIds, statuses } = createSession();

    await session.run();

    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/bin/grok',
      [
        '--no-auto-update',
        'agent',
        '--no-leader',
        '--always-approve',
        '--model',
        'grok-build',
        'stdio',
      ],
      expect.objectContaining({ cwd: '/workspace', stdio: ['pipe', 'pipe', 'pipe'] }),
    );
    expect(requests.map(({ method }) => method)).toEqual([
      'initialize',
      'authenticate',
      'session/new',
      'session/prompt',
    ]);
    expect(requests[0]?.params).toMatchObject({
      clientCapabilities: { fs: {}, terminal: false },
      protocolVersion: 1,
    });
    expect(requests[1]?.params).toEqual({
      _meta: { headless: true },
      methodId: 'cached_token',
    });
    expect(requests[2]?.params).toEqual({
      _meta: { yoloMode: true },
      cwd: '/workspace',
      mcpServers: [],
    });
    expect(requests[3]?.params).toMatchObject({
      prompt: [{ text: 'hello', type: 'text' }],
      sessionId: 'grok-session-1',
    });
    expect(sessionIds).toEqual(['grok-session-1']);
    expect(events.some(({ data }) => data?.content === 'historical')).toBe(false);
    expect(events.some(({ data }) => data?.reasoning === 'thinking')).toBe(true);
    expect(events.find(({ type }) => type === 'tool_result')?.data).toMatchObject({
      content: 'read result',
      toolCallId: 'call-1',
    });
    expect(events.at(-1)).toMatchObject({
      data: { reason: 'complete', transport: 'acp-stdio' },
      type: 'agent_runtime_end',
    });
    expect(statuses.map(({ state }) => state)).toEqual(['starting', 'running', 'idle', 'closed']);
  });

  it('loads resumed sessions with noReplay', async () => {
    const { child, requests } = createAcpProcess();
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const { session, sessionIds } = createSession({ resumeSessionId: 'existing-session' });

    await session.run();

    expect(requests.map(({ method }) => method).includes('session/new')).toBe(false);
    expect(requests.find(({ method }) => method === 'session/load')?.params).toEqual({
      _meta: { noReplay: true },
      cwd: '/workspace',
      mcpServers: [],
      sessionId: 'existing-session',
    });
    expect(requests.find(({ method }) => method === 'session/prompt')?.params).toMatchObject({
      sessionId: 'existing-session',
    });
    expect(sessionIds).toEqual(['existing-session']);
  });

  it('falls back to a supported advertised auth method when the default is unsupported', async () => {
    const { child, requests } = createAcpProcess({
      authMethods: ['oidc', 'xai.api_key'],
      defaultAuthMethodId: 'oidc',
    });
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const { session } = createSession();

    await session.run();

    expect(requests.find(({ method }) => method === 'authenticate')?.params).toEqual({
      _meta: { headless: true },
      methodId: 'xai.api_key',
    });
  });

  it('answers Grok reverse requests with the P1 non-interactive policy', async () => {
    const { child, requests } = createAcpProcess({ sendReverseRequests: true });
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const { session } = createSession();

    await session.run();

    expect(requests.find(({ id }) => id === 'permission-1')?.result).toEqual({
      outcome: { optionId: 'allow', outcome: 'selected' },
    });
    expect(requests.find(({ id }) => id === 'question-1')?.result).toEqual({
      outcome: 'cancelled',
    });
    expect(requests.find(({ id }) => id === 'plan-1')?.result).toEqual({
      outcome: 'approved',
    });
  });

  it('sends an ACP cancel notification and accepts cancelled completion', async () => {
    const { child, requests } = createAcpProcess({ autoComplete: false });
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const { events, session } = createSession();
    const run = session.run();
    await vi.waitFor(() => {
      expect(requests.some(({ method }) => method === 'session/prompt')).toBe(true);
    });

    session.interrupt();
    await run;

    const cancel = requests.find(({ method }) => method === 'session/cancel');
    expect(cancel?.id).toBeUndefined();
    expect(cancel?.params).toEqual({
      _meta: { cancelTrigger: 'ctrl_c' },
      sessionId: 'grok-session-1',
    });
    expect(events.at(-1)).toMatchObject({
      data: { reason: 'cancelled' },
      type: 'agent_runtime_end',
    });
  });

  it('does not emit an in-flight ACP event after host close', async () => {
    const { child, requests, send } = createAcpProcess({ autoComplete: false });
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const originalPush = AgentStreamPipeline.prototype.push;
    let releaseLateEvent: (() => void) | undefined;
    vi.spyOn(AgentStreamPipeline.prototype, 'push').mockImplementation(function (
      this: AgentStreamPipeline,
      chunk,
    ) {
      if (!String(chunk).includes('late after close')) return originalPush.call(this, chunk);

      return new Promise((resolve) => {
        releaseLateEvent = () =>
          resolve([
            {
              data: { chunkType: 'text', content: 'late after close' },
              operationId: 'operation-1',
              stepIndex: 0,
              timestamp: 1,
              type: 'stream_chunk',
            } satisfies AgentStreamEvent,
          ]);
      });
    });
    const { events, session, statuses } = createSession();
    const run = session.run();
    await vi.waitFor(() => {
      expect(requests.some(({ method }) => method === 'session/prompt')).toBe(true);
    });

    const promptRequest = requests.find(({ method }) => method === 'session/prompt');
    expect(promptRequest?.id).toBeDefined();
    send({ id: promptRequest!.id, result: { stopReason: 'end_turn' } });
    send({
      method: 'session/update',
      params: {
        sessionId: 'grok-session-1',
        update: {
          content: { text: 'late after close', type: 'text' },
          sessionUpdate: 'agent_message_chunk',
        },
      },
    });
    await vi.waitFor(() => expect(releaseLateEvent).toBeTypeOf('function'));

    session.close();
    releaseLateEvent!();
    await run;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(events.some(({ data }) => data?.content === 'late after close')).toBe(false);
    expect(statuses.at(-1)?.state).toBe('closed');
    expect(statuses.some(({ state }) => state === 'idle')).toBe(false);
  });

  it('rejects unsupported ACP protocol versions', async () => {
    const { child } = createAcpProcess({ protocolVersion: 2 });
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const { session } = createSession();

    await expect(session.run()).rejects.toThrow('Unsupported Grok Build ACP protocol version: 2');
  });
});

describe('Grok ACP input helpers', () => {
  it('keeps Grok agent flags between agent and stdio', () => {
    expect(buildGrokAcpArgs(['--model', 'grok-build'])).toEqual([
      '--no-auto-update',
      'agent',
      '--no-leader',
      '--always-approve',
      '--model',
      'grok-build',
      'stdio',
    ]);
  });

  it('serializes text and image input as ACP content blocks', async () => {
    const prompt = await buildGrokAcpPrompt([
      { text: 'describe', type: 'text' },
      {
        source: { data: 'iVBORw0KGgo=', mediaType: 'image/png', type: 'base64' },
        type: 'image',
      },
    ]);

    expect(prompt).toEqual([
      { text: 'describe', type: 'text' },
      { data: 'iVBORw0KGgo=', mimeType: 'image/png', type: 'image' },
    ]);
  });
});
