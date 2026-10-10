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
import { BLOCKED_TOOL_RESULT_CONTENT } from '@/server/services/agentRuntime/hooks/toolResultControl';

import type { RuntimeExecutorContext } from '../context';
import { ServerToolTransport } from './ServerToolTransport';

const { archive, dispatchClient, fetchHook, getEmailsByIds, queueMode } = vi.hoisted(() => ({
  archive: vi.fn(async (result) => result),
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
  archiveRuntimeToolResult: archive,
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
const control = (id = 'control', onError: 'continue' | 'block' = 'continue') =>
  ({
    id,
    type: 'afterToolCall',
    webhook: { url: `https://hooks.example/${id}`, responseHandling: 'toolCall', onError },
  }) satisfies AgentHook;
const response = (decision: 'allow' | 'deny', reason?: string) =>
  new Response(JSON.stringify(decision === 'deny' ? { decision, reason } : { decision }));

function setup(hooks: AgentHook[], signal?: AbortSignal, restore = false) {
  const registered = new HookDispatcher();
  registered.register('op', hooks);
  const dispatcher = restore ? new HookDispatcher() : registered;
  const execute = vi.fn().mockResolvedValue({ content: 'executed', success: true });
  const rows: Record<string, unknown>[] = [];
  const loadState = vi.fn().mockResolvedValue(null);
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
    loadAgentState: loadState,
    messageModel: {
      findById: async (id: string) => rows.find((row) => row.id === id),
      findMessagePlugin: async (id: string) => {
        const row = rows.find((row) => row.id === id);
        return row
          ? {
              ...call(),
              toolCallId: row.tool_call_id,
              state: row.pluginState,
              intervention: row.pluginIntervention,
              ...(row.plugin as Record<string, unknown>),
            }
          : undefined;
      },
    },
  } as unknown as RuntimeExecutorContext);
  const host: AgentRuntimeHost = {
    operation: { operationId: 'op', stepIndex: 1, agentId: 'agent', abortSignal: signal },
    transports: {
      tools: transport,
      messages: {
        createToolMessage: vi.fn(async (row) => {
          const persisted = { ...row, id: `row-${rows.length + 1}` };
          rows.push(persisted);
          return persisted;
        }),
        query: vi.fn(async () => rows),
        updateToolMessage: vi.fn(async (id, update) => {
          const row = rows.find((row) => row.id === id);
          if (row) Object.assign(row, update);
        }),
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
  return { dispatcher, execute, executors, host, rows, runtime, state, step, loadState };
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchHook);
  archive.mockClear().mockImplementation(async (result) => result);
  getEmailsByIds.mockReset().mockResolvedValue([]);
  fetchHook.mockReset().mockImplementation(async () => response('allow'));
  queueMode.mockReturnValue(false);
  dispatchClient.mockReset().mockResolvedValue({ content: 'client result', success: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('afterToolCall control pipeline', () => {
  const secret = 'synthetic-sensitive-result';
  const denialReason = '禁止将敏感工具结果交给模型';
  const raw = () => ({
    content: secret.repeat(1000),
    error: { message: secret, type: 'tool_error' },
    executionTime: 42,
    state: {
      images: [{ url: `https://files.example/${secret}`, mediaType: 'image/png' }],
      nested: { text: secret },
      totalCost: 123456789,
    },
    success: true,
    workRegistration: {
      type: 'skill' as const,
      args: { path: 'a' },
      data: { text: secret },
      provider: 'synthetic',
      toolName: 'read',
    },
  });

  it.each([false, true])(
    'withholds the full result before persistence and LLM continuation, queue=%s',
    async (queue) => {
      queueMode.mockReturnValue(queue);
      fetchHook.mockImplementation(async () => response('deny', denialReason));
      const fixture = setup([control()], undefined, true);
      fixture.execute.mockResolvedValue(raw());
      const result = await fixture.step();

      expect(fixture.execute).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetchHook.mock.calls[0][1].body)).toMatchObject({
        args: { path: 'a' },
        hookType: 'afterToolCall',
        toolCallId: 'native-1',
        result: raw(),
      });
      expect(fixture.rows).toEqual([
        expect.objectContaining({
          content: denialReason,
          pluginError: 'hook_denied',
          pluginState: {
            type: 'blocked',
            phase: 'afterToolCall',
            reason: denialReason,
          },
          tool_call_id: 'native-1',
        }),
      ]);
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(result)).toContain(denialReason);
      expect(JSON.stringify(result)).not.toContain('123456789');
      expect(JSON.stringify(await fixture.host.transports.messages.query())).not.toContain(secret);
      expect(
        JSON.stringify(vi.mocked(fixture.host.transports.stream.publishEvent).mock.calls),
      ).not.toContain(secret);
      expect(
        JSON.stringify(vi.mocked(fixture.host.transports.stream.publishEvent).mock.calls),
      ).toContain(denialReason);
      expect(archive).not.toHaveBeenCalled();
      expect(result.newState.cost?.tools.total).toBe(5);
      expect(fixture.host.transports.stream.publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_end',
          data: expect.objectContaining({ attempts: 1, maxAttempts: 3, executionTime: 42 }),
        }),
      );
    },
  );

  it.each(['server', 'client'] as const)(
    'carries the allowed verdict separately from %s result state',
    async (executor) => {
      const fixture = setup([control()]);
      const result = {
        content: 'allowed output',
        success: true,
        state: { phase: 'afterToolCall', type: 'blocked' },
      };
      if (executor === 'client') {
        dispatchClient.mockResolvedValue(result);
      }
      fixture.execute.mockResolvedValue(result);
      await fixture.step([{ ...call(), ...(executor === 'client' && { executor: 'client' }) }]);
      expect(dispatchClient).toHaveBeenCalledTimes(executor === 'client' ? 1 : 0);
      expect(fixture.execute).toHaveBeenCalledTimes(executor === 'server' ? 1 : 0);
      expect(fixture.rows[0]).toMatchObject({
        content: 'allowed output',
      });
      expect(fixture.rows[0].pluginIntervention).toBeUndefined();
    },
  );

  it('inspects complete output before archiving an allowed result', async () => {
    const fixture = setup([control()]);
    fixture.execute.mockResolvedValue(raw());
    archive.mockImplementation(async (result) => ({ ...result, content: 'archived preview' }));
    const result = await fixture.step();
    expect(JSON.parse(fetchHook.mock.calls[0][1].body).result).toEqual(raw());
    expect(archive.mock.calls[0][0]).toEqual(raw());
    expect(fixture.rows[0].content).toBe('archived preview');
    expect(result.newState.messages[0].content).toBe('archived preview');
  });

  it('holds all model-facing output while the result decision is pending', async () => {
    let resolve!: (value: Response) => void;
    fetchHook.mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const fixture = setup([control()]);
    fixture.execute.mockResolvedValue(raw());
    const running = fixture.step();
    await vi.waitFor(() => expect(fetchHook).toHaveBeenCalledTimes(1));
    expect(fixture.rows).toHaveLength(0);
    expect(archive).not.toHaveBeenCalled();
    expect(fixture.host.transports.stream.publishEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tool_end' }),
    );
    resolve(response('deny'));
    await running;
    expect(fixture.rows[0].content).toBe(BLOCKED_TOOL_RESULT_CONTENT);
  });

  it.each(['server', 'client', 'mock'] as const)(
    'gates %s results without re-execution',
    async (source) => {
      const hooks: AgentHook[] = [control()];
      if (source === 'mock')
        hooks.push({
          id: 'mock',
          type: 'beforeToolCall',
          handler: async (event) => {
            (event as ToolCallHookEvent).mock(raw());
          },
        });
      const fixture = setup(hooks);
      fixture.execute.mockResolvedValue(raw());
      dispatchClient.mockResolvedValue(raw());
      fetchHook.mockImplementation(async () => response('deny'));
      const result = await fixture.step([
        { ...call(), ...(source === 'client' && { executor: 'client' }) },
      ]);
      expect(fetchHook).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetchHook.mock.calls[0][1].body)).toMatchObject({
        mocked: source === 'mock',
        result: raw(),
      });
      expect(fixture.execute).toHaveBeenCalledTimes(source === 'server' ? 1 : 0);
      expect(dispatchClient).toHaveBeenCalledTimes(source === 'client' ? 1 : 0);
      expect(JSON.stringify(result)).not.toContain(secret);
    },
  );

  it.each(['continue', 'block'] as const)(
    'uses onError=%s for invalid responses and never leaks response text',
    async (onError) => {
      const fixture = setup([control('control', onError)]);
      fetchHook.mockResolvedValue(new Response(JSON.stringify({ decision: secret })));
      const result = await fixture.step();
      expect(fixture.execute).toHaveBeenCalledTimes(1);
      expect(fixture.rows[0].content).toBe(
        onError === 'block' ? BLOCKED_TOOL_RESULT_CONTENT : 'executed',
      );
      expect(JSON.stringify(result)).not.toContain(secret);
    },
  );

  it.each(['continue', 'block'] as const)(
    'respects the hook timeout with onError=%s',
    async (onError) => {
      const fixture = setup([
        {
          ...control('control', onError),
          webhook: {
            url: 'https://hooks.example/timeout',
            responseHandling: 'toolCall',
            onError,
            timeout: 0.02,
          },
        },
      ]);
      fetchHook.mockImplementation(
        (_url, request) =>
          new Promise((_resolve, reject) => {
            request.signal.addEventListener('abort', () => reject(new Error(secret)), {
              once: true,
            });
          }),
      );
      const result = await fixture.step();
      expect(fixture.rows[0].content).toBe(
        onError === 'block' ? BLOCKED_TOOL_RESULT_CONTENT : 'executed',
      );
      expect(fixture.execute).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain(secret);
    },
  );

  it('applies ordered controls once, preserves a tool stop, and forwards the denying hook reason', async () => {
    const fixture = setup([
      control('allow'),
      { ...control('skip'), matcher: '^other/' },
      control('deny'),
      control('unreached'),
    ]);
    fixture.execute.mockResolvedValue({ ...raw(), stop: true });
    fetchHook.mockImplementation(async (url) =>
      response(String(url).endsWith('/deny') ? 'deny' : 'allow', denialReason),
    );
    const result = await fixture.step();
    expect(fetchHook.mock.calls.map(([url]) => url)).toEqual([
      'https://hooks.example/allow',
      'https://hooks.example/deny',
    ]);
    expect(result.newState.status).toBe('done');
    expect(fixture.rows[0]).toMatchObject({
      content: denialReason,
      pluginState: { reason: denialReason },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it.each(['', ' \n自定义 "reason"\n ', secret])(
    'preserves an explicitly provided denial reason verbatim: %j',
    async (reason) => {
      const fixture = setup([control()]);
      fixture.execute.mockResolvedValue(raw());
      fetchHook.mockImplementation(async () => response('deny', reason));

      await fixture.step();

      expect(fixture.rows[0]).toMatchObject({
        content: reason,
        pluginError: 'hook_denied',
        pluginState: { reason, type: 'blocked', phase: 'afterToolCall' },
      });
      expect(fixture.rows[0].pluginState).not.toHaveProperty('nested');
      expect(fixture.rows[0].pluginState).not.toHaveProperty('images');
      expect(archive).not.toHaveBeenCalled();
    },
  );

  it('evaluates a failed result after the last tool retry only', async () => {
    const fixture = setup([control()]);
    fixture.execute.mockResolvedValue({
      ...raw(),
      success: false,
      error: { kind: 'retry', message: secret },
    });
    fetchHook.mockImplementation(async () => response('deny'));
    const result = await fixture.step();
    expect(fixture.execute).toHaveBeenCalledTimes(3);
    expect(fetchHook).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchHook.mock.calls[0][1].body).result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.newState.cost?.tools.total).toBe(5);
  });

  it('keeps native IDs paired and mixed parallel siblings isolated', async () => {
    const fixture = setup([control()]);
    fixture.execute.mockImplementation(async (tool) => ({
      content: tool.id === 'constructor' ? secret : 'allowed sibling',
      success: true,
    }));
    fetchHook.mockImplementation(async (_url, request) =>
      response(JSON.parse(request.body).toolCallId === 'constructor' ? 'deny' : 'allow'),
    );
    const result = await fixture.step([call('constructor'), call('__proto__')]);
    expect(fixture.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool_call_id: 'constructor',
          content: BLOCKED_TOOL_RESULT_CONTENT,
        }),
        expect.objectContaining({ tool_call_id: '__proto__', content: 'allowed sibling' }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.newState.cost?.tools.total).toBe(10);
    expect(fetchHook).toHaveBeenCalledTimes(2);
  });

  it.each(['single', 'batch'] as const)(
    'replaces the durable result on a reused %s row',
    async (mode) => {
      const fixture = setup([control()]);
      fixture.rows.push({
        id: 'existing-row',
        role: 'tool',
        tool_call_id: 'native-1',
        content: secret,
        pluginState: { images: [{ url: secret }] },
      });
      fixture.execute.mockResolvedValue(raw());
      fetchHook.mockImplementation(async () => response('deny'));
      const result =
        mode === 'single'
          ? await fixture.executors.call_tool!(
              {
                type: 'call_tool',
                payload: {
                  parentMessageId: 'existing-row',
                  skipCreateToolMessage: true,
                  toolCalling: call(),
                },
              },
              fixture.state,
            )
          : await fixture.executors.call_tools_batch!(
              {
                type: 'call_tools_batch',
                payload: {
                  parentMessageId: 'assistant',
                  toolsCalling: [call()],
                  existingToolMessageIds: { 'native-1': 'existing-row' },
                },
              },
              fixture.state,
            );
      expect(fixture.rows).toHaveLength(1);
      expect(fixture.host.transports.messages.updateToolMessage).toHaveBeenCalledWith(
        'existing-row',
        expect.objectContaining({ replacePluginState: true, content: BLOCKED_TOOL_RESULT_CONTENT }),
      );
      expect(JSON.stringify(await fixture.host.transports.messages.query())).not.toContain(secret);
      expect(JSON.stringify(result)).not.toContain(secret);
    },
  );

  it.each(['single', 'batch'] as const)(
    'keeps the original result control after a %s approval creates a hook-less continuation',
    async (mode) => {
      const fixture = setup([]);
      fixture.rows.push({
        id: 'protected-row',
        parentId: 'original-assistant',
        role: 'tool',
        tool_call_id: 'native-1',
        content: '',
        plugin: call(),
        pluginIntervention: { operationId: 'original-op', status: 'approved' },
      });
      fixture.loadState.mockResolvedValue({
        ...fixture.state,
        operationId: 'original-op',
        host: { hooks: [control()] },
      });
      fixture.execute.mockResolvedValue(raw());
      fetchHook.mockImplementation(async () => response('deny'));
      const result =
        mode === 'single'
          ? await fixture.executors.call_tool!(
              {
                type: 'call_tool',
                payload: {
                  parentMessageId: 'protected-row',
                  skipCreateToolMessage: true,
                  toolCalling: call(),
                },
              },
              fixture.state,
            )
          : await fixture.executors.call_tools_batch!(
              {
                type: 'call_tools_batch',
                payload: {
                  parentMessageId: 'assistant',
                  toolsCalling: [call()],
                  existingToolMessageIds: { 'native-1': 'protected-row' },
                },
              },
              fixture.state,
            );
      expect(fixture.execute).toHaveBeenCalledTimes(1);
      expect(fetchHook).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetchHook.mock.calls[0][1].body)).toMatchObject({
        operationId: 'original-op',
        result: raw(),
      });
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(fixture.rows)).not.toContain(secret);
      expect(archive).not.toHaveBeenCalled();
    },
  );

  it.each(['single', 'batch'] as const)(
    'evaluates the environment once after the original caller in an allowed %s continuation',
    async (mode) => {
      vi.stubEnv('AGENT_HOOK_WEBHOOK_URL', 'https://hooks.example/environment');
      vi.stubEnv('AGENT_HOOK_WEBHOOK_TOKEN', 'synthetic-test-token');
      vi.stubEnv('AGENT_HOOK_WEBHOOK_EVENTS', 'afterToolCall');
      vi.stubEnv('AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING', 'toolCall');
      const fixture = setup([]);
      fixture.rows.push({
        id: 'protected-row',
        parentId: 'original-assistant',
        role: 'tool',
        tool_call_id: 'native-1',
        content: '',
        plugin: call(),
        pluginIntervention: { operationId: 'original-op', status: 'approved' },
      });
      fixture.loadState.mockResolvedValue({
        ...fixture.state,
        operationId: 'original-op',
        host: { hooks: [control()] },
      });
      fetchHook.mockImplementation(async () => response('allow'));
      if (mode === 'single') {
        await fixture.executors.call_tool!(
          {
            type: 'call_tool',
            payload: {
              parentMessageId: 'protected-row',
              skipCreateToolMessage: true,
              toolCalling: call(),
            },
          },
          fixture.state,
        );
      } else {
        await fixture.executors.call_tools_batch!(
          {
            type: 'call_tools_batch',
            payload: {
              parentMessageId: 'assistant',
              toolsCalling: [call()],
              existingToolMessageIds: { 'native-1': 'protected-row' },
            },
          },
          fixture.state,
        );
      }
      expect(fetchHook.mock.calls.map(([url]) => url)).toEqual([
        'https://hooks.example/control',
        'https://hooks.example/environment',
      ]);
      expect(fixture.host.transports.messages.updateToolMessage).toHaveBeenCalledWith(
        'protected-row',
        expect.objectContaining({ content: 'executed', pluginError: null }),
      );
      expect(fixture.rows[0].content).toBe('executed');
    },
  );

  it.each(['single', 'batch'] as const)(
    'publishes a %s result when the environment control has been removed',
    async (mode) => {
      const fixture = setup([]);
      fixture.rows.push({
        id: 'protected-row',
        parentId: 'original-assistant',
        role: 'tool',
        tool_call_id: 'native-1',
        content: '',
        plugin: call(),
        pluginIntervention: { operationId: 'original-op', status: 'approved' },
      });
      fixture.loadState.mockResolvedValue({ ...fixture.state, operationId: 'original-op' });
      if (mode === 'single') {
        await fixture.executors.call_tool!(
          {
            type: 'call_tool',
            payload: {
              parentMessageId: 'protected-row',
              skipCreateToolMessage: true,
              toolCalling: call(),
            },
          },
          fixture.state,
        );
      } else {
        await fixture.executors.call_tools_batch!(
          {
            type: 'call_tools_batch',
            payload: {
              parentMessageId: 'assistant',
              toolsCalling: [call()],
              existingToolMessageIds: { 'native-1': 'protected-row' },
            },
          },
          fixture.state,
        );
      }
      expect(fetchHook).not.toHaveBeenCalled();
      expect(archive).toHaveBeenCalled();
      expect(fixture.host.transports.messages.updateToolMessage).toHaveBeenCalledWith(
        'protected-row',
        expect.objectContaining({ content: 'executed', pluginError: null }),
      );
      expect(fixture.rows[0].content).toBe('executed');
    },
  );

  it('does not trust tool state to bypass a continuation’s additional control', async () => {
    const fixture = setup([control('new-policy')]);
    fixture.rows.push({
      id: 'protected-row',
      parentId: 'original-assistant',
      role: 'tool',
      tool_call_id: 'native-1',
      content: '',
      plugin: call(),
      pluginIntervention: { operationId: 'original-op', status: 'approved' },
    });
    fixture.loadState.mockResolvedValue({
      ...fixture.state,
      operationId: 'original-op',
      host: { hooks: [control('original-policy')] },
    });
    fixture.execute.mockResolvedValue({
      ...raw(),
      state: { phase: 'afterToolCall', type: 'blocked' },
    });
    fetchHook.mockImplementation(async (url) =>
      response(String(url).endsWith('/original-policy') ? 'allow' : 'deny'),
    );
    const result = await fixture.executors.call_tool!(
      {
        type: 'call_tool',
        payload: {
          parentMessageId: 'protected-row',
          skipCreateToolMessage: true,
          toolCalling: call(),
        },
      },
      fixture.state,
    );
    expect(fetchHook.mock.calls.map(([url]) => url)).toEqual([
      'https://hooks.example/original-policy',
      'https://hooks.example/new-policy',
    ]);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(archive).not.toHaveBeenCalled();
  });

  it('preserves ordered execution lanes while withholding only the denied result', async () => {
    const fixture = setup([control()]);
    fixture.state.toolManifestMap = { fs: { api: [{ name: 'write', ordered: true }] } };
    const order: string[] = [];
    fixture.execute.mockImplementation(async (tool) => {
      order.push(`run:${tool.id}`);
      return { content: tool.id, success: true };
    });
    fetchHook.mockImplementation(async (_url, init) => {
      const id = JSON.parse(init.body).toolCallId;
      order.push(`control:${id}`);
      return response(id === 'two' ? 'deny' : 'allow');
    });
    await fixture.executors.call_tools_batch!(
      {
        type: 'call_tools_batch',
        payload: {
          parentMessageId: 'assistant',
          toolsCalling: [call('one'), call('two'), call('three')],
        },
      },
      fixture.state,
    );
    expect(order).toEqual([
      'run:one',
      'control:one',
      'run:two',
      'control:two',
      'run:three',
      'control:three',
    ]);
    expect(fixture.rows.map((row) => row.content)).toEqual([
      'one',
      BLOCKED_TOOL_RESULT_CONTENT,
      'three',
    ]);
  });

  it.each(['beforeToolCall', 'afterToolCall', 'beforeToolCall,afterToolCall'])(
    'uses toolCall to control selected events %s at runtime',
    async (events) => {
      vi.stubEnv('AGENT_HOOK_WEBHOOK_URL', 'https://hooks.example/env');
      vi.stubEnv('AGENT_HOOK_WEBHOOK_TOKEN', 'synthetic-token');
      vi.stubEnv('AGENT_HOOK_WEBHOOK_EVENTS', events);
      vi.stubEnv('AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING', 'toolCall');
      vi.stubEnv('AGENT_HOOK_WEBHOOK_ON_ERROR', 'block');
      fetchHook.mockImplementation(async (_url, init) =>
        response(JSON.parse(init.body).hookType === 'afterToolCall' ? 'deny' : 'allow'),
      );
      const fixture = setup([]);
      await fixture.step();
      expect(fixture.execute).toHaveBeenCalledTimes(1);
      expect(fixture.rows[0].content).toBe(
        events.includes('afterToolCall') ? BLOCKED_TOOL_RESULT_CONTENT : 'executed',
      );
      expect(fetchHook.mock.calls.map(([, init]) => JSON.parse(init.body).hookType)).toEqual(
        events.split(','),
      );
    },
  );

  it.each(['', 'not JSON', '{"decision":', '{}'])(
    'executes and publishes normally when both hooks respond with notification body %j',
    async (body) => {
      vi.stubEnv('AGENT_HOOK_WEBHOOK_URL', 'https://hooks.example/env');
      vi.stubEnv('AGENT_HOOK_WEBHOOK_TOKEN', 'synthetic-token');
      vi.stubEnv('AGENT_HOOK_WEBHOOK_EVENTS', 'beforeToolCall,afterToolCall');
      vi.stubEnv('AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING', 'toolCall');
      vi.stubEnv('AGENT_HOOK_WEBHOOK_ON_ERROR', 'block');
      fetchHook.mockImplementation(async () => new Response(body));
      const fixture = setup([]);
      await fixture.step();
      expect(fixture.execute).toHaveBeenCalledTimes(1);
      expect(fixture.rows[0].content).toBe('executed');
      expect(fetchHook).toHaveBeenCalledTimes(2);
    },
  );

  it('does not review deferred placeholders as completed tool results', async () => {
    const fixture = setup([control()]);
    fixture.execute.mockResolvedValue({
      content: '',
      deferred: true,
      state: { toolMessageId: 'pending' },
      success: true,
    });
    const result = await fixture.step();
    expect(result.newState.status).toBe('waiting_for_async_tool');
    expect(fetchHook).not.toHaveBeenCalled();
  });

  it('cancels a pending decision without letting continue release the result', async () => {
    const abort = new AbortController();
    fetchHook.mockImplementation(
      (_url, request) =>
        new Promise((_resolve, reject) => {
          request.signal.addEventListener('abort', () => reject(new Error(secret)), { once: true });
        }),
    );
    const fixture = setup([control('control', 'continue')], abort.signal);
    fixture.execute.mockResolvedValue(raw());
    const running = fixture.step();
    await vi.waitFor(() => expect(fetchHook).toHaveBeenCalledTimes(1));
    abort.abort();
    const result = await running;
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(fixture.rows)).not.toContain(secret);
    expect(archive).not.toHaveBeenCalled();
  });
});
