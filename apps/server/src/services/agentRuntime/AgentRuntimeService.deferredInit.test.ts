/**
 * @vitest-environment node
 */
import type * as ModelBankModule from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRuntimeService } from './AgentRuntimeService';
import { hookDispatcher } from './hooks';
import { type AgentExecutionParams } from './types';

vi.mock('@lobechat/model-runtime', () => ({
  // RuntimeExecutors (loaded transitively) resolves extend params via this
  // helper; an empty result keeps the runtime payload unchanged.
  applyModelExtendParams: vi.fn(function () {
    return {};
  }),
  getModelPropertyWithFallback: vi.fn(),
  // `llmErrorClassification.ts` reads these at module-load time; an empty
  // spec map is fine here because this suite never exercises the runtime
  // retry classifier path.
  ERROR_CODE_SPECS: {},
  getErrorCodeSpec: () => undefined,
  refineErrorCode: () => undefined,
}));

const { ssrfSafeFetch: mockSsrfSafeFetch } = vi.hoisted(() => ({ ssrfSafeFetch: vi.fn() }));
vi.mock('@lobechat/ssrf-safe-fetch', () => ({ ssrfSafeFetch: mockSsrfSafeFetch }));

// Mock trusted client to avoid server-side env access
vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

// Mock database and models
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return {
      getFullFileUrl: vi.fn(async (path: string) => `model:${path}`),
      getFileAccessUrl: vi.fn(async (file: { id: string }) => `ui:${file.id}`),
    };
  }),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(function () {
    return {
      findById: vi.fn().mockResolvedValue(undefined),
      findMessagePlugin: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(function () {
    return {
      getAgentConfigById: vi.fn(),
    };
  }),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(function () {
    return {
      query: vi.fn().mockResolvedValue([]),
    };
  }),
}));

// Mock ModelRuntime to avoid server-side env access
vi.mock('@/server/modules/ModelRuntime', () => ({
  initializeRuntimeOptions: vi.fn(),
  ApiKeyManager: vi.fn().mockImplementation(function () {
    return {
      getApiKey: vi.fn(),
      getAllApiKeys: vi.fn(),
    };
  }),
}));

// Mock search service to avoid server-side env access
vi.mock('@/server/services/search', () => ({
  SearchService: vi.fn().mockImplementation(function () {
    return {
      search: vi.fn(),
    };
  }),
  searchService: {
    search: vi.fn(),
  },
}));

// Mock factory and redis dependencies to break env import chains,
// so the barrel can be imported with real AgentRuntimeCoordinator + InMemory backends
vi.mock('@/server/modules/AgentRuntime/factory', async () => {
  const { InMemoryAgentStateManager } =
    await import('@/server/modules/AgentRuntime/InMemoryAgentStateManager');
  const { InMemoryStreamEventManager } =
    await import('@/server/modules/AgentRuntime/InMemoryStreamEventManager');
  return {
    createAgentStateManager: () => new InMemoryAgentStateManager(),
    createStreamEventManager: () => new InMemoryStreamEventManager(),
    isRedisAvailable: () => false,
  };
});

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  createAgentRuntimeRedisClient: vi.fn().mockReturnValue(null),
  getAgentRuntimeRedisClient: vi.fn().mockReturnValue(null),
}));

// Use real AgentRuntimeCoordinator with InMemory backends; only mock unrelated exports
vi.mock('@/server/modules/AgentRuntime', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createRuntimeExecutors: vi.fn(),
  };
});

// Spread the real module and override only `AgentRuntime` (to stub `.step()`).
// Keeps the real status predicates + package-hosted executors (e.g. `finish`),
// so this mock survives future executor migrations without edits.
vi.mock('@lobechat/agent-runtime', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  AgentRuntime: vi.fn().mockImplementation(function (_agent, _options) {
    return {
      step: vi.fn(),
    };
  }),
}));

vi.mock('@/server/services/queue', () => ({
  QueueService: vi.fn().mockImplementation(function () {
    return {
      getImpl: vi.fn().mockReturnValue(null),
      scheduleMessage: vi.fn(),
    };
  }),
}));

// Mock Mecha module
vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({
      tools: [],
      enabledToolIds: [],
      filteredTools: [],
    }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
  serverMessagesEngine: vi.fn().mockResolvedValue([]),
}));

// Mock model-bank
vi.mock('model-bank', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelBankModule>();
  return {
    ...actual,
    LOBE_DEFAULT_MODEL_LIST: [
      {
        id: 'gpt-4o-mini',
        providerId: 'openai',
        abilities: {
          functionCall: true,
          vision: true,
          video: false,
        },
      },
    ],
  };
});
describe('AgentRuntimeService executeStep', () => {
  const mockDb: any = { delete: vi.fn(), insert: vi.fn(), select: vi.fn(), update: vi.fn() };
  const mockUserId = 'test-user-id';

  const mockParams: AgentExecutionParams = {
    operationId: 'test-operation-1',
    stepIndex: 1,
    context: {
      phase: 'user_input',
      payload: {
        message: { content: 'test' },
        sessionId: 'test-operation-1',
        isFirstMessage: false,
      },
      session: {
        sessionId: 'test-operation-1',
        status: 'running',
        stepCount: 1,
        messageCount: 1,
      },
    },
  };

  const mockState = {
    operationId: 'test-operation-1',
    status: 'running',
    stepCount: 1,
    messages: [],
    events: [],
    lastModified: new Date().toISOString(),
  };

  const mockMetadata = {
    userId: 'user-123',
    agentConfig: { name: 'test-agent' },
    modelRuntimeConfig: { model: 'gpt-4' },
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    status: 'running',
    totalCost: 0,
    totalSteps: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENT_RUNTIME_BASE_URL = 'http://localhost:3010';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.AGENT_RUNTIME_BASE_URL;
    hookDispatcher.unregister('test-operation-1');
  });

  // A run created without its init (`host.init`) has to get discovery and the
  // context assembly done here, before anything is published — the whole point
  // of returning from the send path early.
  describe('deferred init', () => {
    const pendingState = () => ({
      ...mockState,
      host: {
        init: { envelope: { request: { operationId: 'test-operation-1' } }, pending: true },
      },
      messages: [],
      origin: { agentId: 'agent-1', topicId: 'topic-1' },
      // The turn's ask still on the state = the init has not run yet.
      request: { approvedToolEntries: [], selectedToolIds: ['lobe-web-browsing'] },
      stepCount: 0,
    });

    const buildService = (runDeferredInit: any) =>
      new AgentRuntimeService(mockDb, mockUserId, { delegate: { runDeferredInit } });

    const wireStep = (svc: AgentRuntimeService) => {
      const step = vi.fn().mockImplementation(async (input) => ({
        events: [],
        newState: { ...input, stepCount: 2 },
        nextContext: mockParams.context,
      }));
      vi.spyOn(svc as any, 'createAgentRuntime').mockResolvedValue({ runtime: { step } });
      vi.spyOn((svc as any).messageService, 'prepareUiMessages').mockResolvedValue([]);
      (svc as any).messageModel.query = vi.fn().mockResolvedValue([]);
      const coordinator = (svc as any).coordinator;
      for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(coordinator))) {
        if (key !== 'constructor' && typeof coordinator[key] === 'function') {
          vi.spyOn(coordinator, key);
        }
      }
      coordinator.loadAgentState.mockResolvedValue(pendingState());
      coordinator.getOperationMetadata.mockResolvedValue(mockMetadata);
      return { coordinator, step };
    };

    it('runs the init, saves what it produced, and steps on the initialized state', async () => {
      const initContext = { phase: 'user_input', payload: { assembled: true } };
      const runDeferredInit = vi.fn().mockResolvedValue({
        context: initContext,
        state: {
          operationToolSet: { enabledToolIds: ['lobe-web-browsing'] },
          world: { agent: { systemRole: 'ready' } },
        },
      });
      const svc = buildService(runDeferredInit);
      const { coordinator, step } = wireStep(svc);

      await svc.executeStep({ ...mockParams, stepIndex: 0 });

      expect(runDeferredInit).toHaveBeenCalledTimes(1);
      expect(runDeferredInit.mock.calls[0][0]).toMatchObject({
        operationId: 'test-operation-1',
        request: { selectedToolIds: ['lobe-web-browsing'] },
      });
      // Durable before the step runs, and the marker is gone so a retry of
      // this delivery cannot pay for discovery twice.
      const saved = coordinator.saveAgentState.mock.calls[0][1];
      expect(saved.operationToolSet).toEqual({ enabledToolIds: ['lobe-web-browsing'] });
      expect(saved.request).toBeUndefined();
      expect(saved.initialContext).toEqual(initContext);
      // The exit: the step sees the initialized state, not the thin one.
      expect(step.mock.calls[0][0].operationToolSet).toEqual({
        enabledToolIds: ['lobe-web-browsing'],
      });
      // ...and the context the init assembled, not the placeholder queued
      // before the init existed.
      expect(step.mock.calls[0][1]).toEqual(initContext);
    });

    // The worker can die after saving the init but before the step runs. The
    // redelivery finds the request gone — and must still start from the
    // context the init assembled, not the placeholder it was queued with.
    it('starts a redelivered step 0 from the context the init saved', async () => {
      const runDeferredInit = vi.fn();
      const svc = buildService(runDeferredInit);
      const { coordinator, step } = wireStep(svc);
      const assembled = { phase: 'user_input', payload: { assembled: true } };
      const { request: _request, ...initialized } = pendingState();
      coordinator.loadAgentState.mockResolvedValue({ ...initialized, initialContext: assembled });

      await svc.executeStep({ ...mockParams, stepIndex: 0 });

      expect(runDeferredInit).not.toHaveBeenCalled();
      expect(step.mock.calls[0][1]).toEqual(assembled);
    });

    it('skips the init when the run was already stopped, and still settles it', async () => {
      const runDeferredInit = vi.fn();
      const svc = buildService(runDeferredInit);
      const { coordinator, step } = wireStep(svc);
      coordinator.isInterrupted.mockResolvedValue(true);
      const lifecycle = (svc as any).completionLifecycle;
      const emit = vi.spyOn(lifecycle, 'emitSignalEvents').mockResolvedValue([]);
      const dispatch = vi.spyOn(lifecycle, 'dispatchHooks').mockResolvedValue(undefined);
      const publish = vi.spyOn((svc as any).streamManager, 'publishStreamEvent');

      const result = await svc.executeStep({ ...mockParams, stepIndex: 0 });

      // Persisting the stop already published `agent_runtime_end`: no step
      // event may follow it.
      expect(publish).not.toHaveBeenCalledWith(
        'test-operation-1',
        expect.objectContaining({ type: 'step_start' }),
      );

      expect(result.success).toBe(true);
      expect(runDeferredInit).not.toHaveBeenCalled();
      expect(step).not.toHaveBeenCalled();
      // The completion consumers (and the durable row) hear about the stop.
      expect(emit).toHaveBeenCalledWith('test-operation-1', expect.anything(), 'interrupted');
      expect(dispatch).toHaveBeenCalledWith('test-operation-1', expect.anything(), 'interrupted');
      // The interrupt may have landed only its sentinel: the runtime state has
      // to be written too, or Redis keeps reading `running` forever.
      expect(coordinator.saveAgentState).toHaveBeenCalledWith(
        'test-operation-1',
        expect.objectContaining({ status: 'interrupted' }),
      );
    });

    // Stop finished both writes before the worker loaded the state: it is
    // already `interrupted` but still carries its request. The stop's own save
    // published `agent_runtime_end`, so this delivery may publish no step
    // event and must not persist the stop a second time.
    it('settles a stop that was fully persisted before the init, without a step_start', async () => {
      const runDeferredInit = vi.fn();
      const svc = buildService(runDeferredInit);
      const { coordinator, step } = wireStep(svc);
      coordinator.loadAgentState.mockResolvedValue({ ...pendingState(), status: 'interrupted' });
      const lifecycle = (svc as any).completionLifecycle;
      const emit = vi.spyOn(lifecycle, 'emitSignalEvents').mockResolvedValue([]);
      const dispatch = vi.spyOn(lifecycle, 'dispatchHooks').mockResolvedValue(undefined);
      const publish = vi.spyOn((svc as any).streamManager, 'publishStreamEvent');

      const result = await svc.executeStep({ ...mockParams, stepIndex: 0 });

      expect(result.success).toBe(true);
      expect(publish).not.toHaveBeenCalledWith(
        'test-operation-1',
        expect.objectContaining({ type: 'step_start' }),
      );
      expect(runDeferredInit).not.toHaveBeenCalled();
      expect(step).not.toHaveBeenCalled();
      expect(coordinator.saveAgentState).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith('test-operation-1', expect.anything(), 'interrupted');
      expect(dispatch).toHaveBeenCalledWith('test-operation-1', expect.anything(), 'interrupted');
    });

    it('discards the init result when Stop lands while the init runs', async () => {
      const runDeferredInit = vi.fn().mockResolvedValue({
        context: { phase: 'user_input', payload: {} },
        state: { operationToolSet: { enabledToolIds: ['lobe-web-browsing'] } },
      });
      const svc = buildService(runDeferredInit);
      const { coordinator, step } = wireStep(svc);
      coordinator.isInterrupted.mockResolvedValueOnce(false).mockResolvedValue(true);
      const lifecycle = (svc as any).completionLifecycle;
      vi.spyOn(lifecycle, 'emitSignalEvents').mockResolvedValue([]);
      vi.spyOn(lifecycle, 'dispatchHooks').mockResolvedValue(undefined);
      const publish = vi.spyOn((svc as any).streamManager, 'publishStreamEvent');

      await svc.executeStep({ ...mockParams, stepIndex: 0 });

      expect(runDeferredInit).toHaveBeenCalledTimes(1);
      expect(step).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalledWith(
        'test-operation-1',
        expect.objectContaining({ type: 'step_start' }),
      );
      // Nothing wrote the pre-init `running` state back over the stop.
      for (const [, saved] of coordinator.saveAgentState.mock.calls) {
        expect(saved.status).toBe('interrupted');
        expect(saved.operationToolSet).toBeUndefined();
      }
    });

    // Stop can land after the post-init checks but before the init's save,
    // which then overwrites the interrupted state with `running`. The stop
    // already published `agent_runtime_end`, so the save must be undone and
    // no step event may follow.
    it('restores a stop that landed while the init result was being saved', async () => {
      const runDeferredInit = vi.fn().mockResolvedValue({
        context: { phase: 'user_input', payload: {} },
        state: { operationToolSet: { enabledToolIds: ['lobe-web-browsing'] } },
      });
      const svc = buildService(runDeferredInit);
      const { coordinator, step } = wireStep(svc);
      // Clear before the init and at the post-init check; set right after the save.
      coordinator.isInterrupted
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true);
      vi.spyOn((svc as any).agentOperationModel, 'findById').mockResolvedValue({
        id: 'test-operation-1',
        status: 'running',
      });
      const lifecycle = (svc as any).completionLifecycle;
      vi.spyOn(lifecycle, 'emitSignalEvents').mockResolvedValue([]);
      const dispatch = vi.spyOn(lifecycle, 'dispatchHooks').mockResolvedValue(undefined);
      const publish = vi.spyOn((svc as any).streamManager, 'publishStreamEvent');

      const result = await svc.executeStep({ ...mockParams, stepIndex: 0 });

      expect(result.success).toBe(true);
      expect(step).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalledWith(
        'test-operation-1',
        expect.objectContaining({ type: 'step_start' }),
      );
      // The last write leaves the run interrupted, not `running`.
      const saves = coordinator.saveAgentState.mock.calls;
      expect(saves.at(-1)[1]).toMatchObject({ status: 'interrupted' });
      expect(dispatch).toHaveBeenCalledWith('test-operation-1', expect.anything(), 'interrupted');
    });

    // The init can outlive the inactivity watchdog. Abandonment settles the
    // run itself and may delete the runtime state; this worker must not save
    // its stale `running` snapshot back and step on it.
    describe('when the run is abandoned while the init runs', () => {
      const runAbandonedDuringInit = async (
        arrange: (ctx: { coordinator: any; findById: any }) => void,
      ) => {
        const runDeferredInit = vi.fn().mockResolvedValue({
          context: { phase: 'user_input', payload: {} },
          state: { operationToolSet: { enabledToolIds: ['lobe-web-browsing'] } },
        });
        const svc = buildService(runDeferredInit);
        const { coordinator, step } = wireStep(svc);
        coordinator.isInterrupted.mockResolvedValue(false);
        const findById = vi
          .spyOn((svc as any).agentOperationModel, 'findById')
          .mockResolvedValue({ id: 'test-operation-1', status: 'running' });
        arrange({ coordinator, findById });
        const publish = vi.spyOn((svc as any).streamManager, 'publishStreamEvent');

        const result = await svc.executeStep({ ...mockParams, stepIndex: 0 });

        expect(runDeferredInit).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ nextStepScheduled: false, success: true });
        expect(coordinator.saveAgentState).not.toHaveBeenCalled();
        expect(step).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalledWith(
          'test-operation-1',
          expect.objectContaining({ type: 'step_start' }),
        );
      };

      it('discards the init result when the runtime state was deleted', async () => {
        await runAbandonedDuringInit(({ coordinator }) => {
          coordinator.loadAgentState.mockResolvedValueOnce(pendingState()).mockResolvedValue(null);
        });
      });

      it('discards the init result when the durable row turned terminal', async () => {
        await runAbandonedDuringInit(({ findById }) => {
          findById
            .mockResolvedValueOnce({ id: 'test-operation-1', status: 'running' })
            .mockResolvedValue({ id: 'test-operation-1', status: 'error' });
        });
      });
    });

    it('does not initialize a shared run whose share was revoked after enqueue', async () => {
      const runDeferredInit = vi.fn();
      const verifyShareRunStillAuthorized = vi.fn().mockResolvedValue(false);
      const svc = new AgentRuntimeService(mockDb, mockUserId, {
        delegate: { runDeferredInit, verifyShareRunStillAuthorized },
      });
      const { coordinator, step } = wireStep(svc);
      coordinator.loadAgentState.mockResolvedValue({
        ...pendingState(),
        principal: { actor: { shareVisitor: { agentId: 'agent-1', shareId: 'share-1' } } },
      });
      vi.spyOn(svc as any, 'buildShareAbortResult').mockResolvedValue({ success: true });

      await svc.executeStep({ ...mockParams, stepIndex: 0 });

      expect(verifyShareRunStillAuthorized).toHaveBeenCalled();
      expect(runDeferredInit).not.toHaveBeenCalled();
      expect(step).not.toHaveBeenCalled();
    });

    it('fails the step when the init throws instead of stepping on a thin state', async () => {
      const runDeferredInit = vi.fn().mockRejectedValue(new Error('discovery exploded'));
      const svc = buildService(runDeferredInit);
      const { step } = wireStep(svc);

      await expect(svc.executeStep({ ...mockParams, stepIndex: 0 })).rejects.toThrow(
        'discovery exploded',
      );
      expect(step).not.toHaveBeenCalled();
    });

    it('refuses to run when no runner is wired', async () => {
      const svc = buildService(undefined);
      const { step } = wireStep(svc);

      await expect(svc.executeStep({ ...mockParams, stepIndex: 0 })).rejects.toThrow(
        /no runner is wired/,
      );
      expect(step).not.toHaveBeenCalled();
    });
  });
});
