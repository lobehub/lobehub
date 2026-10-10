import type { AgentState } from '@lobechat/agent-runtime';
import type { MessagePluginItem } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { controlDeferredToolResult } from '../deferredToolResultControl';
import { HookDispatcher } from '../HookDispatcher';
import { BLOCKED_TOOL_RESULT_CONTENT } from '../toolResultControl';

const { fetchHook, queueMode } = vi.hoisted(() => ({ fetchHook: vi.fn(), queueMode: vi.fn() }));
vi.mock('@/database/models/user', () => ({ UserModel: { getEmailsByIds: async () => [] } }));
vi.mock('@/database/server', () => ({ getServerDB: async () => ({}) }));
vi.mock('@/server/services/queue/impls', () => ({ isQueueAgentRuntimeEnabled: queueMode }));
vi.mock('@/libs/qstash', () => ({ OtelQstashClient: class {} }));

const secret = 'synthetic-private-child-result';
const denialReason = '子任务结果被策略拒绝';
const original = { content: secret, success: true, state: { full: secret, totalCost: 0.25 } };
const plugin: MessagePluginItem = {
  id: 'tool-row',
  toolCallId: 'native-call',
  identifier: 'lobe-agent',
  apiName: 'callSubAgent',
  arguments: '{"instruction":"original request"}',
  type: 'builtin',
  userId: 'owner',
};
const hook = {
  id: 'after',
  type: 'afterToolCall' as const,
  webhook: {
    url: 'https://hooks.example/after',
    responseHandling: 'toolCall' as const,
    onError: 'block' as const,
  },
};
const state = {
  operationId: 'parent',
  stepCount: 2,
  origin: { agentId: 'agent', topicId: 'topic' },
  host: { hooks: [hook] },
} as AgentState;
function setup() {
  const deps = {
    dispatcher: new HookDispatcher(),
    loadState: vi.fn().mockResolvedValue(state),
    loadDurableHooks: vi.fn().mockResolvedValue([]),
    messageModel: {
      findById: vi.fn().mockResolvedValue({
        id: 'tool-row',
        parentId: 'assistant',
        role: 'tool',
        agentId: 'agent',
        topicId: 'topic',
      }),
      findMessagePlugin: vi.fn().mockResolvedValue(plugin),
    },
    userId: 'owner',
  };
  const input = {
    operationId: 'parent',
    toolMessageId: 'tool-row',
    result: original,
    preserveUsage: true,
  };
  return { deps, input };
}
beforeEach(() => {
  vi.stubGlobal('fetch', fetchHook);
  fetchHook
    .mockReset()
    .mockImplementation(
      async () => new Response(JSON.stringify({ decision: 'deny', reason: denialReason })),
    );
  queueMode.mockReturnValue(false);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('out-of-band tool result control', () => {
  it.each([false, true])(
    'evaluates current environment once while retaining same-id caller policies, queue=%s',
    async (queue) => {
      queueMode.mockReturnValue(queue);
      const { deps, input } = setup();
      vi.stubEnv('AGENT_HOOK_WEBHOOK_URL', 'https://hooks.example/environment');
      vi.stubEnv('AGENT_HOOK_WEBHOOK_TOKEN', 'synthetic-test-token');
      vi.stubEnv('AGENT_HOOK_WEBHOOK_EVENTS', 'afterToolCall');
      vi.stubEnv('AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING', 'toolCall');
      deps.messageModel.findMessagePlugin.mockResolvedValue({
        ...plugin,
        intervention: { operationId: 'original', status: 'approved' },
      });
      deps.loadState.mockResolvedValue(null);
      deps.loadDurableHooks.mockImplementation(async (id) => [
        { ...hook, webhook: { ...hook.webhook, url: `https://hooks.example/${id}` } },
      ]);
      fetchHook.mockImplementation(async () => new Response(JSON.stringify({ decision: 'allow' })));

      expect((await controlDeferredToolResult(deps, input)).result).toBe(original);
      expect(
        fetchHook.mock.calls.map(([url, init]) => [url, JSON.parse(init.body).operationId]),
      ).toEqual([
        ['https://hooks.example/original', 'original'],
        ['https://hooks.example/parent', 'parent'],
        ['https://hooks.example/environment', 'parent'],
      ]);

      fetchHook
        .mockClear()
        .mockImplementation(
          async (url) =>
            new Response(
              JSON.stringify({ decision: String(url).endsWith('/parent') ? 'deny' : 'allow' }),
            ),
        );
      expect((await controlDeferredToolResult(deps, input)).blocked).toBe(true);
      expect(fetchHook.mock.calls.map(([url]) => url)).toEqual([
        'https://hooks.example/original',
        'https://hooks.example/parent',
      ]);
    },
  );
  it.each([false, true])(
    'recovers the original call and full result on a cold worker, queue=%s',
    async (queue) => {
      queueMode.mockReturnValue(queue);
      const { deps, input } = setup();
      const { result } = await controlDeferredToolResult(deps, input);
      expect(JSON.parse(fetchHook.mock.calls[0][1].body)).toMatchObject({
        operationId: 'parent',
        toolCallId: 'native-call',
        toolMessageId: 'tool-row',
        assistantMessageId: 'assistant',
        args: { instruction: 'original request' },
        userId: 'owner',
        result: original,
      });
      expect(result).toMatchObject({
        content: denialReason,
        error: 'hook_denied',
        success: false,
        state: { totalCost: 0.25, reason: denialReason, type: 'blocked', phase: 'afterToolCall' },
      });
      expect(JSON.stringify(result)).not.toContain(secret);
    },
  );
  it('leaves no-control completions unchanged without requiring call metadata', async () => {
    const { deps, input } = setup();
    deps.loadState.mockResolvedValue(null);
    deps.messageModel.findMessagePlugin.mockResolvedValue(undefined);
    expect((await controlDeferredToolResult(deps, input)).result).toBe(original);
    expect(fetchHook).not.toHaveBeenCalled();
  });
  it('restores caller controls and call identity after Redis expiry', async () => {
    const { deps, input } = setup();
    deps.loadState.mockResolvedValue(null);
    deps.loadDurableHooks.mockResolvedValue([hook]);
    deps.messageModel.findById.mockResolvedValue({
      id: 'tool-row',
      parentId: 'assistant',
    });
    const { result } = await controlDeferredToolResult(deps, input);
    expect(result.content).toBe(denialReason);
    expect(JSON.parse(fetchHook.mock.calls[0][1].body)).toMatchObject({
      operationId: 'parent',
      toolCallId: 'native-call',
      result: original,
    });
  });

  it('propagates a caller hook store failure rather than treating it as no hooks', async () => {
    const { deps, input } = setup();
    deps.loadState.mockResolvedValue(null);
    deps.loadDurableHooks.mockRejectedValue(new Error('database unavailable'));
    await expect(controlDeferredToolResult(deps, input)).rejects.toThrow('database unavailable');
    expect(fetchHook).not.toHaveBeenCalled();
  });
  it('retains pre-feature no-hook behavior for legacy rows', async () => {
    const { deps, input } = setup();
    deps.loadState.mockResolvedValue(null);
    deps.loadDurableHooks.mockResolvedValue(undefined);
    expect((await controlDeferredToolResult(deps, input)).result).toBe(original);
    expect(fetchHook).not.toHaveBeenCalled();
  });

  it('preserves legacy results when configured hooks only match another tool', async () => {
    const { deps, input } = setup();
    deps.loadState.mockResolvedValue(null);
    deps.loadDurableHooks.mockResolvedValue([{ ...hook, matcher: '^other/tool$' }]);
    expect((await controlDeferredToolResult(deps, input)).result).toBe(original);
    expect(fetchHook).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'evaluates deferred results using the current environment instead of its old policy, queue=%s',
    async (queue) => {
      queueMode.mockReturnValue(queue);
      const { deps, input } = setup();
      vi.stubEnv('AGENT_HOOK_WEBHOOK_URL', 'https://hooks.example/after');
      vi.stubEnv('AGENT_HOOK_WEBHOOK_TOKEN', 'synthetic-token');
      vi.stubEnv('AGENT_HOOK_WEBHOOK_EVENTS', 'afterToolCall');
      vi.stubEnv('AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING', 'toolCall');
      expect(deps.dispatcher.hasAfterToolCallControl('parent', [])).toBe(true);
      deps.loadState.mockResolvedValue(null);
      deps.loadDurableHooks.mockResolvedValue([]);
      deps.messageModel.findById.mockResolvedValue({
        id: 'tool-row',
        parentId: 'assistant',
      });

      vi.stubEnv('AGENT_HOOK_WEBHOOK_URL', undefined);
      expect(await controlDeferredToolResult(deps, input)).toMatchObject({
        blocked: false,
        result: original,
      });
      expect(fetchHook).not.toHaveBeenCalled();

      // A newly configured environment policy is evaluated at completion time.
      vi.stubEnv('AGENT_HOOK_WEBHOOK_URL', 'https://hooks.example/after');
      fetchHook.mockResolvedValue(new Response(JSON.stringify({ decision: 'allow' })));
      expect(await controlDeferredToolResult(deps, input)).toMatchObject({
        result: original,
      });
      expect(fetchHook).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { label: 'live snapshot without controls', snapshot: true, hooks: [] },
    {
      label: 'only notification hooks',
      snapshot: false,
      hooks: [
        { ...hook, webhook: { ...hook.webhook, responseHandling: 'ignore', onError: 'continue' } },
      ],
    },
    {
      label: 'controls for another tool',
      snapshot: false,
      hooks: [{ ...hook, matcher: '^other/tool$' }],
    },
    {
      label: 'removed environment hook template',
      snapshot: false,
      hooks: [{ ...hook, id: 'server-env-webhook:afterToolCall' }],
    },
  ])('allows results when there is no matching control: $label', async ({ snapshot, hooks }) => {
    const { deps, input } = setup();
    deps.loadState.mockResolvedValue(snapshot ? { ...state, host: { hooks } } : null);
    deps.loadDurableHooks.mockResolvedValue(hooks);
    deps.messageModel.findById.mockResolvedValue({
      id: 'tool-row',
      parentId: 'assistant',
    });
    expect(await controlDeferredToolResult(deps, input)).toMatchObject({
      blocked: false,
      result: original,
    });
    expect(fetchHook).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'still enforces persisted caller hooks after environment removal, queue=%s',
    async (queue) => {
      queueMode.mockReturnValue(queue);
      const { deps, input } = setup();
      deps.loadState.mockResolvedValue(null);
      deps.loadDurableHooks.mockResolvedValue([hook]);
      vi.stubEnv('AGENT_HOOK_WEBHOOK_URL', undefined);
      deps.messageModel.findById.mockResolvedValue({
        id: 'tool-row',
        parentId: 'assistant',
      });
      expect(await controlDeferredToolResult(deps, input)).toMatchObject({
        blocked: true,
      });
      expect(fetchHook).toHaveBeenCalledTimes(1);
      expect(fetchHook.mock.calls[0][0]).toBe(hook.webhook.url);
    },
  );

  it('does not treat tool-owned blocked state as a prior hook denial', async () => {
    const { deps, input } = setup();
    deps.messageModel.findMessagePlugin.mockResolvedValue({
      ...plugin,
      state: { type: 'blocked', phase: 'afterToolCall' },
    });
    fetchHook.mockResolvedValue(new Response(JSON.stringify({ decision: 'allow' })));
    const controlled = await controlDeferredToolResult(deps, input);
    expect(controlled).toMatchObject({
      blocked: false,
      result: original,
    });
    expect(fetchHook).toHaveBeenCalledTimes(1);
  });

  it('keeps original caller hooks on an approved deferred call and applies continuation hooks too', async () => {
    const { deps, input } = setup();
    deps.messageModel.findMessagePlugin.mockResolvedValue({
      ...plugin,
      intervention: { operationId: 'original', status: 'approved' },
    });
    deps.loadState.mockImplementation(async (id) =>
      id === 'original'
        ? null
        : {
            ...state,
            host: {
              hooks: [
                {
                  ...hook,
                  id: 'new',
                  webhook: { ...hook.webhook, url: 'https://hooks.example/new' },
                },
              ],
            },
          },
    );
    deps.loadDurableHooks.mockResolvedValue([hook]);
    fetchHook.mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify({ decision: String(url).endsWith('/after') ? 'allow' : 'deny' }),
        ),
    );
    expect((await controlDeferredToolResult(deps, input)).result.content).toBe(
      BLOCKED_TOOL_RESULT_CONTENT,
    );
    expect(fetchHook.mock.calls.map(([url]) => url)).toEqual([
      'https://hooks.example/after',
      'https://hooks.example/new',
    ]);
  });

  it('uses the parent group call arguments for an isolated member result', async () => {
    const { deps, input } = setup();
    deps.messageModel.findMessagePlugin.mockImplementation(async (id) =>
      id === 'group-tool'
        ? { ...plugin, id, apiName: 'executeAgentTasks', state: { onComplete: 'finish' } }
        : undefined,
    );
    const { result } = await controlDeferredToolResult(deps, {
      ...input,
      contextToolMessageId: 'group-tool',
    });
    expect(JSON.parse(fetchHook.mock.calls[0][1].body)).toMatchObject({
      apiName: 'executeAgentTasks',
      toolMessageId: 'tool-row',
      result: original,
    });
    expect(result.state?.onComplete).toBe('finish');
  });
  it('fails closed when a configured control cannot reconstruct the call', async () => {
    const { deps, input } = setup();
    deps.messageModel.findMessagePlugin.mockResolvedValue(undefined);
    await expect(controlDeferredToolResult(deps, input)).rejects.toThrow(
      'tool call context is unavailable',
    );
    expect(fetchHook).not.toHaveBeenCalled();
  });
  it('uses current after-only environment controls when the parent snapshot is unavailable', async () => {
    const { deps, input } = setup();
    deps.loadState.mockResolvedValue(null);
    vi.stubEnv('AGENT_HOOK_WEBHOOK_URL', 'https://hooks.example/after');
    vi.stubEnv('AGENT_HOOK_WEBHOOK_TOKEN', 'synthetic-token');
    vi.stubEnv('AGENT_HOOK_WEBHOOK_EVENTS', 'afterToolCall');
    vi.stubEnv('AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING', 'toolCall');
    vi.stubEnv('AGENT_HOOK_WEBHOOK_ON_ERROR', 'block');
    expect((await controlDeferredToolResult(deps, input)).result.content).toBe(denialReason);
  });
});
