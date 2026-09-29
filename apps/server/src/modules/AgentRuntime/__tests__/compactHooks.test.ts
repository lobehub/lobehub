import type { AgentRuntimeHost, AgentState } from '@lobechat/agent-runtime';
import { compressContext } from '@lobechat/agent-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HookDispatcher } from '@/server/services/agentRuntime/hooks/HookDispatcher';
import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';

import { ServerLifecycleSink } from '../adapters/ServerLifecycleSink';

vi.mock('@/database/models/user', () => ({
  UserModel: class {
    static getEmailsByIds = async (_db: unknown, ids: string[]) =>
      ids.map((id) => ({ id, email: `${id}@example.test` }));
    getUserPreference = async () => ({});
  },
}));
vi.mock('@/database/server', () => ({ getServerDB: async () => ({}) }));

vi.mock('@/server/services/queue/impls', () => ({
  isQueueAgentRuntimeEnabled: vi.fn(() => true),
}));

// Keep the real dispatcher, validation, payload construction and HTTP implementation.
vi.mock('@lobechat/ssrf-safe-fetch', () => ({
  ssrfSafeFetch: (url: string, init: RequestInit) => globalThis.fetch(url, init),
}));

const publishJSON = vi.hoisted(() => vi.fn().mockResolvedValue({ messageId: 'delivery' }));
vi.mock('@upstash/qstash', () => ({
  Client: class {
    publishJSON = publishJSON;
  },
}));

const createFixture = (delivery: 'fetch' | 'qstash', ownerCallback = false) => {
  const messages = [{ content: 'history', id: 'message', role: 'assistant' }];
  const registeringWorker = new HookDispatcher();
  registeringWorker.register(
    'operation',
    (['beforeCompact', 'afterCompact', 'onCompactError'] as const).map((type) => ({
      id: type,
      type,
      webhook: {
        delivery,
        url: 'https://hooks.example.com/compact',
        ...(ownerCallback ? { body: { userId: 'user' } } : {}),
      },
    })),
  );
  const state: AgentState = {
    cost: {
      calculatedAt: '2026-09-28T00:00:00Z',
      currency: 'USD',
      llm: { byModel: [], currency: 'USD', total: 0 },
      tools: { byTool: [], currency: 'USD', total: 0 },
      total: 0,
    },
    createdAt: '2026-09-28T00:00:00Z',
    host: {
      // Exercise the persisted JSON wire format, not only an in-memory clone.
      // eslint-disable-next-line unicorn/prefer-structured-clone
      hooks: JSON.parse(JSON.stringify(registeringWorker.getSerializedHooks('operation'))),
    },
    lastModified: '2026-09-28T00:00:00Z',
    maxSteps: 10,
    messages,
    modelRuntimeConfig: { model: 'gpt-4', provider: 'openai' },
    operationId: 'operation',
    principal: {
      actor: {
        shareVisitor: { agentId: 'agent-1', shareId: 'share-1', visitorUserId: 'visitor-1' },
      },
    },
    origin: {
      agentId: 'agent',
      lineage: { isSubAgent: true, parentOperationId: 'parent' },
      threadId: 'thread',
      topicId: 'topic',
      workspaceId: 'workspace',
    },
    status: 'running',
    stepCount: 2,
    toolManifestMap: {},
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
  };
  // A fresh worker has no registration. It must use the persisted operation configuration.
  const resumedWorker = new HookDispatcher();
  const stream = vi.fn().mockResolvedValue({ content: 'actual summary' });
  const rollbackGroup = vi.fn().mockResolvedValue(undefined);
  const host: AgentRuntimeHost = {
    lifecycle: new ServerLifecycleSink(resumedWorker, 'operation', 'user'),
    operation: { operationId: 'operation', stepIndex: 2, userId: 'user' },
    transports: {
      compression: {
        buildPrompt: vi.fn().mockResolvedValue({ messages }),
        createGroup: vi
          .fn()
          .mockResolvedValue({ messageGroupId: 'compact-group', messagesToSummarize: messages }),
        finalizeGroup: vi.fn().mockResolvedValue({
          messages: [{ content: 'actual summary', id: 'compact-group', role: 'compressedGroup' }],
        }),
        rollbackGroup,
      },
      llm: { stream },
      messages: {
        query: vi.fn().mockResolvedValue(messages),
      } as unknown as AgentRuntimeHost['transports']['messages'],
      stream: {} as AgentRuntimeHost['transports']['stream'],
    },
  };
  const run = () =>
    compressContext(host)(
      { payload: { currentTokenCount: 8000, messages }, type: 'compress_context' },
      state,
    );
  return { host, resumedWorker, rollbackGroup, run, state, stream };
};

describe('compact notifications through the server lifecycle and F HTTP dispatcher', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    publishJSON.mockClear();
  });

  it.each([false, true])(
    'restores webhook-only configs without registration (queue=%s)',
    async (queue) => {
      vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(queue);
      const bodies: Record<string, unknown>[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init: RequestInit) => {
          bodies.push(JSON.parse(String(init.body)));
          // Notifications must not interpret a tool-control-shaped response.
          return new Response(
            JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny' } }),
          );
        }),
      );
      const fixture = createFixture('fetch', true);
      const dispatch = vi.spyOn(fixture.resumedWorker, 'dispatch');
      const result = await fixture.run();
      expect(fixture.resumedWorker.hasHooks('operation')).toBe(false);
      expect(bodies.map((body) => body.hookType)).toEqual(['beforeCompact', 'afterCompact']);
      for (const body of bodies)
        expect(body).toMatchObject({
          userId: 'user',
          userEmail: 'user@example.test',
          agentId: 'agent',
          lineage: { isSubAgent: true, parentOperationId: 'parent' },
          operationId: 'operation',
          parentOperationId: 'parent',
          threadId: 'thread',
          topicId: 'topic',
          workspaceId: 'workspace',
        });
      expect(bodies[0]).toMatchObject({ messageCount: 1, tokenCount: 8000 });
      expect(bodies[1]).toMatchObject({
        groupId: 'compact-group',
        messagesBefore: 1,
        messagesAfter: 1,
        summary: 'actual summary',
      });
      expect(result.newState.messages[0].content).toBe('actual summary');
      for (const type of ['beforeCompact', 'afterCompact']) {
        expect(dispatch).toHaveBeenCalledWith(
          'operation',
          type,
          expect.objectContaining({ userId: 'user' }),
          fixture.state.host?.hooks,
          { ownerUserId: 'user' },
        );
      }
      expect(fixture.host.operation.userId).toBe('user');
      expect(result.newState.principal).toEqual(fixture.state.principal);
      expect(result.newState.host?.hooks).toEqual(fixture.state.host?.hooks);
      expect(fixture.rollbackGroup).not.toHaveBeenCalled();
    },
  );

  it('publishes the actual failure and lineage through restored QStash notification configs', async () => {
    vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(true);
    vi.stubEnv('QSTASH_TOKEN', 'test-token');
    const fixture = createFixture('qstash', true);
    const dispatch = vi.spyOn(fixture.resumedWorker, 'dispatch');
    const error = new Error('compression provider failed');
    fixture.stream.mockRejectedValue(error);
    const result = await fixture.run();
    const bodies = publishJSON.mock.calls.map(([request]) => request.body);
    expect(bodies.map((body) => body.hookType)).toEqual(['beforeCompact', 'onCompactError']);
    expect(dispatch).toHaveBeenCalledWith(
      'operation',
      'onCompactError',
      expect.objectContaining({ userId: 'user' }),
      fixture.state.host?.hooks,
      { ownerUserId: 'user' },
    );
    expect(bodies[1]).toMatchObject({
      userId: 'user',
      userEmail: 'user@example.test',
      error: error.message,
      tokenCount: 8000,
      parentOperationId: 'parent',
      operationId: 'operation',
      topicId: 'topic',
    });
    expect(result.events).toEqual([{ error, type: 'compression_error' }]);
    expect(result.newState.messages).toEqual(fixture.state.messages);
    expect(result.nextContext?.payload).toMatchObject({ skipped: true });
  });

  it('does not rollback or emit compression_error when a critical notification delivery fails', async () => {
    vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    const fixture = createFixture('fetch');
    for (const hook of fixture.state.host!.hooks!) hook.webhook.fallback = 'none';
    const result = await fixture.run();
    expect(result.events).toEqual([
      { groupId: 'compact-group', parentMessageId: 'message', type: 'compression_complete' },
    ]);
    expect(fixture.rollbackGroup).not.toHaveBeenCalled();
    expect(result.newState.messages[0].content).toBe('actual summary');
  });
});
