import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AskUserBridge } from '../askUser/AskUserBridge';
import {
  AntigravityAcpSession,
  type AntigravityAcpSessionOptions,
  isAntigravityAcpSessionNotFoundError,
} from './antigravityAcpSession';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, spawn: spawnMock };
});

interface RpcMessage {
  error?: { code: number; message: string };
  id?: number | string;
  method?: string;
  params?: Record<string, any>;
  result?: unknown;
}

const SESSION_ID = 'agy-session-1';

/** `model` select values as agy 1.5.15 lists them: families, plus fixed-tier slugs. */
const MODEL_OPTIONS = [
  'gemini-4-neon',
  'gemini-3.8-flash',
  'gemini-pro-orchestrator',
  'gpt-oss-120b-medium',
];
/** Models whose thinking tier is fixed: agy offers no `thought_level` for them. */
const FIXED_TIER_MODELS = new Set(['gemini-pro-orchestrator', 'gpt-oss-120b-medium']);
const thinkingLevels = (model: string) =>
  model === 'gemini-4-neon' ? ['low', 'medium', 'high', 'xhigh'] : ['low', 'medium', 'high'];

const configOptions = (model: string, level: string, mode = 'default') => [
  {
    currentValue: model,
    id: 'model',
    options: MODEL_OPTIONS.map((value) => ({ name: value, value })),
  },
  ...(FIXED_TIER_MODELS.has(model)
    ? []
    : [
        {
          currentValue: level,
          id: 'thought_level',
          options: thinkingLevels(model).map((value) => ({ name: value, value })),
        },
      ]),
  { currentValue: mode, id: 'mode', options: [] },
];

const AVAILABLE_MODELS = [
  { modelId: 'gemini-4-neon-high' },
  { modelId: 'gemini-4-neon-xhigh' },
  { modelId: 'gemini-3.8-flash-low' },
  { modelId: 'gemini-pro-orchestrator' },
  { modelId: 'gpt-oss-120b-medium' },
];

type PromptHandler = (
  prompt: RpcMessage,
  agent: {
    finish: (id: RpcMessage['id'], result: unknown) => void;
    request: (request: RpcMessage) => void;
    update: (u: unknown) => void;
  },
) => void;

/**
 * A fake `agy acp` following the behaviour recorded from agy 1.5.15: another
 * `session/prompt` while one is pending ends the pending one with `end_turn`,
 * and `session/cancel` ends the pending one with `cancelled`.
 */
const createAgy = ({
  newError,
  loadError,
  onClientResponse,
  onPrompt,
  replayOnLoad = false,
  resumeError,
  steerAnswerInSameChunk,
}: {
  loadError?: { code: number; message: string };
  newError?: { code: number; message: string };
  onClientResponse?: (message: RpcMessage, finish: () => void) => void;
  onPrompt?: PromptHandler;
  replayOnLoad?: boolean;
  resumeError?: { code: number; message: string };
  /** Write the steered prompt's first text in the same stdout chunk as the end of the prompt it interrupts. */
  steerAnswerInSameChunk?: string;
} = {}) => {
  const child = new EventEmitter() as ChildProcess;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const requests: RpcMessage[] = [];
  let model = 'gemini-4-neon';
  let level = 'high';
  let mode = 'default';
  let pendingPrompt: RpcMessage | undefined;
  const send = (message: Record<string, unknown>) =>
    stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const update = (sessionUpdate: unknown, sessionId = SESSION_ID) =>
    send({ method: 'session/update', params: { sessionId, update: sessionUpdate } });
  const finish = (id: RpcMessage['id'], result: unknown) => {
    if (pendingPrompt?.id === id) pendingPrompt = undefined;
    send({ id, result });
  };
  const sessionResult = () => ({
    configOptions: configOptions(model, level, mode),
    models: { availableModels: AVAILABLE_MODELS },
    sessionId: SESSION_ID,
  });

  Object.assign(child, {
    kill: vi.fn(() => true),
    killed: false,
    pid: 4242,
    stderr,
    stdin: {
      end: vi.fn(),
      once: vi.fn(),
      write: vi.fn((chunk: string) => {
        const message = JSON.parse(chunk.trim()) as RpcMessage;
        requests.push(message);
        queueMicrotask(() => {
          const params = message.params ?? {};
          switch (message.method) {
            case undefined: {
              const prompt = pendingPrompt;
              if (prompt)
                onClientResponse?.(message, () => finish(prompt.id, { stopReason: 'end_turn' }));
              return;
            }
            case 'initialize': {
              send({
                id: message.id,
                result: {
                  agentCapabilities: {
                    promptCapabilities: { image: true },
                    sessionCapabilities: { load: {}, resume: {} },
                  },
                  protocolVersion: 1,
                },
              });
              return;
            }
            case 'session/new': {
              send(
                newError
                  ? { error: newError, id: message.id }
                  : { id: message.id, result: sessionResult() },
              );
              return;
            }
            case 'session/resume': {
              send(
                resumeError
                  ? { error: resumeError, id: message.id }
                  : { id: message.id, result: sessionResult() },
              );
              return;
            }
            case 'session/load': {
              if (loadError) {
                send({ error: loadError, id: message.id });
                return;
              }
              if (replayOnLoad) {
                update({
                  content: { text: 'old reply', type: 'text' },
                  sessionUpdate: 'agent_message_chunk',
                });
              }
              send({ id: message.id, result: sessionResult() });
              return;
            }
            case 'session/set_config_option': {
              if (params.configId === 'model') {
                const variant = /^(.*)-(low|medium|high|xhigh)$/.exec(params.value);
                if (MODEL_OPTIONS.includes(params.value)) {
                  model = params.value;
                  if (!thinkingLevels(model).includes(level)) level = 'high';
                } else if (variant && MODEL_OPTIONS.includes(variant[1])) {
                  [, model, level] = variant;
                } else {
                  send({
                    error: { code: -32_602, message: `Unknown model ID: ${params.value}` },
                    id: message.id,
                  });
                  return;
                }
              }
              if (params.configId === 'thought_level') {
                if (FIXED_TIER_MODELS.has(model) || !thinkingLevels(model).includes(params.value)) {
                  send({
                    error: {
                      code: -32_602,
                      message: `Thinking level "${params.value}" is not offered for model "${model}"`,
                    },
                    id: message.id,
                  });
                  return;
                }
                level = params.value;
              }
              if (params.configId === 'mode') mode = params.value;
              send({
                id: message.id,
                result: { configOptions: configOptions(model, level, mode) },
              });
              return;
            }
            case 'session/cancel': {
              if (pendingPrompt) finish(pendingPrompt.id, { stopReason: 'cancelled' });
              return;
            }
            case 'session/prompt': {
              // A prompt arriving mid-turn ends the pending one (agy's steer).
              const ended = {
                stopReason: 'end_turn',
                usage: {
                  cachedReadTokens: 10,
                  inputTokens: 100,
                  outputTokens: 20,
                  thoughtTokens: 5,
                },
              };
              if (pendingPrompt && steerAnswerInSameChunk !== undefined) {
                const lines = [
                  { id: pendingPrompt.id, result: ended },
                  {
                    method: 'session/update',
                    params: { sessionId: SESSION_ID, update: textChunk(steerAnswerInSameChunk) },
                  },
                ];
                stdout.write(
                  lines.map((line) => `${JSON.stringify({ jsonrpc: '2.0', ...line })}\n`).join(''),
                );
                pendingPrompt = undefined;
              } else if (pendingPrompt) {
                finish(pendingPrompt.id, ended);
              }
              pendingPrompt = message;
              onPrompt?.(message, { finish, request: (request) => send({ ...request }), update });
              return;
            }
          }
        });
        return true;
      }),
    },
    stdout,
  });

  return { child, requests, update };
};

const textChunk = (text: string) => ({
  content: { text, type: 'text' },
  sessionUpdate: 'agent_message_chunk',
});

const createSession = (
  agy: ReturnType<typeof createAgy>,
  overrides: Partial<AntigravityAcpSessionOptions> = {},
) => {
  spawnMock.mockReturnValue(agy.child);
  const events: AgentStreamEvent[] = [];
  const onModel = vi.fn();
  const onSessionId = vi.fn();
  const session = new AntigravityAcpSession({
    args: [],
    clientVersion: 'test',
    commandPath: 'agy',
    cwd: '/repo',
    env: {} as NodeJS.ProcessEnv,
    onEvents: (batch) => {
      events.push(...batch);
    },
    onModel,
    onRawMessage: () => {},
    onRuntimeStatus: () => {},
    onSessionId,
    onStderr: () => {},
    operationId: 'op-1',
    prompt: [{ text: 'hello', type: 'text' }],
    sessionId: 'lobe-session',
    ...overrides,
  });
  return { events, onModel, onSessionId, session };
};

const methods = (requests: RpcMessage[]) => requests.map((request) => request.method);

afterEach(() => {
  spawnMock.mockReset();
});

describe('AntigravityAcpSession', () => {
  it('keeps the new model’s thinking level when the requested tier is unavailable', async () => {
    const agy = createAgy({
      onPrompt: (prompt, { finish }) => finish(prompt.id, { stopReason: 'end_turn' }),
    });
    const { session } = createSession(agy, {
      args: ['--model', 'gemini-3.8-flash', '--effort', 'xhigh'],
    });

    await expect(session.run()).resolves.toBeUndefined();
    expect(agy.requests.some(({ params }) => params?.configId === 'thought_level')).toBe(false);
    expect(methods(agy.requests)).toContain('session/prompt');
  });

  it.each([
    {
      answer: { result: { 'Channels?': [' 1', '2'], 'Region?': '2' } },
      result: { action: 'accept', content: { q1_other: '2', q2: ['1'], q2_other: '2' } },
    },
    {
      answer: { cancelled: true, cancelReason: 'user_cancelled' as const },
      result: { action: 'decline' },
    },
  ])('answers an agy form with the same tool id: $result.action', async ({ answer, result }) => {
    const toolCallId = 'call-ask-1';
    const askUserBridge = new AskUserBridge('op-1', {
      identifier: 'antigravity',
      provider: 'antigravity',
    });
    const onAnswer = vi.fn();
    const agy = createAgy({
      onClientResponse: (message, finish) => {
        onAnswer(message);
        agy.update({
          name: 'ask_question',
          sessionUpdate: 'tool_call_update',
          status: 'completed',
          toolCallId,
        });
        finish();
      },
      onPrompt: (_prompt, { request, update }) => {
        update({ name: 'read_file', sessionUpdate: 'tool_call', toolCallId: 'previous-tool' });
        update({
          sessionUpdate: 'tool_call_update',
          status: 'completed',
          toolCallId: 'previous-tool',
        });
        update({
          name: 'ask_question',
          sessionUpdate: 'tool_call',
          status: 'in_progress',
          toolCallId,
        });
        request({
          id: 'elicitation-1',
          method: 'elicitation/create',
          params: {
            mode: 'form',
            requestedSchema: {
              properties: {
                q1: {
                  oneOf: [
                    { const: '1', title: 'EU' },
                    { const: '2', title: 'US' },
                  ],
                  title: 'Region?',
                  type: 'string',
                },
                q1_other: { title: 'Other', type: 'string' },
                q2: {
                  items: {
                    anyOf: [
                      { const: '1', title: 'Email' },
                      { const: '2', title: 'SMS' },
                    ],
                  },
                  title: 'Channels?',
                  type: 'array',
                },
                q2_other: { title: 'Other', type: 'string' },
              },
              type: 'object',
            },
            sessionId: SESSION_ID,
            toolCallId,
          },
        });
      },
    });
    const { events: sessionEvents, session } = createSession(agy, { askUserBridge });
    const run = session.run();
    try {
      await vi.waitFor(() => {
        expect(agy.requests[0]?.params?.clientCapabilities).toMatchObject({
          elicitation: { form: {} },
        });
        expect(sessionEvents.some((event) => event.type === 'agent_intervention_request')).toBe(
          true,
        );
      });
      const requestIndex = sessionEvents.findIndex(
        (event) => event.type === 'agent_intervention_request',
      );
      const request = sessionEvents[requestIndex];
      expect(sessionEvents.slice(0, requestIndex)).toContainEqual(
        expect.objectContaining({
          data: expect.objectContaining({ toolCallId }),
          type: 'tool_start',
        }),
      );
      expect(request.data).toMatchObject({
        apiName: 'askUserQuestion',
        provider: 'antigravity',
        toolCallId,
      });
      expect(JSON.parse(request.data.arguments).questions).toMatchObject([
        {
          multiSelect: false,
          options: [
            { id: ' 1', label: 'EU' },
            { id: ' 2', label: 'US' },
          ],
          question: 'Region?',
        },
        { multiSelect: true, question: 'Channels?' },
      ]);
      askUserBridge.resolve(toolCallId, answer);
      await run;
      expect(onAnswer).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'elicitation-1', result }),
      );
      expect(
        sessionEvents.filter(
          (event) => event.type === 'tool_start' && event.data.toolCallId === toolCallId,
        ),
      ).toMatchObject([
        {
          data: {
            toolCallId,
            toolCalling: { apiName: 'askUserQuestion', identifier: 'antigravity' },
          },
        },
      ]);
      expect(sessionEvents).toContainEqual(
        expect.objectContaining({ type: 'tool_end', data: { isSuccess: true, toolCallId } }),
      );
    } finally {
      askUserBridge.cancelAll();
      session.close();
      await run.catch(() => {});
    }
  });

  it('starts agy acp, applies the selected model, effort and mode, then streams the turn', async () => {
    const agy = createAgy({
      onPrompt: (prompt, { finish, update }) => {
        update({
          name: 'run_command',
          rawInput: { CommandLine: 'id -un' },
          sessionUpdate: 'tool_call',
          status: 'in_progress',
          toolCallId: 'call-1',
        });
        update({
          content: [{ content: { text: 'mocha', type: 'text' }, type: 'content' }],
          sessionUpdate: 'tool_call_update',
          status: 'completed',
          toolCallId: 'call-1',
        });
        update(textChunk('done'));
        finish(prompt.id, {
          stopReason: 'end_turn',
          usage: {
            cachedReadTokens: 14_118,
            inputTokens: 18_618,
            outputTokens: 312,
            thoughtTokens: 0,
          },
        });
      },
    });
    const { events, onModel, onSessionId, session } = createSession(agy, {
      args: ['--model', 'gemini-3.8-flash', '--effort', 'low', '--mode', 'accept-edits'],
      prompt: [
        { text: 'look', type: 'text' },
        { data: 'iVBORw0KGgo=', mimeType: 'image/png', type: 'image' },
      ],
    });

    await session.run();

    expect(spawnMock).toHaveBeenCalledWith(
      'agy',
      ['acp', '--dangerously-skip-permissions'],
      expect.objectContaining({ cwd: '/repo' }),
    );
    expect(methods(agy.requests)).toEqual([
      'initialize',
      'session/new',
      'session/set_config_option',
      'session/set_config_option',
      'session/set_config_option',
      'session/prompt',
    ]);
    expect(agy.requests.slice(2, 5).map((request) => request.params)).toEqual([
      { configId: 'model', sessionId: SESSION_ID, value: 'gemini-3.8-flash' },
      { configId: 'thought_level', sessionId: SESSION_ID, value: 'low' },
      { configId: 'mode', sessionId: SESSION_ID, value: 'accept-edits' },
    ]);
    expect(agy.requests[5].params?.prompt).toEqual([
      { text: 'look', type: 'text' },
      { data: 'iVBORw0KGgo=', mimeType: 'image/png', type: 'image' },
    ]);
    expect(onSessionId).toHaveBeenCalledWith(SESSION_ID);
    expect(onModel).toHaveBeenCalledWith('gemini-3.8-flash-low');

    const toolStart = events.find((event) => event.type === 'tool_start');
    expect(toolStart?.data.toolCalling).toMatchObject({
      apiName: 'run_command',
      arguments: '{"CommandLine":"id -un"}',
      identifier: 'antigravity',
    });
    expect(events.find((event) => event.type === 'tool_result')?.data).toMatchObject({
      content: 'mocha',
      isError: false,
    });
    expect(
      events.filter((event) => event.type === 'stream_chunk' && event.data.chunkType === 'text'),
    ).toHaveLength(1);
    // agy reports input without cache reads; totals include them.
    expect(
      events.find((event) => event.type === 'step_complete' && event.data.phase === 'turn_metadata')
        ?.data.usage,
    ).toMatchObject({
      inputCachedTokens: 14_118,
      inputCacheMissTokens: 18_618,
      totalInputTokens: 32_736,
      totalOutputTokens: 312,
      totalTokens: 33_048,
    });
    expect(events.at(-1)).toMatchObject({
      data: { stopReason: 'end_turn' },
      type: 'agent_runtime_end',
    });
  });

  it.each([
    // The selector splits `gpt-oss-120b-medium` into a model and an effort.
    { args: ['--model', 'gpt-oss-120b', '--effort', 'medium'], model: 'gpt-oss-120b-medium' },
    { args: ['--model', 'gpt-oss-120b'], model: 'gpt-oss-120b-medium' },
    {
      args: ['--model', 'gemini-pro-orchestrator', '--effort', 'high'],
      model: 'gemini-pro-orchestrator',
    },
  ])(
    'selects a fixed-tier model by its full slug and sets no effort ($args)',
    async ({ args, model }) => {
      const agy = createAgy({
        onPrompt: (prompt, { finish }) => finish(prompt.id, { stopReason: 'end_turn' }),
      });
      const { events, onModel, session } = createSession(agy, { args });

      await session.run();

      expect(
        agy.requests
          .filter((request) => request.method === 'session/set_config_option')
          .map((request) => request.params),
      ).toEqual([{ configId: 'model', sessionId: SESSION_ID, value: model }]);
      expect(onModel).toHaveBeenCalledWith(model);
      expect(events.some((event) => event.type === 'error')).toBe(false);
    },
  );

  it('steers a follow-up into the running turn and ends the run with the last prompt', async () => {
    let steered: ((value?: unknown) => void) | undefined;
    const steeredPrompt = new Promise((resolve) => (steered = resolve));
    const agy = createAgy({
      onPrompt: (prompt, { finish, update }) => {
        const text = prompt.params?.prompt?.[0]?.text;
        if (text === 'run sleep') {
          update({
            name: 'run_command',
            rawInput: { CommandLine: 'sleep 20' },
            sessionUpdate: 'tool_call',
            status: 'in_progress',
            toolCallId: 'call-sleep',
          });
          return;
        }
        steered?.();
        setTimeout(() => {
          update({
            content: [{ content: { text: 'done1', type: 'text' }, type: 'content' }],
            sessionUpdate: 'tool_call_update',
            status: 'completed',
            toolCallId: 'call-sleep',
          });
          update(textChunk('FIRST BANANA'));
          finish(prompt.id, {
            stopReason: 'end_turn',
            usage: { cachedReadTokens: 1, inputTokens: 50, outputTokens: 7, thoughtTokens: 0 },
          });
        }, 0);
      },
    });
    const { events, session } = createSession(agy, {
      prompt: [{ text: 'run sleep', type: 'text' }],
    });

    expect(session.steer([{ text: 'too early', type: 'text' }], 'msg-early')).toBe(false);
    const run = session.run();
    await vi.waitFor(() => expect(events.some((event) => event.type === 'tool_start')).toBe(true));

    expect(session.steer([{ text: 'add BANANA', type: 'text' }], 'msg-steer')).toBe(true);
    await steeredPrompt;
    await run;

    expect(methods(agy.requests).filter((method) => method === 'session/prompt')).toHaveLength(2);
    const types = events.map((event) =>
      event.type === 'step_complete' ? `step_complete:${event.data.phase}` : event.type,
    );
    const confirmed = types.indexOf('step_complete:user_message');
    expect(confirmed).toBeGreaterThan(types.indexOf('tool_start'));
    expect(events[confirmed].data).toEqual({ phase: 'user_message', uuid: 'msg-steer' });
    // The answer to the steer opens a step of its own.
    const answer = events.find(
      (event) => event.type === 'stream_chunk' && event.data.content === 'FIRST BANANA',
    );
    expect(answer!.stepIndex).toBeGreaterThan(events[confirmed].stepIndex);
    expect(events.filter((event) => event.type === 'agent_runtime_end')).toHaveLength(1);
    expect(
      events.find((event) => event.type === 'step_complete' && event.data.phase === 'turn_metadata')
        ?.data.usage,
    ).toMatchObject({ totalInputTokens: 161, totalOutputTokens: 27 });
    expect(session.steer([{ text: 'late', type: 'text' }], 'msg-late')).toBe(false);
  });

  it('confirms a steer before its answer when both arrive in one stdout chunk', async () => {
    const agy = createAgy({
      onPrompt: (prompt, { finish }) => {
        if (prompt.params?.prompt?.[0]?.text === 'add BANANA') {
          setTimeout(() => finish(prompt.id, { stopReason: 'end_turn' }), 0);
        }
      },
      steerAnswerInSameChunk: 'FIRST BANANA',
    });
    const { events, session } = createSession(agy);
    const run = session.run();
    await vi.waitFor(() => expect(methods(agy.requests).includes('session/prompt')).toBe(true));

    expect(session.steer([{ text: 'add BANANA', type: 'text' }], 'msg-steer')).toBe(true);
    await run;

    const confirmed = events.findIndex(
      (event) => event.type === 'step_complete' && event.data.phase === 'user_message',
    );
    const answer = events.findIndex(
      (event) => event.type === 'stream_chunk' && event.data.content === 'FIRST BANANA',
    );
    expect(confirmed).toBeGreaterThanOrEqual(0);
    expect(answer).toBeGreaterThan(confirmed);
    expect(events[answer].stepIndex).toBeGreaterThan(events[confirmed].stepIndex);
  });

  it('leaves a follow-up for the next turn while the old answer is streaming', async () => {
    let finishFirst!: () => void;
    const agy = createAgy({
      onPrompt: (prompt, { finish, update }) => {
        update(textChunk('Old answer begins.'));
        finishFirst = () => {
          update(textChunk(' Old answer ends.'));
          finish(prompt.id, { stopReason: 'end_turn' });
        };
      },
    });
    const { events, session } = createSession(agy);
    const run = session.run();
    await vi.waitFor(() =>
      expect(events.some((event) => event.type === 'stream_chunk')).toBe(true),
    );

    const accepted = session.steer([{ text: 'Next task', type: 'text' }], 'msg-next');
    finishFirst();
    if (accepted) session.close();
    await run;

    expect(accepted).toBe(false);
    expect(methods(agy.requests).filter((method) => method === 'session/prompt')).toHaveLength(1);
    expect(
      events
        .filter((event) => event.type === 'stream_chunk' && event.data.chunkType === 'text')
        .map((event) => [event.stepIndex, event.data.content]),
    ).toEqual([
      [0, 'Old answer begins.'],
      [0, ' Old answer ends.'],
    ]);
  });

  it('refuses a steer after the active prompt returned while its output is still draining', async () => {
    const agy = createAgy({
      onPrompt: (prompt, { finish, update }) => {
        finish(prompt.id, { stopReason: 'end_turn' });
        update({
          content: { text: 'Trailing thought', type: 'text' },
          sessionUpdate: 'agent_thought_chunk',
        });
      },
    });
    let accepted: boolean | undefined;
    const { session } = createSession(agy, {
      onEvents: (events) => {
        if (
          accepted === undefined &&
          events.some((event) => event.data?.chunkType === 'reasoning')
        ) {
          accepted = session.steer([{ text: 'Next task', type: 'text' }], 'msg-next');
        }
      },
    });
    await session.run();

    expect(accepted).toBe(false);
    expect(methods(agy.requests).filter((method) => method === 'session/prompt')).toHaveLength(1);
  });

  it('ends as interrupted when stopped after a steer, and refuses further steers', async () => {
    const agy = createAgy({ onPrompt: () => {} });
    const { events, session } = createSession(agy);
    const run = session.run();
    await vi.waitFor(() => expect(methods(agy.requests).includes('session/prompt')).toBe(true));

    expect(session.steer([{ text: 'more', type: 'text' }], 'msg-1')).toBe(true);
    await vi.waitFor(() =>
      expect(methods(agy.requests).filter((method) => method === 'session/prompt')).toHaveLength(2),
    );
    session.interrupt();
    expect(session.steer([{ text: 'after stop', type: 'text' }], 'msg-2')).toBe(false);
    await run;

    expect(methods(agy.requests)).toContain('session/cancel');
    expect(
      events.find((event) => event.type === 'step_complete' && event.data.phase === 'user_message')
        ?.data,
    ).toEqual({ phase: 'user_message', uuid: 'msg-1' });
    expect(events.at(-1)).toMatchObject({
      data: { reason: 'interrupted', stopReason: 'cancelled' },
      type: 'agent_runtime_end',
    });
  });

  it('resumes the saved conversation without replaying it', async () => {
    const agy = createAgy({
      onPrompt: (prompt, { finish, update }) => {
        update(textChunk('PINEAPPLE'));
        finish(prompt.id, { stopReason: 'end_turn' });
      },
    });
    const { events, session } = createSession(agy, { resumeSessionId: SESSION_ID });
    await session.run();

    expect(methods(agy.requests).slice(0, 3)).toEqual([
      'initialize',
      'session/resume',
      'session/prompt',
    ]);
    expect(agy.requests[1].params).toEqual({ cwd: '/repo', mcpServers: [], sessionId: SESSION_ID });
    expect(events.find((event) => event.type === 'stream_chunk')?.data.content).toBe('PINEAPPLE');
  });

  it('falls back to session/load when resume fails and drops the replayed history', async () => {
    const agy = createAgy({
      onPrompt: (prompt, { finish, update }) => {
        update(textChunk('new reply'));
        finish(prompt.id, { stopReason: 'end_turn' });
      },
      replayOnLoad: true,
      resumeError: {
        code: -32_603,
        message: 'Failed to read session; retry, or load it with session/load',
      },
    });
    const { events, session } = createSession(agy, { resumeSessionId: SESSION_ID });
    await session.run();

    expect(methods(agy.requests).slice(1, 3)).toEqual(['session/resume', 'session/load']);
    const texts = events.flatMap((event) =>
      event.type === 'stream_chunk' && event.data.chunkType === 'text' ? [event.data.content] : [],
    );
    expect(texts).toEqual(['new reply']);
  });

  it('reports a conversation agy no longer has as a missing resume session', async () => {
    const agy = createAgy({
      loadError: { code: -32_002, message: 'Session not found: gone' },
      resumeError: { code: -32_603, message: 'Failed to read session gone' },
    });
    const { session } = createSession(agy, { resumeSessionId: 'gone' });

    const error = await session.run().catch((cause) => cause);
    expect(isAntigravityAcpSessionNotFoundError(error)).toBe(true);
    expect(String(error.message)).toMatch(/session not found/i);
  });

  it('turns a signed-out agy into the Antigravity sign-in guide', async () => {
    const agy = createAgy({ newError: { code: -32_000, message: 'Authentication required' } });
    const { events, session } = createSession(agy);

    await expect(session.run()).rejects.toThrow('Authentication required');
    expect(events.find((event) => event.type === 'error')?.data).toMatchObject({
      agentType: 'antigravity',
      message: 'Antigravity could not authenticate. Run `agy` and sign in, then retry.',
    });
  });

  it('treats agy’s quota notice in a text update as a terminal, resettable usage limit', async () => {
    const now = Date.now();
    const quotaNotice =
      '⚠ Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 28m39s.';
    const agy = createAgy({
      onPrompt: (prompt, { finish, update }) => {
        update(textChunk(quotaNotice));
        finish(prompt.id, { stopReason: 'end_turn' });
      },
    });
    const { events, session } = createSession(agy);

    await expect(session.run()).rejects.toThrow('Individual quota reached');
    expect(events.find((event) => event.type === 'error')?.data).toMatchObject({
      agentType: 'antigravity',
      code: 'rate_limit',
      details: { kind: 'usage_limit' },
      rateLimitInfo: { status: 'rejected' },
    });
    const reset = events.find((event) => event.type === 'error')?.data.rateLimitInfo.resetsAt;
    expect(reset).toBeGreaterThanOrEqual(Math.floor(now / 1000) + 28 * 60 + 39);
    expect(reset).toBeLessThanOrEqual(Math.ceil(Date.now() / 1000) + 28 * 60 + 39);
    expect(events.some((event) => event.type === 'stream_chunk')).toBe(false);
  });

  it('does not turn an answer discussing the quota notice into a failure', async () => {
    const answer =
      'The CLI says “Individual quota reached. Please upgrade your subscription to increase your limits.” when its allowance runs out.';
    const agy = createAgy({
      onPrompt: (prompt, { finish, update }) => {
        update(textChunk(answer));
        finish(prompt.id, { stopReason: 'end_turn' });
      },
    });
    const { events, session } = createSession(agy);
    await session.run();

    expect(events.find((event) => event.type === 'stream_chunk')?.data.content).toBe(answer);
    expect(events.some((event) => event.type === 'error')).toBe(false);
  });

  it('opens a step for the quota card when the steer fails before producing output', async () => {
    const agy = createAgy({
      onPrompt: (prompt, { finish, update }) => {
        if (prompt.params?.prompt?.[0]?.text === 'next') {
          update(
            textChunk(
              'Individual quota reached. Please upgrade your subscription to increase your limits.',
            ),
          );
          finish(prompt.id, { stopReason: 'end_turn' });
        } else {
          update({
            content: { text: 'Thinking', type: 'text' },
            sessionUpdate: 'agent_thought_chunk',
          });
        }
      },
    });
    const { events, session } = createSession(agy);
    const run = session.run();
    await vi.waitFor(() =>
      expect(events.some((event) => event.type === 'stream_chunk')).toBe(true),
    );
    expect(session.steer([{ text: 'next', type: 'text' }], 'msg-next')).toBe(true);
    await expect(run).rejects.toThrow('Individual quota reached');

    const steerIndex = events.findIndex((event) => event.data?.phase === 'user_message');
    const nextIndex = events.findIndex(
      (event) => event.type === 'stream_start' && event.data?.newStep,
    );
    const errorIndex = events.findIndex((event) => event.type === 'error');
    expect(steerIndex).toBeGreaterThanOrEqual(0);
    expect(nextIndex).toBeGreaterThan(steerIndex);
    expect(errorIndex).toBeGreaterThan(nextIndex);
    expect(events[errorIndex].stepIndex).toBe(events[nextIndex].stepIndex);
  });

  it('keeps subagent conversations out of the parent stream', async () => {
    const agy = createAgy({
      onPrompt: (prompt, { finish }) => {
        agy.update(textChunk('child output'), 'child-session');
        agy.update(textChunk('parent output'));
        finish(prompt.id, { stopReason: 'end_turn' });
      },
    });
    const { events, session } = createSession(agy);
    await session.run();

    const texts = events.flatMap((event) =>
      event.type === 'stream_chunk' && event.data.chunkType === 'text' ? [event.data.content] : [],
    );
    expect(texts).toEqual(['parent output']);
  });
});
