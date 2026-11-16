/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hookDispatcher } from '../../hooks';
import { type AgentExecutionParams } from '../../types';
import { AgentRuntimeService } from '..';
import { stubRunningDurableOperation } from './testUtils';

vi.mock('@lobechat/model-runtime', (...args) =>
  import('./testUtils').then((m) =>
    (m.lobechatModelRuntimeModule as (...a: any[]) => any)(...args),
  ),
);

const { ssrfSafeFetch: mockSsrfSafeFetch } = vi.hoisted(() => ({ ssrfSafeFetch: vi.fn() }));

vi.mock('@lobechat/ssrf-safe-fetch', () => ({ ssrfSafeFetch: mockSsrfSafeFetch }));

// Mock trusted client to avoid server-side env access
vi.mock('@/libs/trusted-client', (...args) =>
  import('./testUtils').then((m) => (m.libsTrustedClientModule as (...a: any[]) => any)(...args)),
);

// Mock database and models
vi.mock('@/server/services/file', (...args) =>
  import('./testUtils').then((m) => (m.serverServicesFileModule as (...a: any[]) => any)(...args)),
);

vi.mock('@/database/models/message', (...args) =>
  import('./testUtils').then((m) =>
    (m.databaseModelsMessageModule as (...a: any[]) => any)(...args),
  ),
);

vi.mock('@/database/models/agent', (...args) =>
  import('./testUtils').then((m) => (m.databaseModelsAgentModule as (...a: any[]) => any)(...args)),
);

vi.mock('@/database/models/plugin', (...args) =>
  import('./testUtils').then((m) =>
    (m.databaseModelsPluginModule as (...a: any[]) => any)(...args),
  ),
);

// Mock ModelRuntime to avoid server-side env access
vi.mock('@/server/modules/ModelRuntime', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverModulesModelRuntimeModule as (...a: any[]) => any)(...args),
  ),
);

// Mock search service to avoid server-side env access
vi.mock('@/server/services/search', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverServicesSearchModule as (...a: any[]) => any)(...args),
  ),
);

// Mock factory and redis dependencies to break env import chains,
// so the barrel can be imported with real AgentRuntimeCoordinator + InMemory backends
vi.mock('@/server/modules/AgentRuntime/factory', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverModulesAgentRuntimeFactoryModule as (...a: any[]) => any)(...args),
  ),
);

vi.mock('@/server/modules/AgentRuntime/redis', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverModulesAgentRuntimeRedisModule as (...a: any[]) => any)(...args),
  ),
);

// Use real AgentRuntimeCoordinator with InMemory backends; only mock unrelated exports
vi.mock('@/server/modules/AgentRuntime', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverModulesAgentRuntimeModule as (...a: any[]) => any)(...args),
  ),
);

// Spread the real module and override only `AgentRuntime` (to stub `.step()`).
// Keeps the real status predicates + package-hosted executors (e.g. `finish`),
// so this mock survives future executor migrations without edits.
vi.mock('@lobechat/agent-runtime', (...args) =>
  import('./testUtils').then((m) =>
    (m.lobechatAgentRuntimeModule as (...a: any[]) => any)(...args),
  ),
);

vi.mock('@/server/services/queue', (...args) =>
  import('./testUtils').then((m) => (m.serverServicesQueueModule as (...a: any[]) => any)(...args)),
);

// Mock Mecha module
vi.mock('@/server/modules/Mecha', (...args) =>
  import('./testUtils').then((m) => (m.serverModulesMechaModule as (...a: any[]) => any)(...args)),
);

// Mock model-bank
vi.mock('model-bank', (...args) =>
  import('./testUtils').then((m) => (m.modelBankModule as (...a: any[]) => any)(...args)),
);
// `agent_inline_first_step`: the inline run and its queued fallback both reach
// step 0 through `executeStep`, so what they must share with an ordinary queue
// delivery (the claim, Stop) and what they add (the dispatch record, the
// fallback's marker on a re-queue) is checked here against the real
// coordinator and its in-memory lock.
describe('executeStep for an inline step 0', () => {
  const mockDb: any = { delete: vi.fn(), insert: vi.fn(), select: vi.fn(), update: vi.fn() };
  const operationId = 'test-operation-1';
  const placeholder = { phase: 'user_input', session: { sessionId: operationId, stepCount: 0 } };

  const pendingState = () => ({
    createdAt: new Date(Date.now() - 1500).toISOString(),
    events: [],
    lastModified: new Date().toISOString(),
    messages: [],
    operationId,
    origin: { agentId: 'agent-1', topicId: 'topic-1' },
    request: { approvedToolEntries: [], selectedToolIds: [] },
    status: 'running',
    stepCount: 0,
  });

  const buildService = (options: Record<string, unknown> = {}) => {
    const svc = new AgentRuntimeService(mockDb, 'test-user-id', {
      delegate: { runDeferredInit: vi.fn() },
      ...options,
    } as any);
    const coordinator = (svc as any).coordinator;
    for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(coordinator))) {
      if (key !== 'constructor' && typeof coordinator[key] === 'function') {
        vi.spyOn(coordinator, key);
      }
    }
    coordinator.loadAgentState.mockResolvedValue(pendingState());
    return { coordinator, svc };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    stubRunningDurableOperation();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    hookDispatcher.unregister(operationId);
  });

  it('settles a run stopped before the inline step started, as the queue worker does', async () => {
    const { coordinator, svc } = buildService();
    coordinator.isInterrupted.mockResolvedValue(true);
    const lifecycle = (svc as any).completionLifecycle;
    const dispatch = vi.spyOn(lifecycle, 'dispatchHooks').mockResolvedValue(undefined);
    vi.spyOn(lifecycle, 'emitSignalEvents').mockResolvedValue([]);
    const publish = vi.spyOn((svc as any).streamManager, 'publishStreamEvent');
    const params: AgentExecutionParams = {
      context: placeholder as any,
      firstStepDispatch: 'inline',
      operationId,
      stepIndex: 0,
    };

    const result = await svc.executeStep(params);

    expect(result.success).toBe(true);
    expect(publish).not.toHaveBeenCalledWith(
      operationId,
      expect.objectContaining({ type: 'step_start' }),
    );
    expect(dispatch).toHaveBeenCalledWith(operationId, expect.anything(), 'interrupted');
    expect(coordinator.saveAgentState).toHaveBeenCalledWith(
      operationId,
      expect.objectContaining({ status: 'interrupted' }),
    );
  });

  it('records how the first step was dispatched and how long after creation it started', async () => {
    const { coordinator, svc } = buildService();
    coordinator.isInterrupted.mockResolvedValue(true);
    vi.spyOn((svc as any).completionLifecycle, 'dispatchHooks').mockResolvedValue(undefined);
    vi.spyOn((svc as any).completionLifecycle, 'emitSignalEvents').mockResolvedValue([]);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    await svc.executeStep({ firstStepDispatch: 'inline', operationId, stepIndex: 0 });

    const record = info.mock.calls
      .map(([line]) => {
        try {
          return JSON.parse(String(line));
        } catch {
          return undefined;
        }
      })
      .find((entry) => entry?.event === 'agent.first_step.start');
    expect(record).toMatchObject({ dispatch: 'inline', operationId });
    expect(record.startDelayMs).toBeGreaterThanOrEqual(1500);
  });

  it('is claimed by one worker at a time: the fallback waits behind the inline run', async () => {
    const scheduleMessage = vi.fn().mockResolvedValue('msg-1');
    const { coordinator, svc } = buildService({
      queueService: { getImpl: () => ({}), scheduleMessage },
    });
    // The inline run holds the operation lock for its step loop.
    await coordinator.tryClaimStep(operationId, 0, 120, 'inline-owner');

    const result = await svc.executeStep({
      firstStepDispatch: 'inline_fallback',
      operationId,
      stepIndex: 0,
    });

    expect(result).toMatchObject({ locked: true, lockRescheduled: true });
    // The re-delivery keeps the marker, so once the inline run settles it is
    // acknowledged without running the step again.
    expect(scheduleMessage.mock.calls[0][0]).toMatchObject({
      payload: { inlineFirstStepFallback: true, lockRetryAttempt: 1 },
      stepIndex: 0,
    });
  });

  it('re-queues an ordinary delivery without the marker', async () => {
    const scheduleMessage = vi.fn().mockResolvedValue('msg-1');
    const { coordinator, svc } = buildService({
      queueService: { getImpl: () => ({}), scheduleMessage },
    });
    await coordinator.tryClaimStep(operationId, 0, 120, 'another-owner');

    await svc.executeStep({ operationId, stepIndex: 0 });

    expect(scheduleMessage.mock.calls[0][0].payload.inlineFirstStepFallback).toBeUndefined();
  });
});
