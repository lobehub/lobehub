// @vitest-environment node
/** Real step/completion producers through the dispatcher and HTTP transport. */
import { normalizeAgentState } from '@lobechat/agent-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBotCompletionWebhook } from '@/server/services/bot/createBotCompletionHook';
import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';

import { AgentRuntimeService } from '../AgentRuntimeService';
import { CriticalAgentInterventionPersistenceError } from '../CompletionLifecycle';
import { CriticalHookDeliveryError, hookDispatcher } from '../hooks';
import type { AgentHookEvent } from '../hooks/types';

// ── Mocks ──────────────────────────────────────────
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'http://localhost:3010' } }));
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(function () {
    return {};
  }),
}));
vi.mock('@/server/modules/AgentRuntime', () => ({
  AgentRuntimeCoordinator: vi.fn().mockImplementation(function () {
    return {
      createAgentOperation: vi.fn(),
      getOperationMetadata: vi.fn(),
      isInterrupted: vi.fn().mockResolvedValue(false),
      hasQueuedMessages: vi.fn().mockResolvedValue(false),
      loadAgentState: vi.fn(),
      releaseStepLock: vi.fn().mockResolvedValue(undefined),
      saveAgentState: vi.fn(),
      saveStepResult: vi.fn(),
      tryClaimStep: vi.fn().mockResolvedValue(true),
    };
  }),
  createStreamEventManager: vi.fn(function () {
    return {
      cleanupOperation: vi.fn(),
      publishAgentRuntimeEnd: vi.fn(),
      publishAgentRuntimeInit: vi.fn(),
      publishStreamEvent: vi.fn(),
    };
  }),
}));
vi.mock('@/server/modules/AgentRuntime/RuntimeExecutors', () => ({
  createRuntimeExecutors: vi.fn(function () {
    return {};
  }),
}));
vi.mock('@/server/services/mcp', () => ({ mcpService: {} }));
vi.mock('@/server/services/queue', () => ({
  QueueService: vi.fn().mockImplementation(function () {
    return {
      getImpl: vi.fn(function () {
        return {};
      }),
      scheduleMessage: vi.fn(),
    };
  }),
}));
vi.mock('@/server/services/queue/impls', () => ({
  LocalQueueServiceImpl: class {},
  isQueueAgentRuntimeEnabled: vi.fn().mockReturnValue(false),
}));
vi.mock('@/server/services/toolExecution', () => ({
  ToolExecutionService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));
vi.mock('@/server/services/toolExecution/builtin', () => ({
  BuiltinToolsExecutor: vi.fn().mockImplementation(function () {
    return {};
  }),
}));
vi.mock('@lobechat/builtin-tools/dynamicInterventionAudits', () => ({
  dynamicInterventionAudits: [],
}));

const { safeFetch, publish, getEmailsByIds } = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  publish: vi.fn(),
  getEmailsByIds: vi.fn(),
}));
vi.mock('@/database/models/user', () => ({
  UserModel: class {
    static getEmailsByIds = getEmailsByIds;
    getUserPreference = async () => ({});
  },
}));
vi.mock('@/database/server', () => ({ getServerDB: async () => ({}) }));
vi.mock('@lobechat/ssrf-safe-fetch', () => ({ ssrfSafeFetch: safeFetch }));
vi.mock('@/libs/qstash', () => ({
  OtelQstashClient: class {
    publishJSON = publish;
  },
}));
vi.mock('@/server/services/agentSignal', () => ({ emitAgentSignalSourceEvent: vi.fn() }));
vi.mock('@/server/services/verify', () => ({
  instantiateVerifyPlanOnStart: vi.fn(),
  runVerifyOnCompletion: vi.fn(),
  settleFailedRepair: vi.fn(),
}));

const operationId = 'lifecycle-operation';
const origin = {
  agentId: 'agent-1',
  userId: 'user-1',
  topicId: 'topic-1',
  threadId: 'thread-1',
  workspaceId: 'workspace-1',
  groupId: 'group-1',
  lineage: {
    parentOperationId: 'parent-1',
    isSubAgent: true as const,
    orchestrationRole: 'member' as const,
  },
};
const events = ['beforeStep', 'afterStep', 'onComplete', 'onError'] as const;
const usage = {
  llm: { apiCalls: 2, tokens: { input: 40, output: 10, total: 50 } },
  tools: { totalCalls: 1 },
};
const makeState = () => ({
  operationId,
  origin,
  createdAt: new Date().toISOString(),
  lastModified: new Date().toISOString(),
  cost: { total: 0.02 },
  usage,
  status: 'running',
  stepCount: 1,
  messages: [
    { role: 'assistant', content: 'Final reply ![image](https://example.com/result.png)' },
  ],
  metadata: { _stepTracking: { totalToolCalls: 7, lastLLMContent: 'Previous reply' } },
  host: {
    hooks: events.map((type) => ({
      id: type,
      type,
      webhook: { url: 'https://example.com/hooks' },
    })),
  },
});
const setup = (state = makeState(), ownerUserId = 'user-1') => {
  const service = new AgentRuntimeService({} as any, ownerUserId, { queueService: null });
  const coordinator = (service as any).coordinator;
  coordinator.loadAgentState.mockResolvedValue(state);
  const newState = { ...state, status: 'done', stepCount: 2 };
  const step = vi.fn().mockResolvedValue({
    events: [{ type: 'done', reason: 'done' }],
    newState,
    nextContext: null,
  });
  vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({ runtime: { step } });
  // DB persistence is external to hook delivery; keep the real lifecycle producer.
  vi.spyOn((service as any).completionLifecycle, 'persistCompletion').mockResolvedValue(true);
  vi.spyOn((service as any).completionLifecycle, 'registerFileWorks').mockResolvedValue(undefined);
  return { service, coordinator, step, newState };
};
// Observe the real producer's durable-state boundary, including any error rewrite.
const observeStateWrites = (coordinator: ReturnType<typeof setup>['coordinator']) => {
  const writes: Array<{ error?: unknown; status: string }> = [];
  const save = async (_operationId: string, state: { error?: unknown; status: string }) => {
    writes.push(structuredClone(state));
    coordinator.loadAgentState.mockResolvedValue(state);
  };
  coordinator.saveAgentState.mockImplementation(save);
  coordinator.saveStepResult.mockImplementation(
    async (id: string, result: { newState: { status: string } }) => save(id, result.newState),
  );
  return writes;
};
const execute = (service: AgentRuntimeService, runOperationId = operationId) =>
  service.executeStep({
    context: { phase: 'user_input' } as any,
    operationId: runOperationId,
    stepIndex: 1,
  });
const httpEvents = () => safeFetch.mock.calls.map(([, request]) => JSON.parse(request.body));

beforeEach(() => {
  getEmailsByIds
    .mockReset()
    .mockImplementation(async (_db, ids: string[]) =>
      ids.map((id) => ({ id, email: `${id}@example.test` })),
    );
  vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(false);
  safeFetch.mockReset().mockImplementation(async () => new Response('{}'));
  publish.mockReset().mockResolvedValue({ messageId: 'queued' });
});
afterEach(() => {
  hookDispatcher.unregister(operationId);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('lifecycle notifications from executeStep', () => {
  it.each([false, true])(
    'uses the runtime identity in all four events despite visitor state (queue=%s)',
    async (queue) => {
      vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(queue);
      // Historical persisted state is normalized by the same loader contract as local/queue workers.
      const state = normalizeAgentState({
        ...makeState(),
        metadata: {
          agentShareVisitor: { agentId: 'agent-1', shareId: 'share-1', visitorUserId: 'visitor-1' },
        },
      } as any);
      const { service, step, newState, coordinator } = setup(state);
      const dispatch = vi.spyOn(hookDispatcher, 'dispatch');
      const writes = observeStateWrites(coordinator);
      const error = { type: 'ProviderFailure', message: 'provider failed' };
      step.mockResolvedValue({
        events: [{ type: 'done', reason: 'error' }],
        newState: { ...newState, status: 'error', error },
        nextContext: null,
      });
      await execute(service);
      expect(httpEvents().map((event) => event.hookType)).toEqual(events);
      for (const event of httpEvents()) {
        expect(event.userId).toBe('user-1');
        expect(event.userEmail).toBe('user-1@example.test');
        expect(event).not.toHaveProperty('actorUserId');
        expect(event).not.toHaveProperty('ownerUserId');
      }
      for (const type of events) {
        expect(dispatch).toHaveBeenCalledWith(
          operationId,
          type,
          expect.objectContaining({ userId: 'user-1' }),
          expect.any(Array),
          { ownerUserId: 'user-1' },
        );
      }
      expect(writes.length).toBeGreaterThan(0);
      expect(writes.every((write: any) => write.origin.userId === 'user-1')).toBe(true);
      expect((service as any).userId).toBe('user-1');
      expect(state.origin.userId).toBe('user-1');
    },
  );

  it('keeps per-service owners separate across overlapping visitor runs', async () => {
    const dispatch = vi.spyOn(hookDispatcher, 'dispatch');
    const runs = ['owner-a', 'owner-b'].map((ownerUserId) => {
      const runOperationId = `operation-${ownerUserId}`;
      const state = normalizeAgentState({
        ...makeState(),
        operationId: runOperationId,
        origin: { ...origin, userId: ownerUserId },
        principal: {
          actor: {
            shareVisitor: {
              agentId: 'agent-1',
              shareId: 'share-1',
              visitorUserId: `visitor-${ownerUserId}`,
            },
          },
        },
      } as any);
      return { ...setup(state, ownerUserId), ownerUserId, runOperationId };
    });
    await Promise.all(runs.map(({ service, runOperationId }) => execute(service, runOperationId)));
    for (const { ownerUserId, runOperationId } of runs) {
      for (const type of ['beforeStep', 'afterStep', 'onComplete']) {
        expect(dispatch).toHaveBeenCalledWith(
          runOperationId,
          type,
          expect.objectContaining({ userId: ownerUserId }),
          expect.any(Array),
          { ownerUserId },
        );
      }
    }
  });

  it.each([false, true])(
    'enriches all terminal/step owner callbacks without leaking cached email across workers (queue=%s)',
    async (queue) => {
      vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(queue);
      vi.stubEnv('QSTASH_TOKEN', 'test-token');
      const run = async (owner: string, target: string, id: string) => {
        const state = normalizeAgentState({
          ...makeState(),
          operationId: id,
          origin: { ...origin, userId: owner },
          principal: {
            actor: {
              shareVisitor: {
                agentId: 'agent-1',
                shareId: 'share-1',
                visitorUserId: `visitor-${id}`,
              },
            },
          },
          host: {
            hooks: events.map((type) => ({
              id: type,
              type,
              webhook: {
                url: 'https://example.com/hooks',
                delivery: queue ? 'qstash' : 'fetch',
                body: { userId: target, userEmail: 'forged@example.test' },
              },
            })),
          },
        } as any);
        // Each service is a fresh worker; the singleton only shares the bounded email cache.
        const { service, step, newState, coordinator } = setup(state, owner);
        const writes = observeStateWrites(coordinator);
        step.mockResolvedValue({
          events: [{ type: 'done', reason: 'error' }],
          newState: {
            ...newState,
            status: 'error',
            error: { type: 'BusinessError', message: 'failed' },
          },
          nextContext: null,
        });
        await execute(service, id);
        expect(writes.every((write: any) => write.origin.userId === owner)).toBe(true);
      };
      const cachedOwner = `owner-warm-${queue}`;
      await run(cachedOwner, cachedOwner, `warm-${queue}`);
      // One authorized owner and one forged body ID overlap after warming the same dispatcher cache.
      await Promise.all([
        run(`owner-next-${queue}`, `owner-next-${queue}`, `next-${queue}`),
        run(`owner-other-${queue}`, cachedOwner, `forged-${queue}`),
      ]);
      const payloads = queue ? publish.mock.calls.map(([request]) => request.body) : httpEvents();
      for (const id of [`warm-${queue}`, `next-${queue}`, `forged-${queue}`]) {
        const delivered = payloads.filter((payload) => payload.operationId === id);
        expect(delivered.map((payload) => payload.hookType)).toEqual(events);
        for (const payload of delivered) {
          if (id.startsWith('forged')) expect(payload).not.toHaveProperty('userEmail');
          else expect(payload.userEmail).toBe(`${payload.userId}@example.test`);
          expect(payload).not.toHaveProperty('ownerUserId');
          expect(payload).not.toHaveProperty('actorUserId');
        }
      }
      expect(getEmailsByIds.mock.calls.filter(([, ids]) => ids[0] === cachedOwner)).toHaveLength(1);
    },
  );

  it.each([false, true])('uses persisted hooks on a fresh worker (queue=%s)', async (queue) => {
    vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(queue);
    const { service, step, newState } = setup();
    const result = await execute(service);
    expect(result.success).toBe(true);
    expect(step).toHaveBeenCalledTimes(1);
    const delivered = httpEvents();
    expect(delivered.map((event) => event.hookType)).toEqual([
      'beforeStep',
      'afterStep',
      'onComplete',
    ]);
    for (const event of delivered) {
      expect(event).toMatchObject({ ...origin, operationId, parentOperationId: 'parent-1' });
      expect(event).not.toHaveProperty('finalState');
      expect(event).not.toHaveProperty('rootOperationId');
    }
    expect(delivered[0]).toMatchObject({ stepIndex: 1, steps: 1 });
    expect(delivered[1]).toMatchObject({
      stepIndex: 1,
      steps: 2,
      totalSteps: 2,
      totalCost: newState.cost.total,
      totalTokens: 50,
      totalInputTokens: 40,
      totalOutputTokens: 10,
      totalToolCalls: 1,
      lastLLMContent: 'Previous reply',
      shouldContinue: false,
    });
    expect(delivered[2]).toMatchObject({
      reason: 'done',
      status: 'done',
      steps: 2,
      cost: 0.02,
      toolCalls: 1,
      llmCalls: 2,
      totalCost: 0.02,
      totalSteps: 2,
      totalToolCalls: 1,
      totalTokens: 50,
      totalInputTokens: 40,
      totalOutputTokens: 10,
      lastAssistantContent: newState.messages[0].content,
      attachments: [{ fetchUrl: 'https://example.com/result.png', type: 'image' }],
    });
  });

  it('keeps the trusted owner on an internal QStash callback and external events keep the runtime identity', async () => {
    vi.stubEnv('APP_URL', 'https://app.example.test');
    vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(true);
    vi.stubEnv('QSTASH_TOKEN', 'test-token');
    const state = {
      ...makeState(),
      principal: {
        actor: {
          shareVisitor: { agentId: 'agent-1', shareId: 'share-1', visitorUserId: 'visitor-1' },
        },
      },
    };
    const webhook = createBotCompletionWebhook({
      botContext: {
        applicationId: 'bot',
        isOwner: false,
        platform: 'telegram',
        platformThreadId: 'chat',
        senderExternalUserId: 'external',
      },
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    state.host.hooks.find((hook) => hook.type === 'onComplete')!.webhook = webhook;
    const { service } = setup(state);
    await execute(service);
    expect(
      httpEvents().every(
        (event) => event.userId === 'user-1' && event.userEmail === 'user-1@example.test',
      ),
    ).toBe(true);
    expect(publish).toHaveBeenCalledOnce();
    expect(publish.mock.calls[0][0].body).toMatchObject({
      userId: 'user-1',
      userEmail: 'user-1@example.test',
      workspaceId: 'workspace-1',
      operationId,
    });
    expect(webhook.fallback).toBe('none');
  });

  it('delivers QStash notifications using persisted hooks without local registration', async () => {
    vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(true);
    vi.stubEnv('QSTASH_TOKEN', 'test-token');
    const state = makeState();
    const hooks = state.host.hooks.map((hook) => ({
      ...hook,
      webhook: { ...hook.webhook, delivery: 'qstash' as const },
    }));
    const { service } = setup({ ...state, host: { hooks } });
    await execute(service);
    expect(safeFetch).not.toHaveBeenCalled();
    const delivered = publish.mock.calls.map(([request]) => request.body);
    expect(delivered.map((event) => event.hookType)).toEqual([
      'beforeStep',
      'afterStep',
      'onComplete',
    ]);
    expect(delivered[2]).toMatchObject({ operationId, threadId: 'thread-1', totalToolCalls: 1 });
    expect(delivered[2]).not.toHaveProperty('finalState');
  });

  it('keeps handler-only progress statistics equal to executed usage and retains local state', async () => {
    const state = {
      ...makeState(),
      principal: {
        actor: {
          shareVisitor: { agentId: 'agent-1', shareId: 'share-1', visitorUserId: 'visitor-1' },
        },
      },
    };
    state.host.hooks = [];
    const captured: AgentHookEvent[] = [];
    hookDispatcher.register(
      operationId,
      events.map((type) => ({
        id: type,
        type,
        handler: async (event) => {
          captured.push(event);
        },
      })),
    );
    const { service } = setup(state);
    await execute(service);
    expect(captured).toHaveLength(3);
    expect(captured.every((event) => event.userId === 'user-1')).toBe(true);
    expect(captured.every((event) => event.finalState?.origin?.userId === 'user-1')).toBe(true);
    expect(captured[1].totalToolCalls).toBe(1);
    expect(captured[2].totalToolCalls).toBe(1);
    expect(captured.every((event) => event.finalState !== undefined)).toBe(true);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('retains the structured runtime error and correlation in the existing complete/error pair', async () => {
    const error = {
      type: 'ProviderFailure',
      message: 'provider unavailable',
      body: { code: 'upstream', retryAfter: 3 },
    };
    const { service, newState, step } = setup();
    step.mockResolvedValue({
      events: [{ type: 'done', reason: 'error' }],
      newState: { ...newState, status: 'error', error },
      nextContext: null,
    });
    await execute(service);
    const terminal = httpEvents().filter((event) =>
      ['onComplete', 'onError'].includes(event.hookType),
    );
    expect(terminal.map((event) => event.hookType)).toEqual(['onComplete', 'onError']);
    for (const event of terminal)
      expect(event).toMatchObject({
        errorDetail: error,
        reason: 'error',
        operationId,
        parentOperationId: 'parent-1',
      });
  });

  it('ignores notification responses and failures without changing step execution or emitting onError', async () => {
    safeFetch
      .mockRejectedValueOnce(new Error('notification failed'))
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny' } })),
      );
    const { service, step } = setup();
    expect((await execute(service)).success).toBe(true);
    expect(step).toHaveBeenCalledTimes(1);
    expect(httpEvents().map((event) => event.hookType)).toEqual([
      'beforeStep',
      'afterStep',
      'onComplete',
    ]);
  });

  it('does not invent parent or root IDs when only a progress anchor exists', async () => {
    const state = makeState();
    state.origin = {
      agentId: 'agent-1',
      userId: 'user-1',
      lineage: { progressAnchor: { parentOperationId: 'progress-only', toolMessageId: 'tool' } },
    } as any;
    const { service } = setup(state);
    await execute(service);
    for (const event of httpEvents()) {
      expect(event).not.toHaveProperty('parentOperationId');
      expect(event).not.toHaveProperty('rootOperationId');
      expect(event).not.toHaveProperty('threadId');
      expect(event).not.toHaveProperty('workspaceId');
    }
  });

  it('keeps a thrown structured runtime failure in the original complete/error pair', async () => {
    const { service, step, coordinator } = setup();
    const writes = observeStateWrites(coordinator);
    const error = {
      type: 'ProviderFailure',
      message: 'provider failed',
      body: { upstream: { status: 503 } },
    };
    step.mockRejectedValue(error);
    await expect(execute(service)).rejects.toBe(error);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ status: 'error', error });
    expect(httpEvents().map((event) => event.hookType)).toEqual([
      'beforeStep',
      'onComplete',
      'onError',
    ]);
    expect(httpEvents()[2]).toMatchObject({
      ...origin,
      operationId,
      parentOperationId: 'parent-1',
      reason: 'error',
      errorDetail: {
        type: 'ProviderFailure',
        message: 'provider failed',
        body: { upstream: { status: 503 } },
      },
    });
  });

  it('retains loaded correlation and persisted hooks when the error-path state reload fails', async () => {
    vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(true);
    const state = makeState();
    const { service, coordinator, step } = setup(state);
    const error = {
      type: 'ProviderFailure',
      message: 'provider failed',
      body: { code: 'upstream' },
    };
    coordinator.loadAgentState
      .mockReset()
      .mockResolvedValueOnce(state)
      .mockRejectedValue(new Error('state store unavailable'));
    step.mockRejectedValue(error);
    await expect(execute(service)).rejects.toBe(error);
    expect(httpEvents().map((event) => event.hookType)).toEqual([
      'beforeStep',
      'onComplete',
      'onError',
    ]);
    expect(httpEvents()[2]).toMatchObject({ operationId, ...origin, errorDetail: error });
  });

  it.each([true, false])(
    'isolates two operations on one service when the second initial read succeeds=%s',
    async (secondReadSucceeds) => {
      vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(true);
      const firstState = {
        ...makeState(),
        principal: {
          actor: {
            shareVisitor: { agentId: 'agent-1', shareId: 'share-1', visitorUserId: 'visitor-1' },
          },
        },
      };
      const { service, coordinator, step } = setup(firstState);
      const firstError = { type: 'ProviderFailure', message: 'first operation failed' };
      coordinator.loadAgentState
        .mockReset()
        .mockResolvedValueOnce(firstState)
        .mockRejectedValue(new Error('first reload unavailable'));
      step.mockRejectedValue(firstError);
      await expect(execute(service)).rejects.toBe(firstError);
      expect(httpEvents().map((event) => event.hookType)).toEqual([
        'beforeStep',
        'onComplete',
        'onError',
      ]);
      expect(httpEvents()[2]).toMatchObject({
        operationId,
        ...origin,
        userId: 'user-1',
        errorDetail: firstError,
      });

      const secondOperationId = 'second-operation';
      const secondOrigin = {
        ...origin,
        agentId: 'agent-2',
        topicId: 'topic-2',
        threadId: 'thread-2',
        workspaceId: 'workspace-2',
        lineage: { parentOperationId: 'parent-2' },
      };
      const secondState = {
        ...makeState(),
        operationId: secondOperationId,
        origin: secondOrigin,
        host: {
          hooks: events.map((type) => ({
            id: 'second-' + type,
            type,
            webhook: { url: 'https://example.com/second-hooks' },
          })),
        },
      };
      const secondError = { type: 'ProviderFailure', message: 'second operation failed' };
      coordinator.loadAgentState.mockReset();
      if (secondReadSucceeds) coordinator.loadAgentState.mockResolvedValueOnce(secondState);
      coordinator.loadAgentState.mockRejectedValue(secondError);
      step.mockRejectedValue(secondError);
      safeFetch.mockClear();
      coordinator.saveAgentState.mockClear();
      const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch');
      await expect(execute(service, secondOperationId)).rejects.toBe(secondError);
      const secondErrorEvent = dispatchSpy.mock.calls.find(
        ([id, type]) => id === secondOperationId && type === 'onError',
      )?.[2] as AgentHookEvent;
      expect(secondErrorEvent.operationId).toBe(secondOperationId);
      expect(secondErrorEvent.userId).toBe('user-1');
      expect(secondErrorEvent.errorDetail).toMatchObject(secondError);
      expect(coordinator.saveAgentState).toHaveBeenCalledTimes(1);
      const [, savedState] = coordinator.saveAgentState.mock.calls[0];
      expect(savedState.error).toMatchObject(secondError);
      if (secondReadSucceeds) {
        expect(httpEvents().map((event) => event.hookType)).toEqual([
          'beforeStep',
          'onComplete',
          'onError',
        ]);
        for (const [url, request] of safeFetch.mock.calls) {
          expect(url).toBe('https://example.com/second-hooks');
          expect(JSON.parse(request.body)).toMatchObject({
            operationId: secondOperationId,
            ...secondOrigin,
            parentOperationId: 'parent-2',
          });
        }
        expect(savedState.origin).toEqual(secondOrigin);
        expect(savedState.host.hooks).toEqual(secondState.host.hooks);
      } else {
        // The second invocation never obtained state: it must not reuse any
        // hook endpoint, origin, lineage, or state from the first invocation.
        expect(safeFetch).not.toHaveBeenCalled();
        expect(savedState.origin).toBeUndefined();
        expect(savedState.host).toBeUndefined();
        expect(secondErrorEvent.agentId).toBe('');
        expect(secondErrorEvent.lineage).toBeUndefined();
        expect(secondErrorEvent.parentOperationId).toBeUndefined();
        expect(secondErrorEvent.topicId).toBeUndefined();
        expect(secondErrorEvent.threadId).toBeUndefined();
        expect(secondErrorEvent.workspaceId).toBeUndefined();
      }
    },
  );

  it.each([false, true])(
    'preserves error precedence when reloaded-state notifications fail (critical=%s)',
    async (critical) => {
      vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(true);
      const state = makeState();
      state.host.hooks = (['onComplete', 'onError'] as const).map((type) => ({
        id: type,
        type,
        webhook: { url: 'https://example.com/hooks', ...(critical && { fallback: 'none' }) },
      }));
      const { service, coordinator, step } = setup(state);
      const businessError = {
        type: 'ProviderFailure',
        message: 'original business failure',
        body: { code: 'upstream' },
      };
      coordinator.loadAgentState
        .mockReset()
        .mockResolvedValueOnce(state)
        .mockRejectedValue(new Error('reload unavailable'));
      step.mockRejectedValue(businessError);
      safeFetch.mockRejectedValue(new Error('notification delivery failed'));
      const lifecycle = (service as any).completionLifecycle;
      const lifecycleSpy = vi.spyOn(lifecycle, 'dispatchHooks');
      const thrown = await execute(service).catch((error) => error);
      if (critical) {
        const lifecycleError = await lifecycleSpy.mock.results[0].value.catch(
          (error: unknown) => error,
        );
        expect(thrown).toBeInstanceOf(CriticalHookDeliveryError);
        expect(thrown).toBe(lifecycleError);
        expect(thrown).not.toBe(businessError);
      } else {
        expect(thrown).toBe(businessError);
      }
      expect(lifecycleSpy).toHaveBeenCalledTimes(1);
      expect(coordinator.saveAgentState).toHaveBeenCalledTimes(1);
      expect(coordinator.saveAgentState.mock.calls[0][1]).toMatchObject({
        status: 'error',
        error: businessError,
        origin,
        host: state.host,
      });
      expect(httpEvents().map((event) => event.hookType)).toEqual(
        critical ? ['onComplete'] : ['onComplete', 'onError'],
      );
      for (const event of httpEvents())
        expect(event).toMatchObject({ operationId, errorDetail: businessError, ...origin });
    },
  );

  it.each(['done', 'max_steps', 'cost_limit', 'interrupted', 'waiting_for_async_tool'])(
    'preserves the existing completion relationship for %s',
    async (reason) => {
      const { service, newState } = setup();
      const lifecycle = (service as any).completionLifecycle;
      await lifecycle.dispatchHooks(operationId, { ...newState, status: reason }, reason);
      expect(httpEvents().map((event) => event.hookType)).toEqual(
        reason === 'waiting_for_async_tool' ? [] : ['onComplete'],
      );
      if (reason !== 'waiting_for_async_tool')
        expect(httpEvents()[0]).toMatchObject({ reason, status: reason, totalSteps: 2 });
    },
  );

  it.each([
    { status: 'done', failingHook: 'onComplete' },
    { status: 'error', failingHook: 'onComplete' },
    { status: 'error', failingHook: 'onError' },
  ] as const)(
    'rethrows the same critical $failingHook error without rewriting $status or redispatching',
    async ({ status, failingHook }) => {
      vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(true);
      const state = makeState();
      state.host.hooks = (['onComplete', 'onError'] as const).map((type) => ({
        id: type,
        type,
        webhook: { url: 'https://example.com/hooks', fallback: 'none' },
      }));
      const { service, coordinator, step, newState } = setup(state);
      const businessError = {
        type: 'ProviderFailure',
        message: 'original business error',
        body: { status: 503 },
      };
      const terminalState = {
        ...newState,
        status,
        ...(status === 'error' && { error: businessError }),
      };
      step.mockResolvedValue({
        events: [{ type: 'done', reason: status }],
        newState: terminalState,
        nextContext: null,
      });
      const writes = observeStateWrites(coordinator);
      const lifecycle = (service as any).completionLifecycle;
      // Both spies call through: the real HTTP dispatcher constructs the critical
      // error, and both real catch blocks must propagate that exact same instance.
      const dispatcherSpy = vi.spyOn(hookDispatcher, 'dispatch');
      const lifecycleSpy = vi.spyOn(lifecycle, 'dispatchHooks');
      safeFetch.mockImplementation(async (_url, request) => {
        if (JSON.parse(request.body).hookType === failingHook)
          throw new Error('callback unavailable');
        return new Response('{}');
      });

      const thrown = await execute(service).catch((error) => error);
      const lifecycleError = await lifecycleSpy.mock.results[0].value.catch(
        (error: unknown) => error,
      );
      const failedDispatch = dispatcherSpy.mock.calls.findIndex(([, type]) => type === failingHook);
      const dispatcherError = await dispatcherSpy.mock.results[failedDispatch].value.catch(
        (error: unknown) => error,
      );
      expect(thrown).toBeInstanceOf(CriticalHookDeliveryError);
      expect(thrown).toBe(lifecycleError);
      expect(thrown).toBe(dispatcherError);
      expect(thrown.hookId).toBe(failingHook);
      expect(lifecycleSpy).toHaveBeenCalledTimes(1);
      expect(lifecycle.persistCompletion).toHaveBeenCalledTimes(1);
      expect(step).toHaveBeenCalledTimes(1);
      expect(httpEvents().map((event) => event.hookType)).toEqual(
        failingHook === 'onComplete' ? ['onComplete'] : ['onComplete', 'onError'],
      );
      expect(
        httpEvents().every((event) => event.reason === status && event.status === status),
      ).toBe(true);
      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({ status, stepCount: 2, usage });
      expect(writes[0].error).toEqual(status === 'error' ? businessError : undefined);
      expect(coordinator.saveAgentState).not.toHaveBeenCalled();
      expect(
        (service as any).streamManager.publishStreamEvent.mock.calls.some(
          ([, event]: [string, { type: string }]) => event.type === 'error',
        ),
      ).toBe(false);
      if (status === 'error')
        for (const event of httpEvents()) expect(event.errorDetail).toEqual(businessError);
    },
  );

  it('preserves the same intervention persistence error and parked state through both real catch blocks', async () => {
    const state = makeState();
    state.host.hooks = state.host.hooks.filter(
      (hook) => hook.type === 'onComplete' || hook.type === 'onError',
    );
    const { service, coordinator, step, newState } = setup(state);
    const parkedState = { ...newState, status: 'waiting_for_human' };
    step.mockResolvedValue({ events: [], newState: parkedState, nextContext: undefined });
    const writes = observeStateWrites(coordinator);
    const lifecycle = (service as any).completionLifecycle;
    const error = new CriticalAgentInterventionPersistenceError(
      operationId,
      new Error('Review store unavailable'),
    );
    vi.spyOn(lifecycle, 'notifyPendingAgentIntervention').mockRejectedValue(error);
    const lifecycleSpy = vi.spyOn(lifecycle, 'dispatchHooks');
    await expect(execute(service)).rejects.toBe(error);
    await expect(lifecycleSpy.mock.results[0].value).rejects.toBe(error);
    expect(lifecycleSpy).toHaveBeenCalledTimes(1);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ status: 'waiting_for_human' });
    expect(writes[0].error).toBeUndefined();
    expect(coordinator.saveAgentState).not.toHaveBeenCalled();
    expect(httpEvents()).toEqual([]);
    expect(
      (service as any).streamManager.publishStreamEvent.mock.calls.some(
        ([, event]: [string, { type: string }]) => event.type === 'error',
      ),
    ).toBe(false);
  });
});
