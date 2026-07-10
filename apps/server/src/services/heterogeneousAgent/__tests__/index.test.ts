// @vitest-environment node
import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { type IStreamEventManager } from '@/server/modules/AgentRuntime/types';
import { CompletionLifecycle } from '@/server/services/agentRuntime/CompletionLifecycle';
import { hookDispatcher } from '@/server/services/agentRuntime/hooks';
import type { AgentHook, SerializedHook } from '@/server/services/agentRuntime/hooks/types';
import * as verifyService from '@/server/services/verify';

import type { HeterogeneousPersistenceHandler } from '..';
import { HeterogeneousAgentService, StaleHeteroOperationError } from '..';
import { HeteroTraceRecorder } from '../HeteroTraceRecorder';

// Force queue/production mode so the terminal funnel takes the serialized-webhook
// delivery path (the hetero cross-process path), not the in-memory handler path.
// Default to local (false) so the existing in-memory-handler tests are unaffected.
vi.mock('@/server/services/queue/impls', () => ({
  isQueueAgentRuntimeEnabled: vi.fn(() => false),
}));

const mockPublishJSON = vi.hoisted(() => vi.fn());
vi.mock('@upstash/qstash', () => ({
  Client: class {
    publishJSON = mockPublishJSON;
  },
}));

const { isQueueAgentRuntimeEnabled } = await import('@/server/services/queue/impls');

const createFakeStreamManager = () => {
  const published: Array<{ event: any; operationId: string }> = [];
  const manager: Partial<IStreamEventManager> = {
    publishStreamEvent: vi.fn(async (operationId, event) => {
      published.push({ event, operationId });
      return `${operationId}-${published.length}`;
    }),
  };
  return { manager: manager as IStreamEventManager, published };
};

const createFakePersistenceHandler = () => {
  const handler = {
    finish: vi.fn(async () => {}),
    ingest: vi.fn(async () => {}),
  };
  return handler as unknown as HeterogeneousPersistenceHandler & typeof handler;
};

const buildEvent = (
  type: AgentStreamEvent['type'],
  stepIndex: number,
  data: Record<string, unknown> = {},
): AgentStreamEvent => ({
  data,
  operationId: 'op-test',
  stepIndex,
  timestamp: 1_700_000_000_000 + stepIndex,
  type,
});

const createService = (overrides: { streamEventManager?: IStreamEventManager } = {}) => {
  const { manager, published } = createFakeStreamManager();
  const persistenceHandler = createFakePersistenceHandler();
  const service = new HeterogeneousAgentService({} as any, 'user-test', {
    persistenceHandler,
    streamEventManager: overrides.streamEventManager ?? manager,
  });
  return { manager, persistenceHandler, published, service };
};

describe('HeterogeneousAgentService', () => {
  describe('heteroIngest', () => {
    it('republishes every event through the stream manager preserving ordering', async () => {
      const { manager, published, service } = createService();

      const events: AgentStreamEvent[] = [
        buildEvent('stream_start', 0, { assistantMessage: { id: 'asst-1' } }),
        buildEvent('stream_chunk', 1, { chunkType: 'text', content: 'hi' }),
        buildEvent('tool_start', 2, { parentMessageId: 'asst-1' }),
        buildEvent('tool_result', 3, { toolCallId: 'tc-1' }),
        buildEvent('agent_runtime_end', 4, { reason: 'success' }),
      ];

      await service.heteroIngest({
        agentType: 'claude-code',
        events,
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      expect(manager.publishStreamEvent).toHaveBeenCalledTimes(5);

      // Verify events arrive in submission order with correct payloads
      published.forEach((entry, idx) => {
        expect(entry.operationId).toBe('op-1');
        expect(entry.event.type).toBe(events[idx].type);
        expect(entry.event.stepIndex).toBe(events[idx].stepIndex);
        expect(entry.event.data).toEqual(events[idx].data);
      });
    });

    it('uses the operationId from the request, not from the event itself', async () => {
      const { manager, service } = createService();

      // Producer-side bug simulation: events tagged with stale op id
      const events: AgentStreamEvent[] = [
        { ...buildEvent('stream_chunk', 0), operationId: 'op-stale' },
      ];

      await service.heteroIngest({
        agentType: 'claude-code',
        events,
        operationId: 'op-current',
        topicId: 'topic-1',
      });

      expect(manager.publishStreamEvent).toHaveBeenCalledWith(
        'op-current',
        expect.objectContaining({ stepIndex: 0, type: 'stream_chunk' }),
      );
    });

    it('propagates publish failures so the CLI ingester retries the batch', async () => {
      const manager: Partial<IStreamEventManager> = {
        publishStreamEvent: vi
          .fn()
          .mockResolvedValueOnce('ok-0')
          .mockRejectedValueOnce(new Error('redis down')),
      };
      const persistenceHandler = createFakePersistenceHandler();
      const service = new HeterogeneousAgentService({} as any, 'user-test', {
        persistenceHandler,
        streamEventManager: manager as IStreamEventManager,
      });

      await expect(
        service.heteroIngest({
          agentType: 'claude-code',
          events: [buildEvent('stream_chunk', 0), buildEvent('stream_chunk', 1)],
          operationId: 'op-1',
          topicId: 'topic-1',
        }),
      ).rejects.toThrow('redis down');
    });

    it('persists before publishing — DB is the source of truth fetchAndReplace reads', async () => {
      const callOrder: string[] = [];
      const manager: Partial<IStreamEventManager> = {
        publishStreamEvent: vi.fn(async () => {
          callOrder.push('publish');
          return 'ok';
        }),
      };
      const persistenceHandler = {
        finish: vi.fn(async () => {}),
        ingest: vi.fn(async () => {
          callOrder.push('persist');
        }),
      } as unknown as HeterogeneousPersistenceHandler;
      const service = new HeterogeneousAgentService({} as any, 'user-test', {
        persistenceHandler,
        streamEventManager: manager as IStreamEventManager,
      });

      await service.heteroIngest({
        agentType: 'claude-code',
        events: [buildEvent('stream_chunk', 0)],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      expect(callOrder).toEqual(['persist', 'publish']);
    });

    it('throws on persistence failure without publishing — keep DB and stream consistent', async () => {
      const manager: Partial<IStreamEventManager> = {
        publishStreamEvent: vi.fn(),
      };
      const persistenceHandler = {
        finish: vi.fn(async () => {}),
        ingest: vi.fn(async () => {
          throw new Error('topic missing runningOperation');
        }),
      } as unknown as HeterogeneousPersistenceHandler;
      const service = new HeterogeneousAgentService({} as any, 'user-test', {
        persistenceHandler,
        streamEventManager: manager as IStreamEventManager,
      });

      await expect(
        service.heteroIngest({
          agentType: 'claude-code',
          events: [buildEvent('stream_chunk', 0)],
          operationId: 'op-1',
          topicId: 'topic-1',
        }),
      ).rejects.toThrow(/runningOperation/);
      expect(manager.publishStreamEvent).not.toHaveBeenCalled();
    });

    it('ignores stale operation batches without publishing or throwing', async () => {
      const manager: Partial<IStreamEventManager> = {
        publishStreamEvent: vi.fn(),
      };
      const persistenceHandler = {
        finish: vi.fn(async () => {}),
        ingest: vi.fn(async () => {
          throw new StaleHeteroOperationError('stale old batch');
        }),
      } as unknown as HeterogeneousPersistenceHandler;
      const service = new HeterogeneousAgentService({} as any, 'user-test', {
        persistenceHandler,
        streamEventManager: manager as IStreamEventManager,
      });

      await expect(
        service.heteroIngest({
          agentType: 'claude-code',
          events: [buildEvent('stream_chunk', 0)],
          operationId: 'op-old',
          topicId: 'topic-1',
        }),
      ).resolves.toBeUndefined();
      expect(manager.publishStreamEvent).not.toHaveBeenCalled();
    });
  });

  describe('heteroFinish', () => {
    it('publishes a terminal agent_runtime_end with the high-level result', async () => {
      const { manager, published, service } = createService();

      await service.heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-1',
        result: 'success',
        sessionId: 'cc-session-abc',
        topicId: 'topic-1',
      });

      expect(manager.publishStreamEvent).toHaveBeenCalledTimes(1);
      expect(published[0].operationId).toBe('op-1');
      expect(published[0].event.type).toBe('agent_runtime_end');
      expect(published[0].event.data).toMatchObject({
        agentType: 'claude-code',
        operationId: 'op-1',
        reason: 'success',
        sessionId: 'cc-session-abc',
      });
    });

    it('forwards classified error details when the run failed', async () => {
      const { published, service } = createService();

      await service.heteroFinish({
        agentType: 'codex',
        error: { message: 'auth required', type: 'AuthRequired' },
        operationId: 'op-2',
        result: 'error',
        topicId: 'topic-2',
      });

      expect(published[0].event.data).toMatchObject({
        agentType: 'codex',
        error: { message: 'auth required', type: 'AuthRequired' },
        reason: 'error',
      });
      expect(published[0].event.data.sessionId).toBeUndefined();
    });

    it('handles cancelled runs and runs without sessionId', async () => {
      const { published, service } = createService();

      await service.heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-3',
        result: 'cancelled',
        topicId: 'topic-3',
      });

      expect(published[0].event.data).toMatchObject({
        operationId: 'op-3',
        reason: 'cancelled',
      });
    });

    // The unified terminal funnel: heteroFinish must drive the run's lifecycle
    // hooks through the shared hookDispatcher (the same mechanism the normal LLM
    // path uses), which is what marks the owning task done/failed and fires any
    // IM bot completion callback. These register a local-mode handler hook for
    // the operation and assert heteroFinish dispatches it.
    const registerHook = (operationId: string): { onComplete: any; onError: any } => {
      const onComplete = vi.fn(async () => {});
      const onError = vi.fn(async () => {});
      const hooks: AgentHook[] = [
        { handler: onComplete, id: 'task-on-complete', type: 'onComplete' },
        { handler: onError, id: 'task-on-error', type: 'onError' },
      ];
      hookDispatcher.register(operationId, hooks);
      return { onComplete, onError };
    };

    it('fires onComplete (reason=done) hooks on a successful run', async () => {
      const { service } = createService();
      const { onComplete, onError } = registerHook('op-hook-success');

      await service.heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-hook-success',
        result: 'success',
        topicId: 'topic-hook-1',
      });

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete.mock.calls[0][0]).toMatchObject({
        operationId: 'op-hook-success',
        reason: 'done',
      });
      expect(onError).not.toHaveBeenCalled();
      // Hooks are unregistered after dispatch so a replay can't double-fire.
      expect(hookDispatcher.hasHooks('op-hook-success')).toBe(false);
    });

    it('fires both onComplete and onError (reason=error) hooks on a failed run', async () => {
      const { service } = createService();
      const { onComplete, onError } = registerHook('op-hook-error');

      await service.heteroFinish({
        agentType: 'codex',
        error: { message: 'auth required', type: 'AuthRequired' },
        operationId: 'op-hook-error',
        result: 'error',
        topicId: 'topic-hook-2',
      });

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toMatchObject({
        errorMessage: 'auth required',
        errorType: 'AuthRequired',
        operationId: 'op-hook-error',
        reason: 'error',
      });
    });

    // Verify-lifecycle alignment: heteroFinish must route the terminal transition
    // through CompletionLifecycle (the SAME owner the in-process runtime uses), not
    // a stripped-down funnel. That single funnel is what runs the delivery-checker
    // gate on success — and the gate bails unless op.model/provider are set, so the
    // synthetic state MUST carry the model/provider backfilled from the CLI stream.
    it('routes the terminal transition through CompletionLifecycle with backfilled model/provider', async () => {
      const { service } = createService();

      const finalizeSpy = vi.spyOn(HeteroTraceRecorder.prototype, 'finalize').mockResolvedValue({
        llmCalls: 3,
        model: 'claude-opus-4-8',
        provider: 'anthropic',
        stepCount: 5,
        toolCalls: 2,
        totalCost: 0.12,
        totalInputTokens: 100,
        totalOutputTokens: 200,
        totalTokens: 300,
        traceS3Key: 'trace-key',
      } as any);
      const dispatchSpy = vi
        .spyOn(CompletionLifecycle.prototype, 'dispatchHooks')
        .mockResolvedValue();

      await service.heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-verify-align',
        result: 'success',
        topicId: 'topic-verify-align',
      });

      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      const [opId, state, reason] = dispatchSpy.mock.calls[0] as [string, any, string];
      expect(opId).toBe('op-verify-align');
      expect(reason).toBe('done');
      // model/provider gate the verify run (lifecycle.ts bails when either is absent).
      expect(state).toMatchObject({ model: 'claude-opus-4-8', provider: 'anthropic' });
      // Trace aggregates flow into the shape persistCompletion reads.
      expect(state.usage?.llm?.tokens?.total).toBe(300);
      // Synthetic goal + deliverable messages drive the delivery checker.
      expect(state.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'user' }),
          expect.objectContaining({ role: 'assistant' }),
        ]),
      );

      finalizeSpy.mockRestore();
      dispatchSpy.mockRestore();
    });

    // Cross-instance race guard: recordStart's in-memory verify-plan promise lives
    // on a DIFFERENT CompletionLifecycle (execAgent), so heteroFinish can't await
    // it. A fast run could reach the gate before the plan persists. heteroFinish
    // must therefore re-run the idempotent durable instantiation and AWAIT it
    // before dispatching the gate.
    it('awaits durable verify-plan instantiation before the completion gate for a task-bound run', async () => {
      const { service } = createService();

      const findByIdSpy = vi
        .spyOn(AgentOperationModel.prototype, 'findById')
        .mockResolvedValue({ parentOperationId: null, taskId: 'task-1' } as any);
      const instantiateSpy = vi
        .spyOn(verifyService, 'instantiateVerifyPlanOnStart')
        .mockResolvedValue();
      const dispatchSpy = vi
        .spyOn(CompletionLifecycle.prototype, 'dispatchHooks')
        .mockResolvedValue();

      await service.heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-race-guard',
        result: 'success',
        topicId: 'topic-race-guard',
      });

      expect(instantiateSpy).toHaveBeenCalledTimes(1);
      // Ensured with the run's own task id (3rd arg is the params object).
      expect(instantiateSpy.mock.calls[0][2]).toMatchObject({
        operationId: 'op-race-guard',
        taskId: 'task-1',
      });
      // The durable ensure is awaited BEFORE the gate — otherwise
      // runVerifyOnCompletion could read an empty plan and skip verify.
      expect(instantiateSpy.mock.invocationCallOrder[0]).toBeLessThan(
        dispatchSpy.mock.invocationCallOrder[0],
      );

      findByIdSpy.mockRestore();
      instantiateSpy.mockRestore();
      dispatchSpy.mockRestore();
    });

    it('skips verify-plan instantiation for a non-task hetero run', async () => {
      const { service } = createService();

      const findByIdSpy = vi
        .spyOn(AgentOperationModel.prototype, 'findById')
        .mockResolvedValue({ parentOperationId: null, taskId: null } as any);
      const instantiateSpy = vi
        .spyOn(verifyService, 'instantiateVerifyPlanOnStart')
        .mockResolvedValue();
      const dispatchSpy = vi
        .spyOn(CompletionLifecycle.prototype, 'dispatchHooks')
        .mockResolvedValue();

      await service.heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-no-task',
        result: 'success',
        topicId: 'topic-no-task',
      });

      expect(instantiateSpy).not.toHaveBeenCalled();
      // Still routes through the lifecycle — verify just has nothing to gate on.
      expect(dispatchSpy).toHaveBeenCalledTimes(1);

      findByIdSpy.mockRestore();
      instantiateSpy.mockRestore();
      dispatchSpy.mockRestore();
    });

    it('does NOT fire hooks on a cancelled run (the real result fires them)', async () => {
      const { service } = createService();
      const { onComplete, onError } = registerHook('op-hook-cancelled');

      await service.heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-hook-cancelled',
        result: 'cancelled',
        topicId: 'topic-hook-3',
      });

      expect(onComplete).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      // Still registered — the subsequent success/error call will dispatch them.
      expect(hookDispatcher.hasHooks('op-hook-cancelled')).toBe(true);
      hookDispatcher.unregister('op-hook-cancelled');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The hetero terminal funnel in PRODUCTION (queue) mode. This is the path the
  // device/sandbox runs actually take: execAgent (process A) serializes the run's
  // lifecycle hooks onto `topic.metadata.runningOperation.hooks`; heteroFinish
  // (process B — the device callback / CLI exit, a different Lambda) reads them
  // back and must deliver each webhook. There is NO in-memory handler to fall
  // back on across that process boundary, so the in-memory-handler tests above
  // (which run in local mode) never exercise it. This guards the
  // read(runningOperation.hooks) → dispatch → deliverWebhook round-trip — the
  // link that, if broken, leaves a finished hetero task's `task_topics.status`
  // stuck at `running` because `onTopicComplete` never fires.
  describe('heteroFinish — queue-mode terminal webhook delivery (regression guard)', () => {
    const originalToken = process.env.QSTASH_TOKEN;
    const originalAppUrl = process.env.APP_URL;

    const taskHook: SerializedHook = {
      id: 'task-on-complete',
      type: 'onComplete',
      webhook: {
        body: { taskId: 'task_q', taskIdentifier: 'T-Q', userId: 'user-test' },
        delivery: 'qstash',
        url: '/api/workflows/task/on-topic-complete',
      },
    };

    const makeService = (hooks: SerializedHook[] | undefined) => {
      const topicModel = {
        // Mirror what execAgent persisted at dispatch: the serialized hooks live
        // under runningOperation. heteroFinish must read them from here.
        findById: vi.fn(async () => ({
          id: 'topic-q',
          metadata: { runningOperation: { hooks, operationId: 'op-q' } },
        })),
        updateMetadata: vi.fn(async () => {}),
      } as any;
      const { manager } = createFakeStreamManager();
      const service = new HeterogeneousAgentService({} as any, 'user-test', {
        persistenceHandler: createFakePersistenceHandler(),
        snapshotStore: null,
        streamEventManager: manager,
        topicModel,
      });
      return { service, topicModel };
    };

    beforeEach(() => {
      vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(true);
      mockPublishJSON.mockReset();
      mockPublishJSON.mockResolvedValue(undefined);
      process.env.QSTASH_TOKEN = 'test-token';
      process.env.APP_URL = 'https://app.test';
    });

    afterEach(() => {
      vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(false);
      if (originalToken === undefined) delete process.env.QSTASH_TOKEN;
      else process.env.QSTASH_TOKEN = originalToken;
      if (originalAppUrl === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = originalAppUrl;
    });

    it('delivers the task-on-complete webhook read from runningOperation.hooks (reason=done)', async () => {
      const { service } = makeService([taskHook]);

      await service.heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-q',
        result: 'success',
        topicId: 'topic-q',
      });

      expect(mockPublishJSON).toHaveBeenCalledTimes(1);
      const arg = mockPublishJSON.mock.calls[0][0];
      expect(arg.url).toContain('/api/workflows/task/on-topic-complete');
      expect(arg.body).toMatchObject({
        hookId: 'task-on-complete',
        hookType: 'onComplete',
        reason: 'done',
        taskId: 'task_q',
        topicId: 'topic-q',
      });
    });

    it('negative control: delivers nothing when runningOperation.hooks is empty', async () => {
      const { service } = makeService([]);

      await service.heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-q',
        result: 'success',
        topicId: 'topic-q',
      });

      expect(mockPublishJSON).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // End-to-end DATA-FLOW reproduction of the runtime path: seed the run's hooks
  // the way execAgent does (real hookDispatcher.register → getSerializedHooks →
  // persist onto runningOperation via a shared in-memory topic store with REAL
  // shallow-merge semantics), then run the REAL heteroFinish against the SAME
  // store. This exercises the cross-process round-trip the isolated unit tests
  // hand-wave, and lets us reproduce the production "stuck task_topics" symptom
  // by injecting the suspected lost-update race on topic.metadata.
  describe('heteroFinish — seed→read→deliver round-trip + lost-update repro', () => {
    const originalToken = process.env.QSTASH_TOKEN;
    const originalAppUrl = process.env.APP_URL;
    const TOPIC = 'topic-int';

    // The exact hook taskRunner attaches: a handler (local) PLUS a qstash webhook.
    const taskHook: AgentHook = {
      handler: async () => {},
      id: 'task-on-complete',
      type: 'onComplete',
      webhook: {
        body: { taskId: 'task_x', taskIdentifier: 'T-X', userId: 'user-test' },
        delivery: 'qstash',
        url: '/api/workflows/task/on-topic-complete',
      },
    };

    // Shared topic store whose updateMetadata mirrors TopicModel.updateMetadata:
    // a non-atomic read-modify-write that shallow-merges the patch over a
    // snapshot. `mergeBase` lets a test force the "read a stale snapshot" race.
    const makeStore = () => {
      let meta: Record<string, any> = {};
      const topicModel = {
        findById: vi.fn(async () => ({ id: TOPIC, metadata: meta })),
        updateMetadata: vi.fn(async (_id: string, patch: Record<string, any>, mergeBase?: any) => {
          meta = { ...(mergeBase ?? meta), ...patch };
        }),
      } as any;
      return { get: () => meta, topicModel };
    };

    // Reproduce execAgent's seed step exactly.
    const seed = (store: ReturnType<typeof makeStore>, operationId: string) => {
      hookDispatcher.register(operationId, [taskHook]);
      const serializedHooks = hookDispatcher.getSerializedHooks(operationId);
      return store.topicModel.updateMetadata(TOPIC, {
        runningOperation: { assistantMessageId: 'asst-1', hooks: serializedHooks, operationId },
      });
    };

    const makeService = (store: ReturnType<typeof makeStore>) =>
      new HeterogeneousAgentService({} as any, 'user-test', {
        persistenceHandler: createFakePersistenceHandler(),
        snapshotStore: null,
        streamEventManager: createFakeStreamManager().manager,
        topicModel: store.topicModel,
      });

    beforeEach(() => {
      vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(true);
      mockPublishJSON.mockReset();
      mockPublishJSON.mockResolvedValue(undefined);
      process.env.QSTASH_TOKEN = 'test-token';
      process.env.APP_URL = 'https://app.test';
    });

    afterEach(() => {
      vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(false);
      hookDispatcher.unregister('op-int');
      if (originalToken === undefined) delete process.env.QSTASH_TOKEN;
      else process.env.QSTASH_TOKEN = originalToken;
      if (originalAppUrl === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = originalAppUrl;
    });

    it('happy path: a fresh-read heteroIngest write preserves hooks → heteroFinish delivers', async () => {
      const store = makeStore();
      await seed(store, 'op-int');

      // A normal mid-run ingest write reads the CURRENT snapshot, so the
      // shallow-merge keeps runningOperation intact.
      await store.topicModel.updateMetadata(TOPIC, {
        heteroCurrentMsgId: { msgId: 'm1', operationId: 'op-int' },
      });
      expect(store.get().runningOperation?.hooks).toHaveLength(1);

      // heteroFinish runs in a DIFFERENT process/Lambda than execAgent, so the
      // in-memory hookDispatcher has nothing for this op — it relies purely on
      // the serialized hooks read from runningOperation. Drop the in-memory
      // registration to model that boundary faithfully.
      hookDispatcher.unregister('op-int');

      await makeService(store).heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-int',
        result: 'success',
        topicId: TOPIC,
      });

      expect(mockPublishJSON).toHaveBeenCalledTimes(1);
      expect(mockPublishJSON.mock.calls[0][0].url).toContain(
        '/api/workflows/task/on-topic-complete',
      );
    });

    it('REPRO: a stale-read ingest write clobbers runningOperation.hooks → heteroFinish delivers nothing (the stuck-task symptom)', async () => {
      const store = makeStore();
      // Snapshot BEFORE the seed commits — what a racing reader would have seen.
      const preSeedSnapshot = { ...store.get() };
      await seed(store, 'op-int');
      expect(store.get().runningOperation?.hooks).toHaveLength(1);

      // A concurrent heteroIngest whose read-modify-write started from the
      // pre-seed snapshot (replica lag / interleave): merging its patch over the
      // STALE base drops runningOperation entirely — a classic lost update.
      await store.topicModel.updateMetadata(
        TOPIC,
        { heteroCurrentMsgId: { msgId: 'm1', operationId: 'op-int' } },
        preSeedSnapshot,
      );
      expect(store.get().runningOperation).toBeUndefined();

      // Model the process boundary: heteroFinish's in-memory dispatcher is empty,
      // so the clobbered runningOperation is its ONLY source of the hook.
      hookDispatcher.unregister('op-int');

      await makeService(store).heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-int',
        result: 'success',
        topicId: TOPIC,
      });

      // Exactly the production failure: the run finished, but the terminal hook
      // had nothing to deliver, so onTopicComplete never fires and the task
      // topic is stranded at `running`.
      expect(mockPublishJSON).not.toHaveBeenCalled();
    });
  });
});
