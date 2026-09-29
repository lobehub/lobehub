import type { AgentState, ToolCallHookEvent } from '@lobechat/agent-runtime';
import {
  AgentRuntime,
  createRunContext,
  createToolPreparation,
  GeneralChatAgent,
} from '@lobechat/agent-runtime';
import { MessagesEngine } from '@lobechat/context-engine';
import { parse } from '@lobechat/conversation-flow';
import type { ChatToolPayload, UIChatMessage } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentHook } from '@/server/services/agentRuntime/hooks';

import { setupToolControlPipeline as setup } from './toolControlTestFixture';

const { fetchHook, getEmailsByIds, queueMode } = vi.hoisted(() => ({
  fetchHook: vi.fn(),
  getEmailsByIds: vi.fn(),
  queueMode: vi.fn(),
}));
vi.mock('@lobechat/ssrf-safe-fetch', () => ({ ssrfSafeFetch: fetchHook }));
vi.mock('@/database/models/user', () => ({ UserModel: { getEmailsByIds } }));
vi.mock('@/database/server', () => ({ getServerDB: async () => ({}) }));
vi.mock('@/server/services/queue/impls', () => ({ isQueueAgentRuntimeEnabled: queueMode }));
vi.mock('../redis', () => ({
  getAgentRuntimeRedisClient: () => ({ duplicate: () => ({ disconnect: vi.fn() }) }),
}));
vi.mock('../ToolResultWaiter', () => ({
  ToolResultWaiter: class {
    waitForResult = async () => ({ content: 'client executed', success: true });
  },
}));
vi.mock('@/libs/qstash', () => ({ OtelQstashClient: class {} }));
vi.mock('@/database/models/agent', () => ({
  AgentModel: class {
    getAgentVisibility = async () => 'private';
  },
}));
vi.mock('../executorHelpers', () => ({
  archiveRuntimeToolResult: async (result: unknown) => result,
  buildPostProcessUrl: () => undefined,
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
const response = (permissionDecision: 'allow' | 'deny') =>
  new Response(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'beforeToolCall', permissionDecision },
    }),
  );

beforeEach(() => {
  getEmailsByIds.mockReset().mockResolvedValue([]);
  fetchHook.mockReset().mockImplementation(async () => response('allow'));
  queueMode.mockReturnValue(false);
});
afterEach(() => vi.restoreAllMocks());

describe('beforeToolCall control pipeline', () => {
  it.each([false, true])(
    'uses the persisted share visitor for hook identity while executing as the owner, queue=%s',
    async (queue) => {
      queueMode.mockReturnValue(queue);
      getEmailsByIds.mockResolvedValue([{ id: 'visitor-1', email: 'visitor@example.test' }]);
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
          userId: 'visitor-1',
          userEmail: 'visitor@example.test',
          args: { userId: 'untrusted-input' },
        });
      }
      expect(fixture.execute).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ userId: 'user' }),
      );
      expect(fixture.state.origin?.userId).toBe('origin-owner');
      expect(getEmailsByIds).toHaveBeenCalledExactlyOnceWith({}, ['visitor-1']);
    },
  );

  it.each([false, true])(
    'denies before approval/mock/execution and persists attempts=0, queue=%s',
    async (queue) => {
      queueMode.mockReturnValue(queue);
      fetchHook.mockImplementation(async () => response('deny'));
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
      fixture.state.userInterventionConfig = { approvalMode: 'manual' };
      const result = await fixture.step();
      expect(result.newState.status).toBe('running');
      expect(fixture.execute).not.toHaveBeenCalled();
      expect(mock).not.toHaveBeenCalled();
      expect(fixture.rows).toEqual([
        expect.objectContaining({
          pluginState: expect.objectContaining({ reason: 'hook_denied', type: 'blocked' }),
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
            success: false,
            result: expect.objectContaining({ state: { reason: 'hook_denied', type: 'blocked' } }),
          }),
        );
    },
  );

  it('cancels during email lookup before HTTP, approval or tool execution', async () => {
    let resolveEmail!: (rows: { id: string; email: string }[]) => void;
    getEmailsByIds.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveEmail = resolve;
        }),
    );
    const abort = new AbortController();
    const fixture = setup([control()], abort.signal);
    fixture.state.userInterventionConfig = { approvalMode: 'manual' };
    const pending = fixture.step();
    await vi.waitFor(() => expect(getEmailsByIds).toHaveBeenCalledTimes(1));
    abort.abort();
    const result = await pending;
    resolveEmail([{ id: 'user', email: 'late@example.test' }]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(result.newState.toolPreparations?.['native-1'].status).toBe('cancelled');
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

  it.each(['llm_result', 'human_approved_tool'] as const)(
    'checks persisted cancellation before using cached preparation in %s',
    async (phase) => {
      const fixture = setup([control()], undefined, false, {
        checkToolCancellation: async () => true,
        serverPreparation: true,
      });
      fixture.state.userInterventionConfig = { approvalMode: 'manual' };
      fixture.state.toolPreparationParentId = 'assistant';
      fixture.state.toolPreparations = {
        'native-1': {
          originalArgs: { path: 'a' },
          effectiveArgs: { path: 'b' },
          approvalArgs: { path: 'b' },
          additionalContexts: [{ hookId: 'control', text: 'retained' }],
          status: 'ready',
        },
      };
      const result = await fixture.runtime.step(fixture.state, {
        phase,
        payload: {
          parentMessageId: 'assistant',
          toolsCalling: [call()],
          approvedToolCall: call(),
          hasToolsCalling: true,
        },
      });
      expect(fetchHook).not.toHaveBeenCalled();
      expect(fixture.execute).not.toHaveBeenCalled();
      expect(result.events.some((event) => event.type === 'human_approve_required')).toBe(false);
      expect(fixture.state.toolPreparations['native-1']).toMatchObject({
        originalArgs: { path: 'a' },
        effectiveArgs: { path: 'b' },
        approvalArgs: { path: 'b' },
      });
    },
  );

  it('allow still requires product approval', async () => {
    const fixture = setup([control()]);
    fixture.state.userInterventionConfig = { approvalMode: 'manual' };
    const result = await fixture.step();
    expect(result.newState.status).toBe('waiting_for_human');
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fetchHook).toHaveBeenCalledTimes(1);
  });

  it('allow does not bypass the product tool allow-list', async () => {
    const fixture = setup([control()]);
    const runtime = new AgentRuntime(
      new GeneralChatAgent({ operationId: 'op', allowedToolNames: ['other/tool'] }),
      {
        executors: fixture.executors,
        prepareTools: createToolPreparation(fixture.host),
      },
    );
    const result = await runtime.step(fixture.state, {
      phase: 'llm_result',
      payload: { hasToolsCalling: true, toolsCalling: [call()], parentMessageId: 'assistant' },
    });
    expect(fixture.execute).not.toHaveBeenCalled();
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
    expect(observer).not.toHaveBeenCalled();
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(JSON.parse(fetchHook.mock.calls[0][1].body)).toMatchObject({
      toolCallId: 'native-1',
      args: { path: 'a' },
      originalArgs: { path: 'a' },
    });
  });

  it('prepares the whole batch before any lane starts and only blocks its denied member', async () => {
    const order: string[] = [];
    fetchHook.mockImplementation(async (_url, init) => {
      const id = JSON.parse(init.body).toolCallId;
      order.push(id);
      return response(id === 'native-2' ? 'deny' : 'allow');
    });
    const fixture = setup([control()]);
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
    expect(order.slice(0, 3)).toEqual(['native-1', 'native-2', 'native-3']);
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

  it('reuses preparation across internal tool retries', async () => {
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
    const result = await pending;
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(result.events.some((event) => event.type === 'done')).toBe(true);
    release(response('allow'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it.each(['updatedInput', 'additionalContext'] as const)(
    'applies supported %s even with onError block',
    async (field) => {
      fetchHook.mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              hookSpecificOutput: {
                hookEventName: 'beforeToolCall',
                permissionDecision: 'allow',
                [field]: field === 'updatedInput' ? { path: 'b' } : 'context',
              },
            }),
          ),
      );
      const blocked = setup([control('block', 'block')]);
      await blocked.step();
      expect(blocked.execute).toHaveBeenCalledTimes(1);
      const continued = setup([control()]);
      await continued.step();
      expect(continued.execute).toHaveBeenCalledTimes(1);
      expect(continued.execute.mock.calls[0][0].arguments).toBe(
        field === 'updatedInput' ? '{"path":"b"}' : '{"path":"a"}',
      );
    },
  );

  it('rechecks controls on human_approved_tool without using the old allow', async () => {
    const fixture = setup([control()]);
    fixture.state.toolPreparationParentId = 'assistant';
    fixture.state.toolPreparations = {
      'native-1': { status: 'ready', originalArgs: { path: 'a' } },
    };
    fetchHook.mockImplementation(async () => response('deny'));
    await fixture.runtime.step(fixture.state, {
      phase: 'human_approved_tool',
      payload: { approvedToolCall: call(), parentMessageId: 'assistant' },
    });
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.rows[0].pluginState).toMatchObject({ reason: 'hook_denied', type: 'blocked' });
  });
  it.each(['single', 'batch'] as const)(
    'does not forward a denied client tool in %s mode',
    async (mode) => {
      fetchHook.mockImplementation(async () => response('deny'));
      const fixture = setup([control()]);
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
      expect(fixture.rows[0].pluginState).toMatchObject({ reason: 'hook_denied', type: 'blocked' });
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
    fixture.state.toolPreparationParentId = 'old-assistant';
    fixture.state.toolPreparations = { 'native-1': { originalArgs: {}, status: 'ready' } };
    fetchHook.mockImplementation(async () => response('deny'));
    await fixture.step();
    expect(fetchHook).toHaveBeenCalledTimes(1);
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it('retains critical webhook failure after a local mock', async () => {
    fetchHook.mockRejectedValue(new Error('network unavailable'));
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
    ]);
    const result = await fixture.step();
    expect(fetchHook).toHaveBeenCalledTimes(1);
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'error' }));
    expect(fixture.rows).toHaveLength(0);
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
        pluginState: expect.objectContaining({ reason: 'hook_denied', type: 'blocked' }),
      }),
    );
    expect(fixture.host.transports.messages.updateToolIntervention).toHaveBeenCalledWith(
      'pending-tool-row',
      { rejectedReason: 'hook_denied', status: 'rejected' },
    );
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'tool_result' }));
  });
  it('projects rewritten durable tool input into the cold approval card and next LLM context', async () => {
    fetchHook.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'beforeToolCall',
              permissionDecision: 'allow',
              updatedInput: { path: 'B.txt' },
            },
          }),
        ),
    );
    const fixture = setup([control()]);
    fixture.state.userInterventionConfig = { approvalMode: 'manual' };
    const original = call();
    const parked = await fixture.step([structuredClone(original)]);
    expect(parked.newState.status).toBe('waiting_for_human');
    expect(fixture.execute).not.toHaveBeenCalled();
    const history = [
      { id: 'user', role: 'user', content: 'write file', createdAt: 0, updatedAt: 0 },
      {
        id: 'assistant',
        parentId: 'user',
        role: 'assistant',
        content: '',
        tools: [original],
        createdAt: 1,
        updatedAt: 1,
      },
      ...fixture.rows.map((row) => ({ ...row, createdAt: 2, updatedAt: 2 })),
    ] as UIChatMessage[];
    const cold = parse(structuredClone(history)).flatList;
    const card = cold.find(({ role }) => role === 'assistantGroup')?.children?.[0].tools?.[0];
    expect(card).toMatchObject({
      id: original.id,
      arguments: '{"path":"B.txt"}',
      intervention: { status: 'pending' },
      result_msg_id: 'row-1',
    });
    expect(card?.result?.state).toMatchObject({ hookPreparation: { originalArgs: { path: 'a' } } });
    // Cold queue recovery uses flattened groups; an inline single tool may
    // retain raw history. Both must project the same effective request.
    for (const messages of [cold, structuredClone(history)]) {
      const prompt = await new MessagesEngine({
        messages,
        model: 'gpt-4',
        provider: 'openai',
        enableSystemDate: false,
        capabilities: { isCanUseFC: () => true },
      }).process();
      expect(prompt.messages.find(({ role }) => role === 'assistant')).toMatchObject({
        tool_calls: [{ id: original.id, function: { arguments: '{"path":"B.txt"}' } }],
      });
    }
    expect(history[1].tools?.[0].arguments).toBe('{"path":"a"}');
  });

  it('prepares from the detached original snapshot rather than rewritten arguments or mutable state', async () => {
    const fixture = setup([control()]);
    fixture.state.toolPreparations = {
      'native-1': { originalArgs: { nested: { path: 'original' } }, status: 'ready' },
    };
    const tool = { ...call(), arguments: '{"nested":{"path":"effective"}}' };
    const context = createRunContext({
      host: fixture.host,
      mode: 'single',
      parentMessageId: 'assistant',
      state: fixture.state,
      tool,
    });
    fixture.state.toolPreparations['native-1'].originalArgs.nested = { path: 'later-state' };
    const prepared = await fixture.host.transports.tools!.prepare!(tool, context);
    expect(context.originalArgs).toEqual({ nested: { path: 'original' } });
    expect(prepared.originalArgs).toEqual({ nested: { path: 'original' } });
    expect(prepared.originalArgs).not.toBe(context.originalArgs);
    expect(prepared.originalArgs.nested).not.toBe(context.originalArgs?.nested);
    expect(JSON.parse(fetchHook.mock.calls[0][1].body)).toMatchObject({
      args: { nested: { path: 'original' } },
      originalArgs: { nested: { path: 'original' } },
    });
  });

  it('replaces inputs serially before permission, card and execution, retaining the original snapshot', async () => {
    const inputs: Record<string, unknown>[] = [];
    fetchHook.mockImplementation(async (_url, init) => {
      const input = JSON.parse(init.body);
      inputs.push(input);
      return new Response(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'beforeToolCall',
            permissionDecision: 'allow',
            updatedInput: { path: input.args.path + '/changed' },
            additionalContext: 'tool guidance',
          },
        }),
      );
    });
    getEmailsByIds.mockResolvedValue([{ id: 'user', email: 'owner@example.test' }]);
    const fixture = setup([control('one'), control('two')]);
    fixture.state.userInterventionConfig = { approvalMode: 'manual' };
    const parked = await fixture.step();
    expect(parked.newState.status).toBe('waiting_for_human');
    expect(inputs.map((input) => input.args)).toEqual([{ path: 'a' }, { path: 'a/changed' }]);
    expect(inputs.map((input) => input.originalArgs)).toEqual([{ path: 'a' }, { path: 'a' }]);
    expect(inputs.map(({ userId, userEmail }) => ({ userId, userEmail }))).toEqual([
      { userId: 'user', userEmail: 'owner@example.test' },
      { userId: 'user', userEmail: 'owner@example.test' },
    ]);
    expect(getEmailsByIds).toHaveBeenCalledExactlyOnceWith({}, ['user']);
    expect(fixture.rows[0]).toMatchObject({
      plugin: { arguments: '{"path":"a/changed/changed"}' },
      pluginState: {
        hookPreparation: {
          originalArgs: { path: 'a' },
          additionalContexts: [
            { hookId: 'one', text: 'tool guidance' },
            { hookId: 'two', text: 'tool guidance' },
          ],
        },
      },
    });
    const approved = parked.newState.pendingToolsCalling![0];
    const resumed = await fixture.runtime.step(
      { ...parked.newState, status: 'running' },
      {
        phase: 'human_approved_tool',
        payload: {
          approvedToolCall: structuredClone(approved),
          parentMessageId: 'row-1',
          skipCreateToolMessage: true,
        },
      },
    );
    expect(inputs.slice(2).map((input) => input.args)).toEqual([
      { path: 'a' },
      { path: 'a/changed' },
    ]);
    expect(fixture.execute).toHaveBeenCalledTimes(1);
    expect(fixture.execute.mock.calls[0][0].arguments).toBe('{"path":"a/changed/changed"}');
    expect(resumed.newState.status).toBe('running');
    expect(fixture.rows).toHaveLength(1);
  });

  it.each(['single', 'batch'] as const)(
    'invalidates changed approval from durable rows after worker replacement: %s',
    async (mode) => {
      let suffix = '/old';
      const originalInputs: unknown[] = [];
      fetchHook.mockImplementation(async (_url, init) => {
        const input = JSON.parse(init.body);
        originalInputs.push(input.args);
        return new Response(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'beforeToolCall',
              permissionDecision: 'allow',
              updatedInput: { path: input.args.path + suffix },
            },
          }),
        );
      });
      const fixture = setup([control()]);
      fixture.state.userInterventionConfig = { approvalMode: 'manual' };
      const parked = await fixture.step();
      const approved = structuredClone(parked.newState.pendingToolsCalling![0]);
      const coldCard = () => {
        const history = [
          { id: 'user', role: 'user', content: 'write', createdAt: 0, updatedAt: 0 },
          {
            id: 'assistant',
            parentId: 'user',
            role: 'assistant',
            content: '',
            tools: [call()],
            createdAt: 1,
            updatedAt: 1,
          },
          ...structuredClone(fixture.rows).map((row) => ({ ...row, createdAt: 2, updatedAt: 2 })),
        ] as UIChatMessage[];
        return parse(history).flatList.find(({ role }) => role === 'assistantGroup')?.children?.[0]
          .tools?.[0];
      };
      expect(coldCard()).toMatchObject({
        id: 'native-1',
        arguments: '{"path":"a/old"}',
        result_msg_id: 'row-1',
        intervention: { status: 'pending' },
      });
      fixture.rows[0].pluginIntervention = {
        ...(fixture.rows[0].pluginIntervention as object),
        status: 'approved',
        approvedArguments: approved.arguments,
      };
      suffix = '/new';
      // New continuation has no per-operation preparation cache.
      const state = {
        ...fixture.state,
        toolPreparations: undefined,
        toolPreparationParentId: undefined,
      };
      const result = await fixture.runtime.step(state, {
        phase: 'human_approved_tool',
        payload:
          mode === 'single'
            ? { approvedToolCall: approved, parentMessageId: 'row-1', skipCreateToolMessage: true }
            : {
                approvedToolCalls: [approved],
                parentMessageId: 'assistant',
                toolMessageIds: { 'native-1': 'row-1' },
              },
      });
      expect(fixture.execute).not.toHaveBeenCalled();
      expect(result.newState.status).toBe('waiting_for_human');
      expect(originalInputs).toEqual([{ path: 'a' }, { path: 'a' }]);
      expect(fixture.rows).toHaveLength(1);
      expect(fixture.rows[0]).toMatchObject({
        plugin: { arguments: '{"path":"a/new"}' },
        pluginIntervention: { status: 'pending' },
      });
      expect(result.newState.pendingToolsCalling?.[0].arguments).toBe('{"path":"a/new"}');
      expect(coldCard()).toMatchObject({
        id: 'native-1',
        arguments: '{"path":"a/new"}',
        result_msg_id: 'row-1',
        intervention: { status: 'pending' },
        result: {
          state: {
            hookPreparation: {
              originalArgs: { path: 'a' },
              effectiveArgs: { path: 'a/new' },
              approvalArgs: { path: 'a/old' },
            },
          },
        },
      });
      expect(approved.arguments).toBe('{"path":"a/old"}');
    },
  );
  it('uses rewritten resource keys before batch serializeBy planning', async () => {
    fetchHook.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'beforeToolCall',
              permissionDecision: 'allow',
              updatedInput: { path: 'shared' },
            },
          }),
        ),
    );
    const fixture = setup([control()]);
    fixture.state.toolManifestMap = {
      fs: { identifier: 'fs', api: [{ name: 'write', serializeBy: 'path' }] },
    } as AgentState['toolManifestMap'];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fixture.execute.mockImplementationOnce(async () => {
      await gate;
      return { content: 'one', success: true };
    });
    const pending = fixture.step([
      call('one'),
      { ...call('two'), arguments: '{"path":"different"}' },
    ]);
    await vi.waitFor(() => expect(fixture.execute).toHaveBeenCalledTimes(1));
    expect(fetchHook).toHaveBeenCalledTimes(2);
    expect(fixture.execute.mock.calls[0][0].arguments).toBe('{"path":"shared"}');
    release();
    await pending;
    expect(fixture.execute).toHaveBeenCalledTimes(2);
    expect(fixture.execute.mock.calls[1][0].arguments).toBe('{"path":"shared"}');
  });

  it('feeds rewritten args to real global permission audits and before/after events', async () => {
    fetchHook.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'beforeToolCall',
              permissionDecision: 'allow',
              updatedInput: { path: 'sensitive' },
            },
          }),
        ),
    );
    const fixture = setup([control()]);
    const audit = vi.fn(async (args) => args.path === 'sensitive');
    const runtime = new AgentRuntime(
      new GeneralChatAgent({
        operationId: 'op',
        globalInterventionAudits: [{ type: 'path', resolver: audit, policy: 'always' }],
      }),
      {
        executors: fixture.executors,
        prepareTools: createToolPreparation(fixture.host),
      },
    );
    const result = await runtime.step(fixture.state, {
      phase: 'llm_result',
      payload: { hasToolsCalling: true, parentMessageId: 'assistant', toolsCalling: [call()] },
    });
    expect(audit.mock.calls[0][0]).toEqual({ path: 'sensitive' });
    expect(result.newState.status).toBe('waiting_for_human');
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.rows[0]).toMatchObject({ plugin: { arguments: '{"path":"sensitive"}' } });
  });

  it('keeps unchanged approved siblings executing while changed members repark', async () => {
    let changed = false;
    fetchHook.mockImplementation(async (_url, init) => {
      const input = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'beforeToolCall',
            permissionDecision: 'allow',
            updatedInput: { path: changed && input.toolCallId === 'two' ? 'new' : 'old' },
          },
        }),
      );
    });
    const fixture = setup([control()]);
    fixture.state.userInterventionConfig = { approvalMode: 'manual' };
    const parked = await fixture.step([call('one'), call('two')]);
    changed = true;
    const result = await fixture.runtime.step(
      { ...parked.newState, status: 'running' },
      {
        phase: 'human_approved_tool',
        payload: {
          approvedToolCalls: structuredClone(parked.newState.pendingToolsCalling),
          parentMessageId: 'assistant',
          toolMessageIds: { one: 'row-1', two: 'row-2' },
        },
      },
    );
    expect(fixture.execute).toHaveBeenCalledTimes(1);
    expect(fixture.execute.mock.calls[0][0].id).toBe('one');
    expect(result.newState.status).toBe('waiting_for_human');
    expect(result.newState.pendingToolsCalling?.map(({ id }) => id)).toEqual(['two']);
    expect(fixture.rows).toHaveLength(2);
  });
  it('does not turn a persisted rewrite into approval when the worker dies before repark', async () => {
    const fixture = setup([control()]);
    fixture.state.userInterventionConfig = { approvalMode: 'manual' };
    await fixture.step();
    fixture.rows[0].pluginIntervention = { status: 'approved', approvedArguments: '{"path":"a"}' };
    const input = {
      approvedToolCall: { ...call(), arguments: '{"path":"rewritten"}' },
      parentMessageId: 'row-1',
      skipCreateToolMessage: true,
    };
    // Simulate the atomic preparation write surviving a process exit before
    // request_human_approve can publish the new card.
    fixture.rows[0].plugin = { ...call(), arguments: '{"path":"rewritten"}' };
    fixture.rows[0].pluginState = {
      hookPreparation: {
        originalArgs: { path: 'a' },
        effectiveArgs: { path: 'rewritten' },
        approvalArgs: { path: 'a' },
        status: 'ready',
      },
    };
    fetchHook.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'beforeToolCall',
              permissionDecision: 'allow',
              updatedInput: { path: 'rewritten' },
            },
          }),
        ),
    );
    const result = await fixture.runtime.step(fixture.state, {
      phase: 'human_approved_tool',
      payload: input,
    });
    expect(result.newState.status).toBe('waiting_for_human');
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.rows).toHaveLength(1);
  });

  it('reparks an invalidated partial approval together with all unresolved siblings', async () => {
    const fixture = setup([control()]);
    fixture.state.userInterventionConfig = { approvalMode: 'manual' };
    const parked = await fixture.step([call('one'), call('two')]);
    fixture.rows[0].pluginIntervention = {
      ...(fixture.rows[0].pluginIntervention as object),
      status: 'approved',
      approvedArguments: '{"path":"a"}',
    };
    fetchHook.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'beforeToolCall',
              permissionDecision: 'allow',
              updatedInput: { path: 'new' },
            },
          }),
        ),
    );
    fixture.host.operation.stepIndex = 2;
    const result = await fixture.runtime.step(
      { ...parked.newState, status: 'running' },
      {
        phase: 'human_approved_tool',
        payload: {
          approvedToolCall: call('one'),
          parentMessageId: 'row-1',
          skipCreateToolMessage: true,
        },
      },
    );
    expect(result.newState.status).toBe('waiting_for_human');
    expect(result.newState.pendingToolsCalling?.map(({ id }) => id)).toEqual(['one', 'two']);
    expect(result.newState.pendingApprovalBatch?.supersedes).toMatchObject({
      reapprovedToolCallIds: ['one'],
      toolCallIds: ['one', 'two'],
    });
    expect(fixture.rows).toHaveLength(2);
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it('never rewrites the caller context retained by a local step retry', async () => {
    const fixture = setup([control()]);
    fetchHook.mockImplementation(async (_url, init) => {
      const request = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'beforeToolCall',
            permissionDecision: 'allow',
            updatedInput: { path: request.args.path + '/suffix' },
          },
        }),
      );
    });
    const context = {
      phase: 'llm_result' as const,
      payload: { hasToolsCalling: true, parentMessageId: 'assistant', toolsCalling: [call()] },
    };
    await fixture.runtime.step(fixture.state, context);
    await fixture.runtime.step(fixture.state, context);
    expect(context.payload.toolsCalling[0].arguments).toBe('{"path":"a"}');
    expect(fixture.execute.mock.calls.map(([tool]) => tool.arguments)).toEqual([
      '{"path":"a/suffix"}',
      '{"path":"a/suffix"}',
    ]);
  });
  it.each(['server', 'client', 'error'] as const)(
    'uses one rewritten input at the real transport and notification boundary: %s',
    async (target) => {
      fetchHook.mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              hookSpecificOutput: {
                hookEventName: 'beforeToolCall',
                permissionDecision: 'allow',
                updatedInput: { path: 'effective' },
              },
            }),
          ),
      );
      const before = vi.fn();
      const after = vi.fn();
      const error = vi.fn();
      const fixture = setup([
        control(),
        { id: 'observe', type: 'beforeToolCall', handler: before },
        { id: 'after', type: 'afterToolCall', handler: after },
        { id: 'error', type: 'onToolCallError', handler: error },
      ]);
      const send = vi.fn();
      fixture.streamManager.sendToolExecute = send;
      if (target === 'error') fixture.execute.mockRejectedValue(new Error('execution failed'));
      if (target === 'server')
        fixture.execute.mockResolvedValueOnce({
          content: 'retry',
          success: false,
          error: { kind: 'retry' },
        });
      await fixture.step([{ ...call(), executor: target === 'client' ? 'client' : 'server' }]);
      const expected = {
        args: { path: 'effective' },
        toolCallId: 'native-1',
      };
      expect(before).toHaveBeenCalledWith(expect.objectContaining(expected));
      await vi.waitFor(() =>
        expect(target === 'error' ? error : after).toHaveBeenCalledWith(
          expect.objectContaining(expected),
        ),
      );
      expect(before.mock.calls[0][0]).not.toHaveProperty('originalArgs');
      expect((target === 'error' ? error : after).mock.calls[0][0]).not.toHaveProperty(
        'originalArgs',
      );
      expect(fetchHook).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetchHook.mock.calls[0][1].body).originalArgs).toEqual({ path: 'a' });
      if (target !== 'error')
        expect(fixture.rows[0]).toMatchObject({
          plugin: { arguments: '{"path":"effective"}' },
          pluginState: {
            hookPreparation: { originalArgs: { path: 'a' }, effectiveArgs: { path: 'effective' } },
          },
        });
      if (target === 'client') {
        expect(send).toHaveBeenCalledWith(
          'op',
          expect.objectContaining({ arguments: '{"path":"effective"}', toolCallId: 'native-1' }),
        );
        expect(fixture.execute).not.toHaveBeenCalled();
      } else {
        expect(fixture.execute).toHaveBeenCalledTimes(target === 'server' ? 2 : 1);
        for (const [payload] of fixture.execute.mock.calls)
          expect(payload.arguments).toBe('{"path":"effective"}');
      }
    },
  );
  it.each(['client', 'deferred'] as const)(
    'persists preparation before an async %s handoff',
    async (target) => {
      fetchHook.mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              hookSpecificOutput: {
                hookEventName: 'beforeToolCall',
                permissionDecision: 'allow',
                updatedInput: { path: 'effective' },
                additionalContext: 'remember after callback',
              },
            }),
          ),
      );
      const fixture = setup([control()]);
      if (target === 'client') fixture.state.toolSourceMap = { fs: 'client' };
      else
        fixture.execute.mockImplementation(async () => {
          fixture.rows.push({
            id: 'deferred-row',
            role: 'tool',
            parentId: 'assistant',
            tool_call_id: 'native-1',
            plugin: call(),
          });
          return {
            content: '',
            success: true,
            deferred: true,
            state: { toolMessageId: 'deferred-row' },
          };
        });
      const result = await fixture.step();
      expect(result.newState.status).toBe('waiting_for_async_tool');
      expect(fixture.rows).toHaveLength(1);
      expect(fixture.rows[0]).toMatchObject({
        plugin: { arguments: '{"path":"effective"}' },
        pluginState: {
          hookPreparation: {
            originalArgs: { path: 'a' },
            additionalContexts: [{ hookId: 'control', text: 'remember after callback' }],
          },
        },
      });
      expect(fixture.host.transports.stream.publishChunk).toHaveBeenCalledWith(
        expect.objectContaining({
          toolMessageIds: { 'native-1': target === 'client' ? 'row-1' : 'deferred-row' },
        }),
      );
    },
  );
});
