import type { AgentRuntimeHost, AgentState, ToolCallHookEvent } from '@lobechat/agent-runtime';
import {
  AgentRuntime,
  createAgentRuntimeExecutors,
  GeneralChatAgent,
} from '@lobechat/agent-runtime';
import type { ChatToolPayload } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentHook } from '@/server/services/agentRuntime/hooks';
import { HookDispatcher } from '@/server/services/agentRuntime/hooks';

import type { RuntimeExecutorContext } from '../context';
import { ServerToolTransport } from './ServerToolTransport';

const { dispatchClient, fetchHook, getEmailsByIds, queueMode } = vi.hoisted(() => ({
  dispatchClient: vi.fn(),
  fetchHook: vi.fn(),
  getEmailsByIds: vi.fn(),
  queueMode: vi.fn(),
}));
vi.mock('../dispatchClientTool', () => ({ dispatchClientTool: dispatchClient }));
vi.mock('@/database/models/user', () => ({ UserModel: { getEmailsByIds } }));
vi.mock('@/database/server', () => ({ getServerDB: async () => ({}) }));
vi.mock('@/server/services/queue/impls', () => ({ isQueueAgentRuntimeEnabled: queueMode }));
vi.mock('@/libs/qstash', () => ({ OtelQstashClient: class {} }));
vi.mock('@/database/models/agent', () => ({
  AgentModel: class {
    getAgentVisibility = async () => 'private';
  },
}));
vi.mock('../executorHelpers', () => ({
  archiveRuntimeToolResult: async (result: unknown) => result,
  buildServerAgentMemberRunner: () => undefined,
  buildServerVirtualSubAgentRunner: () => undefined,
  GEN_AI_FUNCTION_TOOL_TYPE: 'function',
  isOperationInterrupted: async () => false,
  log: () => {},
  registerWorkFromIntent: vi.fn(),
  TOOL_MAX_RETRIES: 2,
  TOOL_PRICING: { 'fs/write': 5 },
}));

const call = (id = 'native-1'): ChatToolPayload => ({
  id,
  apiName: 'write',
  identifier: 'fs',
  arguments: '{"path":"a"}',
  type: 'builtin',
});
const control = (id = 'control', onError: 'continue' | 'block' = 'continue'): AgentHook => ({
  id,
  type: 'beforeToolCall',
  webhook: { url: `https://hooks.example/${id}`, responseHandling: 'toolCall', onError },
});
const response = (decision: 'allow' | 'deny', reason?: string) =>
  new Response(JSON.stringify(decision === 'deny' ? { decision, reason } : { decision }));

function setup(hooks: AgentHook[], signal?: AbortSignal, restore = false) {
  const registered = new HookDispatcher();
  registered.register('op', hooks);
  const dispatcher = restore ? new HookDispatcher() : registered;
  const execute = vi.fn().mockResolvedValue({ content: 'executed', success: true });
  const rows: Record<string, unknown>[] = [];
  const state: AgentState = {
    cost: {
      calculatedAt: '',
      currency: 'USD',
      llm: { byModel: [], currency: 'USD', total: 0 },
      tools: { byTool: [], currency: 'USD', total: 0 },
      total: 0,
    },
    usage: {
      humanInteraction: {
        approvalRequests: 0,
        promptRequests: 0,
        selectRequests: 0,
        totalWaitingTimeMs: 0,
      },
      llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
      tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
    },
    createdAt: '',
    lastModified: '',
    messages: [],
    operationId: 'op',
    status: 'running',
    stepCount: 0,
    origin: { agentId: 'agent', topicId: 'topic' },
    // Serialize to model a worker boundary, not merely an in-memory clone.
    // eslint-disable-next-line unicorn/prefer-structured-clone
    host: { hooks: JSON.parse(JSON.stringify(registered.getSerializedHooks('op') ?? [])) },
    userInterventionConfig: { approvalMode: 'auto-run' },
  };
  const transport = new ServerToolTransport({
    operationId: 'op',
    stepIndex: 1,
    userId: 'user',
    hookDispatcher: dispatcher,
    abortSignal: signal,
    serverDB: {},
    streamManager: { sendToolExecute: vi.fn() },
    toolExecutionService: { executeTool: execute },
  } as unknown as RuntimeExecutorContext);
  const host: AgentRuntimeHost = {
    operation: { operationId: 'op', stepIndex: 1, agentId: 'agent', abortSignal: signal },
    transports: {
      tools: transport,
      messages: {
        createToolMessage: vi.fn(async (row) => {
          rows.push(row);
          return { ...row, id: `row-${rows.length}` };
        }),
        query: vi.fn(async () => rows),
        updateToolMessage: vi.fn(),
        updateToolIntervention: vi.fn(),
        update: vi.fn(),
        findToolMessageIdByToolCallId: vi.fn(),
      } as unknown as AgentRuntimeHost['transports']['messages'],
      stream: { publishEvent: vi.fn(), publishChunk: vi.fn() },
    },
  };
  const executors = createAgentRuntimeExecutors(host);
  const runtime = new AgentRuntime(new GeneralChatAgent({ operationId: 'op' }), {
    executors,
  });
  const step = (calls = [call()]) =>
    runtime.step(state, {
      phase: 'llm_result',
      payload: { hasToolsCalling: true, parentMessageId: 'assistant', toolsCalling: calls },
    });
  return { dispatcher, execute, executors, host, rows, runtime, state, step };
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchHook);
  getEmailsByIds.mockReset().mockResolvedValue([]);
  fetchHook.mockReset().mockImplementation(async () => response('allow'));
  queueMode.mockReturnValue(false);
  dispatchClient.mockReset().mockResolvedValue({ content: 'client result', success: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('beforeToolCall control pipeline', () => {
  it.each([false, true])(
    'uses the runtime account for tool hooks and execution after state restoration, queue=%s',
    async (queue) => {
      queueMode.mockReturnValue(queue);
      getEmailsByIds.mockResolvedValue([{ id: 'user', email: 'runtime@example.test' }]);
      const fixture = setup(
        [
          control(),
          {
            id: 'after',
            type: 'afterToolCall',
            webhook: { url: 'https://hooks.example/after' },
          },
        ],
        undefined,
        queue,
      );
      fixture.state.origin!.userId = 'origin-owner';
      fixture.state.principal = {
        actor: {
          shareVisitor: {
            agentId: 'agent',
            shareId: 'share-1',
            visitorUserId: 'visitor-1',
          },
        },
      };
      // Restore the trusted state through its persistence wire format.
      // eslint-disable-next-line unicorn/prefer-structured-clone
      Object.assign(fixture.state, JSON.parse(JSON.stringify(fixture.state)));

      await fixture.step([{ ...call(), arguments: '{"path":"a","userId":"untrusted-input"}' }]);

      expect(fetchHook).toHaveBeenCalledTimes(2);
      for (const [, request] of fetchHook.mock.calls) {
        expect(JSON.parse(request.body)).toMatchObject({
          userId: 'user',
          userEmail: 'runtime@example.test',
          args: { userId: 'untrusted-input' },
        });
      }
      expect(fixture.execute).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ userId: 'user' }),
      );
      expect(fixture.state.origin?.userId).toBe('origin-owner');
      expect(getEmailsByIds).toHaveBeenCalledExactlyOnceWith({}, ['user']);
    },
  );

  it.each([
    { queue: false, reason: undefined },
    { queue: true, reason: undefined },
    { queue: false, reason: '' },
    { queue: true, reason: '' },
  ])(
    'denies before mock/execution and persists attempts=0, queue=$queue, reason=$reason',
    async ({ queue, reason }) => {
      queueMode.mockReturnValue(queue);
      fetchHook.mockImplementation(async () => response('deny', reason));
      const mock = vi.fn(async (event) => {
        (event as ToolCallHookEvent).mock({ content: 'mock', success: true });
      });
      const after = vi.fn();
      const fixture = setup(
        [
          control(),
          { id: 'mock', type: 'beforeToolCall', handler: mock },
          { id: 'after', type: 'afterToolCall', handler: after },
        ],
        undefined,
        queue,
      );
      const result = await fixture.step();
      expect(result.newState.status).toBe('running');
      expect(fixture.execute).not.toHaveBeenCalled();
      expect(mock).not.toHaveBeenCalled();
      expect(fixture.rows).toEqual([
        expect.objectContaining({
          pluginState: { reason: 'Blocked by beforeToolCall hook.', type: 'blocked' },
          tool_call_id: 'native-1',
        }),
      ]);
      expect(fixture.host.transports.stream.publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_end',
          data: expect.objectContaining({
            attempts: 0,
            result: expect.objectContaining({ success: false }),
          }),
        }),
      );
      expect(result.newState.cost?.total ?? 0).toBe(0);
      expect(fetchHook).toHaveBeenCalledTimes(1);
      if (!queue)
        expect(after).toHaveBeenCalledWith(
          expect.objectContaining({
            mocked: false,
            result: expect.objectContaining({
              success: false,
              state: { reason: 'Blocked by beforeToolCall hook.', type: 'blocked' },
            }),
          }),
        );
    },
  );

  it.each([
    { mode: 'single', failure: 'deny', reason: 'Workspace policy forbids this write.' },
    { mode: 'batch', failure: 'deny', reason: 'Workspace policy forbids this write.' },
    { mode: 'single', failure: 'error', reason: 'hook_control_error' },
    { mode: 'batch', failure: 'error', reason: 'hook_control_error' },
  ])(
    'preserves the $failure rejection reason in a new $mode tool card',
    async ({ mode, failure, reason }) => {
      fetchHook.mockImplementation(async () =>
        failure === 'deny' ? response('deny', reason) : new Response('{"decision":"invalid"}'),
      );
      const fixture = setup([control('control', 'block')]);
      const result =
        mode === 'single'
          ? await fixture.executors.call_tool!(
              { type: 'call_tool', payload: { parentMessageId: 'assistant', toolCalling: call() } },
              fixture.state,
            )
          : await fixture.executors.call_tools_batch!(
              {
                type: 'call_tools_batch',
                payload: { parentMessageId: 'assistant', toolsCalling: [call()] },
              },
              fixture.state,
            );
      expect(fixture.rows).toEqual([
        expect.objectContaining({
          content: reason,
          pluginError: 'hook_denied',
          pluginState: { type: 'blocked', reason },
          pluginIntervention: { status: 'rejected', rejectedReason: reason },
        }),
      ]);
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: 'tool_result',
          result: expect.objectContaining({
            content: reason,
            error: 'hook_denied',
            state: { type: 'blocked', reason },
            success: false,
          }),
        }),
      );
      expect(fixture.execute).not.toHaveBeenCalled();
      expect(result.newState.cost?.total).toBe(0);
    },
  );

  it.each(['single', 'batch'] as const)(
    'preserves the rejection reason when reusing an approved %s row',
    async (mode) => {
      const reason = 'Approval does not override this policy.';
      fetchHook.mockImplementation(async () => response('deny', reason));
      const fixture = setup([control()]);
      await fixture.runtime.step(fixture.state, {
        phase: 'human_approved_tool',
        payload:
          mode === 'single'
            ? {
                approvedToolCall: call(),
                parentMessageId: 'pending-row',
                skipCreateToolMessage: true,
              }
            : {
                approvedToolCalls: [call()],
                parentMessageId: 'assistant',
                toolMessageIds: { 'native-1': 'pending-row' },
              },
      });
      expect(fixture.host.transports.messages.updateToolMessage).toHaveBeenCalledWith(
        'pending-row',
        expect.objectContaining({
          content: reason,
          pluginError: 'hook_denied',
          pluginState: { type: 'blocked', reason },
        }),
      );
      expect(fixture.host.transports.messages.updateToolIntervention).toHaveBeenCalledWith(
        'pending-row',
        { status: 'rejected', rejectedReason: reason },
      );
      expect(fixture.rows).toHaveLength(0);
      expect(fixture.execute).not.toHaveBeenCalled();
    },
  );

  it('cancels during email lookup before HTTP or tool execution', async () => {
    let resolveEmail!: (rows: { id: string; email: string }[]) => void;
    getEmailsByIds.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveEmail = resolve;
        }),
    );
    const abort = new AbortController();
    const fixture = setup([control()], abort.signal);
    const pending = fixture.step();
    await vi.waitFor(() => expect(getEmailsByIds).toHaveBeenCalledTimes(1));
    abort.abort();
    const result = await pending;
    resolveEmail([{ id: 'user', email: 'late@example.test' }]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fetchHook).not.toHaveBeenCalled();
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.rows).toEqual([
      expect.objectContaining({
        tool_call_id: 'native-1',
        pluginIntervention: { status: 'aborted' },
      }),
    ]);
    expect(result.events.some((event) => event.type === 'human_approve_required')).toBe(false);
  });

  it('does not consult control before product approval', async () => {
    const fixture = setup([control()]);
    fixture.state.userInterventionConfig = { approvalMode: 'manual' };
    const result = await fixture.step();
    expect(result.newState.status).toBe('waiting_for_human');
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fetchHook).not.toHaveBeenCalled();
  });

  it('allow does not bypass the product tool allow-list', async () => {
    const fixture = setup([control()]);
    const runtime = new AgentRuntime(
      new GeneralChatAgent({ operationId: 'op', allowedToolNames: ['other/tool'] }),
      {
        executors: fixture.executors,
      },
    );
    const result = await runtime.step(fixture.state, {
      phase: 'llm_result',
      payload: { hasToolsCalling: true, toolsCalling: [call()], parentMessageId: 'assistant' },
    });
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fetchHook).not.toHaveBeenCalled();
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'tool_result',
        result: expect.objectContaining({ state: { reason: 'tool_not_allowed', type: 'blocked' } }),
      }),
    );
  });

  it('applies ordered controls and stops at deny, before observers', async () => {
    fetchHook.mockResolvedValueOnce(response('allow')).mockResolvedValueOnce(response('deny'));
    const observer = vi.fn();
    const fixture = setup([
      { id: 'observer', type: 'beforeToolCall', handler: observer },
      control('one'),
      control('two'),
      control('three'),
    ]);
    await fixture.step();
    expect(fetchHook.mock.calls.map(([url]) => url)).toEqual([
      'https://hooks.example/one',
      'https://hooks.example/two',
    ]);
    expect(JSON.parse(fetchHook.mock.calls[0][1].body)).not.toHaveProperty('originalArgs');
    expect(observer).not.toHaveBeenCalled();
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(JSON.parse(fetchHook.mock.calls[0][1].body)).toMatchObject({
      toolCallId: 'native-1',
      args: { path: 'a' },
    });
  });

  it('checks each ordered lane member at execution entry and only blocks its denied member', async () => {
    const order: string[] = [];
    fetchHook.mockImplementation(async (_url, init) => {
      const id = JSON.parse(init.body).toolCallId;
      order.push(id);
      return response(id === 'native-2' ? 'deny' : 'allow');
    });
    const fixture = setup([control()]);
    fixture.state.toolManifestMap = { fs: { api: [{ name: 'write', ordered: true }] } };
    fixture.execute.mockImplementation(async () => {
      order.push('execute');
      return { content: 'ok', success: true };
    });
    const result = await fixture.executors.call_tools_batch!(
      {
        type: 'call_tools_batch',
        payload: {
          parentMessageId: 'assistant',
          toolsCalling: [call(), call('native-2'), call('native-3')],
        },
      },
      fixture.state,
    );
    expect(order).toEqual(['native-1', 'execute', 'native-2', 'native-3', 'execute']);
    expect(fixture.execute).toHaveBeenCalledTimes(2);
    expect(result.events.filter((event) => event.type === 'tool_result')).toHaveLength(3);
    expect(result.newState.cost?.total).toBe(10);
  });

  it.each([false, true])(
    'delivers observe/mock once and webhook-only in queue=%s',
    async (queue) => {
      queueMode.mockReturnValue(queue);
      const handler = vi.fn();
      const fixture = setup([
        control(),
        {
          id: 'dual',
          type: 'beforeToolCall',
          handler,
          webhook: { url: 'https://hooks.example/dual' },
        },
        { id: 'http', type: 'beforeToolCall', webhook: { url: 'https://hooks.example/http' } },
      ]);
      await fixture.step();
      expect(handler).toHaveBeenCalledTimes(queue ? 0 : 1);
      expect(fetchHook.mock.calls.map(([url]) => url)).toEqual(
        queue
          ? [
              'https://hooks.example/control',
              'https://hooks.example/dual',
              'https://hooks.example/http',
            ]
          : ['https://hooks.example/control', 'https://hooks.example/http'],
      );
      expect(fixture.execute).toHaveBeenCalledTimes(1);
    },
  );

  it('runs an in-memory mock once after control and skips real effects', async () => {
    const handler = vi.fn(async (event) => {
      (event as ToolCallHookEvent).mock({ content: 'mock', success: true });
    });
    const fixture = setup([control(), { id: 'mock', type: 'beforeToolCall', handler }]);
    const result = await fixture.step();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'tool_result',
        result: expect.objectContaining({ content: 'mock' }),
      }),
    );
  });

  it('checks control once outside internal tool retries', async () => {
    const handler = vi.fn();
    const fixture = setup([control(), { id: 'observe', type: 'beforeToolCall', handler }]);
    fixture.execute.mockResolvedValueOnce({
      content: '',
      success: false,
      error: { kind: 'retry' },
    });
    await fixture.step();
    expect(fixture.execute).toHaveBeenCalledTimes(2);
    expect(fetchHook).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('aborts waiting for an uncooperative webhook and a late allow cannot launch', async () => {
    let release!: (value: Response) => void;
    fetchHook.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const abort = new AbortController();
    const fixture = setup([control()], abort.signal);
    const pending = fixture.step();
    await vi.waitFor(() => expect(fetchHook).toHaveBeenCalledTimes(1));
    abort.abort();
    await pending;
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.rows[0].pluginIntervention).toEqual({ status: 'aborted' });
    release(response('allow'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it.each(['constructor', '__proto__'])('checks controls for native id %s', async (id) => {
    fetchHook.mockImplementation(async () => response('deny'));
    const fixture = setup([control()]);
    await fixture.step([call(id)]);
    expect(fetchHook).toHaveBeenCalledTimes(1);
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.rows[0].pluginState).toEqual({
      reason: 'Blocked by beforeToolCall hook.',
      type: 'blocked',
    });
    await fixture.executors.call_tools_batch!(
      {
        type: 'call_tools_batch',
        payload: { parentMessageId: 'assistant', toolsCalling: [call(id)] },
      },
      fixture.state,
    );
    expect(fetchHook).toHaveBeenCalledTimes(2);
    expect(fixture.rows).toHaveLength(2);
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  describe.each([false, true])('control errors, queue=%s', (queue) => {
    it.each([
      { body: '{"decision":"ask"}', status: 200 },
      { body: '{"decision":"deny","reason":42}', status: 200 },
      { body: '{"decision":"allow"}', status: 400 },
      { body: '{"decision":"allow"}', status: 500 },
    ])('applies both onError policies to response %#', async ({ body, status }) => {
      queueMode.mockReturnValue(queue);
      fetchHook.mockImplementation(async () => new Response(body, { status }));
      const blocked = setup([control('block', 'block')], undefined, queue);
      await blocked.step();
      expect(blocked.execute).not.toHaveBeenCalled();
      expect(blocked.rows[0]).toMatchObject({
        content: 'hook_control_error',
        pluginError: 'hook_denied',
        pluginIntervention: { status: 'rejected', rejectedReason: 'hook_control_error' },
      });
      const continued = setup([control()], undefined, queue);
      await continued.step();
      expect(continued.execute).toHaveBeenCalledTimes(1);
      expect(continued.execute.mock.calls[0][0].arguments).toBe('{"path":"a"}');
    });

    it.each([
      { body: '', status: 200 },
      { body: null, status: 204 },
      { body: '{}', status: 200 },
      { body: 'not JSON', status: 200 },
      { body: '{"reason":"missing decision"}', status: 200 },
      { body: '{"decision":"allow"}', status: 201 },
      { body: '{"hookSpecificOutput":{"permissionDecision":"deny"}}', status: 200 },
    ])('allows notification responses with onError=block %#', async ({ body, status }) => {
      queueMode.mockReturnValue(queue);
      fetchHook.mockImplementation(async () => new Response(body, { status }));
      const fixture = setup([control('control', 'block')], undefined, queue);
      await fixture.step();
      expect(fixture.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe.each([false, true])('service response fields, queue=%s', (queue) => {
    it.each([
      { decision: 'allow', onError: 'block' },
      { decision: 'allow', onError: 'continue' },
      { decision: 'deny', onError: 'block' },
      { decision: 'deny', onError: 'continue' },
    ] as const)(
      'honors $decision and ignores extra fields with onError=$onError',
      async ({ decision, onError }) => {
        queueMode.mockReturnValue(queue);
        fetchHook.mockImplementation(
          async () =>
            new Response(
              JSON.stringify({
                decision,
                reason: '禁止执行该操作',
                requestId: 'service-trace',
                updatedInput: { path: 'replacement' },
                additionalContext: 'must not enter the conversation',
              }),
            ),
        );
        const fixture = setup([control('control', onError)], undefined, queue);
        const result = await fixture.step();
        if (decision === 'allow') {
          expect(fixture.execute).toHaveBeenCalledTimes(1);
          expect(fixture.execute.mock.calls[0][0].arguments).toBe('{"path":"a"}');
        } else {
          expect(fixture.execute).not.toHaveBeenCalled();
          expect(fixture.rows[0]).toMatchObject({
            content: '禁止执行该操作',
            pluginError: 'hook_denied',
          });
        }
        expect(JSON.stringify(result)).not.toContain('must not enter the conversation');
        expect(JSON.stringify(fixture.rows)).not.toContain('service-trace');
      },
    );
  });

  it.each([false, true])('does not await an ordinary HTTP observation, queue=%s', async (queue) => {
    queueMode.mockReturnValue(queue);
    let release!: (value: Response) => void;
    fetchHook.mockImplementation((url) =>
      url.endsWith('/observe')
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : Promise.resolve(response('allow')),
    );
    const fixture = setup(
      [
        control(),
        {
          id: 'observe',
          type: 'beforeToolCall',
          webhook: { url: 'https://hooks.example/observe', fallback: 'none' },
        },
      ],
      undefined,
      queue,
    );
    const pending = fixture.step();
    try {
      await vi.waitFor(() => expect(fixture.execute).toHaveBeenCalledTimes(1));
      expect((await pending).events).toContainEqual(
        expect.objectContaining({ type: 'tool_result' }),
      );
    } finally {
      release(response('allow'));
      await pending;
    }
  });

  it('lets an independent batch lane execute while another control is pending', async () => {
    let release!: (value: Response) => void;
    fetchHook.mockImplementation((_url, init) =>
      JSON.parse(init.body).toolCallId === 'slow'
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : Promise.resolve(response('allow')),
    );
    const fixture = setup([control()]);
    const pending = fixture.executors.call_tools_batch!(
      {
        type: 'call_tools_batch',
        payload: { parentMessageId: 'assistant', toolsCalling: [call('slow'), call('fast')] },
      },
      fixture.state,
    );
    try {
      await vi.waitFor(() =>
        expect(fixture.execute).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ id: 'fast' }),
          expect.anything(),
        ),
      );
    } finally {
      release(response('deny'));
      await pending;
    }
    expect(fixture.rows).toHaveLength(2);
    expect(fixture.execute).toHaveBeenCalledTimes(1);
  });

  it('settles a denied client sibling while forwarding only allowed client calls', async () => {
    fetchHook.mockImplementation(async (_url, init) =>
      response(JSON.parse(init.body).toolCallId === 'denied' ? 'deny' : 'allow'),
    );
    const fixture = setup([control()]);
    fixture.state.toolSourceMap = { fs: 'client' };
    const result = await fixture.executors.call_tools_batch!(
      {
        type: 'call_tools_batch',
        payload: {
          parentMessageId: 'assistant',
          toolsCalling: [
            call('denied'),
            call('allowed'),
            { ...call('server'), identifier: 'other' },
          ],
        },
      },
      fixture.state,
    );
    expect(fetchHook).toHaveBeenCalledTimes(3);
    expect(fixture.execute).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'server' }),
      expect.anything(),
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'tool_result',
        id: 'denied',
        result: expect.objectContaining({ success: false }),
      }),
    );
    expect(fixture.host.transports.stream.publishChunk).toHaveBeenCalledWith(
      expect.objectContaining({ chunkType: 'tools_calling', toolsCalling: [call('allowed')] }),
    );
  });

  it('checks controls when an approved tool reaches execution', async () => {
    const fixture = setup([control()]);
    fetchHook.mockImplementation(async () => response('deny'));
    await fixture.runtime.step(fixture.state, {
      phase: 'human_approved_tool',
      payload: { approvedToolCall: call(), parentMessageId: 'assistant' },
    });
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.rows[0].pluginState).toEqual({
      reason: 'Blocked by beforeToolCall hook.',
      type: 'blocked',
    });
  });
  it.each(['single', 'batch'] as const)(
    'does not forward a denied legacy client tool in %s mode',
    async (mode) => {
      fetchHook.mockImplementation(async () => response('deny'));
      const fixture = setup([control()]);
      fixture.state.toolSourceMap = { fs: 'client' };
      const clientCall = { ...call(), executor: 'client' as const };
      const result =
        mode === 'single'
          ? await fixture.executors.call_tool!(
              {
                type: 'call_tool',
                payload: { parentMessageId: 'assistant', toolCalling: clientCall },
              },
              fixture.state,
            )
          : await fixture.executors.call_tools_batch!(
              {
                type: 'call_tools_batch',
                payload: { parentMessageId: 'assistant', toolsCalling: [clientCall] },
              },
              fixture.state,
            );
      expect(fixture.execute).not.toHaveBeenCalled();
      expect(result.newState.status).toBe('running');
      expect(fixture.rows[0].pluginState).toEqual({
        reason: 'Blocked by beforeToolCall hook.',
        type: 'blocked',
      });
    },
  );

  it('hands an allowed legacy client call off only after its control returns', async () => {
    let release!: (value: Response) => void;
    fetchHook.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const fixture = setup([control()]);
    fixture.state.toolSourceMap = { fs: 'client' };
    const pending = fixture.step();
    await vi.waitFor(() => expect(fetchHook).toHaveBeenCalledTimes(1));
    expect(fixture.host.transports.stream.publishChunk).not.toHaveBeenCalled();
    release(response('allow'));
    await pending;
    expect(fixture.host.transports.stream.publishChunk).toHaveBeenCalledWith(
      expect.objectContaining({ chunkType: 'tools_calling', toolsCalling: [call()] }),
    );
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it.each(['single', 'batch'] as const)(
    'controls Gateway dispatch before client side effects in %s mode',
    async (mode) => {
      const fixture = setup([control()]);
      const clientCall = { ...call(), executor: 'client' as const };
      const invoke = () =>
        mode === 'single'
          ? fixture.executors.call_tool!(
              {
                type: 'call_tool',
                payload: { parentMessageId: 'assistant', toolCalling: clientCall },
              },
              fixture.state,
            )
          : fixture.executors.call_tools_batch!(
              {
                type: 'call_tools_batch',
                payload: { parentMessageId: 'assistant', toolsCalling: [clientCall] },
              },
              fixture.state,
            );
      fetchHook.mockImplementation(async () => response('deny'));
      await invoke();
      expect(dispatchClient).not.toHaveBeenCalled();
      expect(fixture.execute).not.toHaveBeenCalled();
      fetchHook.mockImplementation(async () => response('allow'));
      await invoke();
      expect(dispatchClient).toHaveBeenCalledExactlyOnceWith(clientCall, expect.anything());
      expect(fixture.execute).not.toHaveBeenCalled();
    },
  );

  it.each(['continue', 'block'] as const)(
    'applies onError=%s to a timed-out control without retry',
    async (policy) => {
      fetchHook.mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener(
              'abort',
              () => reject(new DOMException('timeout', 'AbortError')),
              { once: true },
            );
          }),
      );
      const hook = control('timeout', policy);
      hook.webhook!.timeout = 0.001;
      const fixture = setup([hook]);
      await fixture.step();
      expect(fetchHook).toHaveBeenCalledTimes(1);
      expect(fixture.execute).toHaveBeenCalledTimes(policy === 'block' ? 0 : 1);
    },
  );

  it('does not reuse a native call id from a previous assistant turn', async () => {
    const fixture = setup([control()]);
    await fixture.step();
    fixture.execute.mockClear();
    fetchHook.mockClear();
    fetchHook.mockImplementation(async () => response('deny'));
    await fixture.step();
    expect(fetchHook).toHaveBeenCalledTimes(1);
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it('reports critical observation failure without blocking a mock or HTTP sibling', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchHook
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(response('allow'));
    const fixture = setup([
      {
        id: 'mock',
        type: 'beforeToolCall',
        handler: async (event) => {
          (event as ToolCallHookEvent).mock({ content: 'mock', success: true });
        },
      },
      {
        id: 'critical',
        type: 'beforeToolCall',
        webhook: { url: 'https://hooks.example/critical', fallback: 'none' },
      },
      { id: 'sibling', type: 'beforeToolCall', webhook: { url: 'https://hooks.example/sibling' } },
    ]);
    const result = await fixture.step();
    await vi.waitFor(() => expect(fetchHook).toHaveBeenCalledTimes(2));
    expect(report).toHaveBeenCalledWith(
      '[HookDispatcher] Critical webhook delivery failed',
      expect.objectContaining({
        operationId: 'op',
        hookId: 'critical',
        hookType: 'beforeToolCall',
      }),
      expect.anything(),
    );
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.rows).toHaveLength(1);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'tool_result',
        result: expect.objectContaining({ content: 'mock' }),
      }),
    );
  });
  it('settles an already-approved row when the refreshed control denies it', async () => {
    const fixture = setup([control()]);
    fetchHook.mockImplementation(async () => response('deny'));
    const result = await fixture.runtime.step(fixture.state, {
      phase: 'human_approved_tool',
      payload: {
        approvedToolCall: call(),
        parentMessageId: 'pending-tool-row',
        skipCreateToolMessage: true,
      },
    });
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.rows).toHaveLength(0);
    expect(fixture.host.transports.messages.updateToolMessage).toHaveBeenCalledWith(
      'pending-tool-row',
      expect.objectContaining({
        pluginState: { reason: 'Blocked by beforeToolCall hook.', type: 'blocked' },
      }),
    );
    expect(fixture.host.transports.messages.updateToolIntervention).toHaveBeenCalledWith(
      'pending-tool-row',
      { rejectedReason: 'Blocked by beforeToolCall hook.', status: 'rejected' },
    );
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'tool_result' }));
  });
});
