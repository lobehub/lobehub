import type { ExecSubAgentParams } from '@lobechat/types';
import { ThreadStatus, ThreadType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hookDispatcher } from '@/server/services/agentRuntime/hooks';
import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';

import { execAgentMember, execAgentThreadRun, type SubAgentRunDeps } from '../subAgentRuns';

// Keep one network recorder for both legacy fetch and the SSRF-safe HTTP transport.
vi.mock('@/database/models/user', () => ({
  UserModel: class {
    static getEmailsByIds = async (_db: unknown, ids: string[]) =>
      ids.map((id) => ({ id, email: `${id}@example.test` }));
    getUserPreference = async () => ({});
  },
}));
vi.mock('@/database/server', () => ({ getServerDB: async () => ({}) }));

vi.mock('@lobechat/ssrf-safe-fetch', () => ({
  ssrfSafeFetch: (url: string, init?: RequestInit) => globalThis.fetch(url, init),
}));

vi.mock('@/libs/qstash', () => ({ OtelQstashClient: vi.fn() }));
vi.mock('@/server/services/queue/impls', () => ({ isQueueAgentRuntimeEnabled: vi.fn() }));

const types = ['beforeCallAgent', 'afterCallAgent', 'onCallAgentError'] as const;
const serializedHooks = types.map((type) => ({
  id: type,
  type,
  webhook: { url: 'https://hooks.example.test/events' },
}));
const params: ExecSubAgentParams = {
  agentId: 'child-agent',
  groupId: 'group',
  instruction: 'Do the task',
  parentMessageId: 'parent-message',
  parentOperationId: 'parent-operation',
  title: 'Child task',
  topicId: 'topic',
};
const options = { isSubAgent: true, logScope: 'execVirtualSubAgent' } as const;

describe('sub-agent call notifications', () => {
  const loadState = vi.fn();
  const createThread = vi.fn();
  const updateThread = vi.fn();
  const startAgent = vi.fn();
  const findThread = vi.fn();
  const fetchMock = vi.fn();
  let deps: SubAgentRunDeps;

  const payloads = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
  const invoke = (kind: 'isolated' | 'member') =>
    kind === 'isolated'
      ? execAgentThreadRun(deps, params, options)
      : execAgentMember(deps, {
          agentId: params.agentId,
          anchorMessageId: 'anchor',
          expectedMembers: 1,
          groupId: 'group',
          groupToolMessageId: 'parent-message',
          instruction: params.instruction,
          mode: 'in_group',
          onComplete: 'resume',
          parentOperationId: 'parent-operation',
          topicId: 'topic',
        });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(true);
    vi.stubGlobal(
      'fetch',
      fetchMock.mockImplementation(async () => new Response('{}')),
    );
    loadState.mockResolvedValue({ agentId: 'parent-agent', host: { hooks: serializedHooks } });
    createThread.mockResolvedValue({ id: 'thread', type: ThreadType.Isolation });
    updateThread.mockResolvedValue({});
    startAgent.mockResolvedValue({
      assistantMessageId: 'assistant',
      operationId: 'child-operation',
      success: true,
    });
    deps = {
      agentOperationModel: { findById: vi.fn().mockResolvedValue({ trigger: 'cli' }) },
      agentRuntimeService: { loadInterventionContinuationState: loadState },
      execAgent: startAgent,
      messageModel: {},
      threadModel: { create: createThread, findById: findThread, update: updateThread },
      userId: 'user',
    } as unknown as SubAgentRunDeps;
    hookDispatcher.unregister('parent-operation');
  });

  afterEach(() => {
    hookDispatcher.unregister('parent-operation');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(['isolated', 'member'] as const)(
    'uses the parent runtime account despite visitor state for %s startup success and failure',
    async (kind) => {
      const parent = {
        origin: { userId: 'user' },
        principal: {
          actor: {
            shareVisitor: { agentId: 'agent-1', shareId: 'share-1', visitorUserId: 'visitor-1' },
          },
        },
        host: {
          hooks: serializedHooks.map((hook) => ({
            ...hook,
            webhook: { ...hook.webhook, body: { userId: 'user' } },
          })),
        },
      };
      loadState.mockResolvedValue(parent);
      const dispatch = vi.spyOn(hookDispatcher, 'dispatch');
      await invoke(kind);
      startAgent.mockResolvedValueOnce({ success: false, error: 'rejected' });
      await invoke(kind);
      expect(payloads().map((p) => p.hookType)).toEqual([
        'beforeCallAgent',
        'afterCallAgent',
        'beforeCallAgent',
        'onCallAgentError',
      ]);
      expect(
        payloads().every((p) => p.userId === 'user' && p.userEmail === 'user@example.test'),
      ).toBe(true);
      for (const type of types) {
        expect(dispatch).toHaveBeenCalledWith(
          'parent-operation',
          type,
          expect.objectContaining({ userId: 'user' }),
          parent.host.hooks,
          { ownerUserId: 'user' },
        );
      }
      expect(deps.userId).toBe('user');
      expect(parent.origin.userId).toBe('user');
      expect(startAgent.mock.calls.every(([input]) => input.userId === undefined)).toBe(true);
    },
  );

  it.each(['isolated', 'member'] as const)(
    'delivers parent persisted hooks on a fresh queue worker for %s runs',
    async (kind) => {
      await invoke(kind);
      expect(payloads().map((p) => p.hookType)).toEqual(['beforeCallAgent', 'afterCallAgent']);
      expect(payloads()[0]).toMatchObject({
        agentId: 'child-agent',
        operationId: 'parent-operation',
        instruction: 'Do the task',
      });
      expect(payloads()[1]).toMatchObject({
        agentId: 'child-agent',
        operationId: 'parent-operation',
        subOperationId: 'child-operation',
        success: true,
      });
      const childHookIds = startAgent.mock.calls[0][0].hooks.map((h: { id: string }) => h.id);
      expect(types.filter((type) => childHookIds.includes(type))).toEqual([]);
      expect(loadState).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['isolated', 'member'] as const)(
    'announces startup failure once and preserves the %s result',
    async (kind) => {
      startAgent.mockResolvedValue({
        operationId: 'child-operation',
        success: false,
        error: 'start rejected',
      });
      const result = await invoke(kind);
      expect(result).toMatchObject({ error: 'start rejected', operationId: 'child-operation' });
      expect(payloads().map((p) => p.hookType)).toEqual(['beforeCallAgent', 'onCallAgentError']);
      expect(payloads()[1]).toMatchObject({
        error: 'start rejected',
        subOperationId: 'child-operation',
      });
    },
  );

  it.each(['isolated', 'member'] as const)(
    'announces thrown startup errors once and rethrows the same object for %s',
    async (kind) => {
      const error = new Error('start threw');
      startAgent.mockRejectedValue(error);
      await expect(invoke(kind)).rejects.toBe(error);
      expect(payloads().map((p) => p.hookType)).toEqual(['beforeCallAgent', 'onCallAgentError']);
      expect(payloads()[1].error).toContain('start threw');
      if (kind === 'isolated')
        expect(updateThread).toHaveBeenCalledWith(
          'thread',
          expect.objectContaining({ status: ThreadStatus.Failed }),
        );
    },
  );

  it.each(['empty', 'throw'] as const)(
    'announces %s thread creation failure and preserves the thrown error',
    async (mode) => {
      const error = new Error('create threw');
      if (mode === 'empty') createThread.mockResolvedValue(null);
      else createThread.mockRejectedValue(error);
      await expect(invoke('isolated')).rejects.toThrow(
        mode === 'empty' ? 'Failed to create thread' : 'create threw',
      );
      expect(payloads().map((p) => p.hookType)).toEqual(['beforeCallAgent', 'onCallAgentError']);
      expect(startAgent).not.toHaveBeenCalled();
    },
  );

  it('announces a rejected continuation only once', async () => {
    findThread.mockResolvedValue(null);
    const result = await execAgentThreadRun(deps, { ...params, threadId: 'missing' }, options);
    expect(result.success).toBe(false);
    expect(payloads().map((p) => p.hookType)).toEqual(['beforeCallAgent', 'onCallAgentError']);
    expect(payloads()[1]).toMatchObject({ threadId: 'missing', error: result.error });
  });

  it('keeps local handlers single-dispatch and emits after at startup return', async () => {
    vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(false);
    const events: string[] = [];
    hookDispatcher.register(
      'parent-operation',
      types.map((type) => ({
        id: type,
        type,
        handler: async () => {
          events.push(type);
        },
      })),
    );
    await invoke('isolated');
    expect(events).toEqual(['beforeCallAgent', 'afterCallAgent']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not let notification delivery failure replace the original startup error', async () => {
    loadState.mockResolvedValue({
      host: {
        hooks: serializedHooks.map((h) => ({ ...h, webhook: { ...h.webhook, fallback: 'none' } })),
      },
    });
    fetchMock.mockRejectedValue(new Error('network down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('start threw');
    startAgent.mockRejectedValue(error);
    await expect(invoke('isolated')).rejects.toBe(error);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('preserves execution when the parent state cannot be loaded', async () => {
    loadState.mockRejectedValue(new Error('state unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(invoke('isolated')).resolves.toMatchObject({ success: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the run owner when parent state is unavailable, without leaking a previous visitor', async () => {
    vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(false);
    const users: string[] = [];
    hookDispatcher.register(
      'parent-operation',
      types.map((type) => ({
        id: type,
        type,
        handler: async (event) => {
          users.push(event.userId);
        },
      })),
    );
    loadState
      .mockResolvedValueOnce({
        principal: {
          actor: {
            shareVisitor: { agentId: 'agent-1', shareId: 'share-1', visitorUserId: 'visitor-1' },
          },
        },
      })
      .mockResolvedValueOnce(null);
    await invoke('isolated');
    await invoke('isolated');
    expect(users).toEqual(['user', 'user', 'user', 'user']);
  });

  it('does not load or dispatch parent hooks when there is no parent operation', async () => {
    await execAgentThreadRun(deps, { ...params, parentOperationId: undefined }, options);
    expect(loadState).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not send afterCallAgent until startup returns, or wait for child completion', async () => {
    let finishStart!: (value: { operationId: string; success: boolean }) => void;
    startAgent.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishStart = resolve;
        }),
    );
    const execution = invoke('isolated');
    await vi.waitFor(() => expect(startAgent).toHaveBeenCalledOnce());
    expect(payloads().map((p) => p.hookType)).toEqual(['beforeCallAgent']);
    finishStart({ operationId: 'child-operation', success: true });
    await execution;
    expect(payloads().map((p) => p.hookType)).toEqual(['beforeCallAgent', 'afterCallAgent']);
  });

  it('does not fall back to stale memory hooks when persisted hooks are empty', async () => {
    loadState.mockResolvedValue({ host: { hooks: [] } });
    hookDispatcher.register(
      'parent-operation',
      serializedHooks.map((hook) => ({
        ...hook,
        handler: vi.fn(),
      })),
    );
    await invoke('isolated');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('notifies once and preserves the startup exception when thread cleanup also throws', async () => {
    const error = new Error('startup failed');
    startAgent.mockRejectedValue(error);
    updateThread.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('cleanup failed'));
    await expect(invoke('isolated')).rejects.toBe(error);
    expect(payloads().map((p) => p.hookType)).toEqual(['beforeCallAgent', 'onCallAgentError']);
    expect(payloads()[1].error).toContain('startup failed');
  });
});
