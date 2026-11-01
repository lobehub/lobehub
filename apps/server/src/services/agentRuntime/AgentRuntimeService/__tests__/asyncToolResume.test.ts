/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentOperationModel } from '@/database/models/agentOperation';

import { hookDispatcher } from '../../hooks';
import { AgentRuntimeService } from '..';
import { setUpService } from './testUtils';

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

describe('AgentRuntimeService', () => {
  let service: AgentRuntimeService;
  let mockCoordinator: any;
  let mockQueueService: any;
  const mockUserId = 'test-user-id';

  beforeEach(() => {
    ({ service, mockCoordinator, mockQueueService } = setUpService(
      AgentRuntimeService,
      mockUserId,
    ));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.AGENT_RUNTIME_BASE_URL;
    hookDispatcher.unregister('test-operation-1');
  });

  describe('tryResumeParentFromAsyncTool', () => {
    const parentOpId = 'parent-op-async';

    const fulfilledPlugin = { id: 'msg-tc1', state: { status: 'completed' }, toolCallId: 'tc1' };

    const stubFulfilled = () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        pendingToolsCalling: [{ id: 'tc1' }],
        status: 'waiting_for_async_tool',
        stepCount: 3,
      });
      (service as any).serverDB.query = {
        messagePlugins: { findFirst: vi.fn().mockResolvedValue(fulfilledPlugin) },
      };
      (service as any).messageModel.findById = vi.fn().mockResolvedValue({ content: 'answer' });
    };

    it('wins the CAS and schedules the resume step when all pending tools are fulfilled', async () => {
      stubFulfilled();
      const casSpy = vi
        .spyOn(AgentOperationModel.prototype, 'tryResumeFromAsyncTool')
        .mockResolvedValue(true);

      const won = await service.tryResumeParentFromAsyncTool({ parentOperationId: parentOpId });

      expect(won).toBe(true);
      expect(casSpy).toHaveBeenCalledWith(parentOpId);
      expect(mockQueueService.scheduleMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          operationId: parentOpId,
          payload: { resumeAsyncTool: true },
          priority: 'high',
          stepIndex: 3,
        }),
      );
    });

    it('holds (no CAS, no schedule) when a pending tool is not yet fulfilled', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        pendingToolsCalling: [{ id: 'tc1' }],
        status: 'waiting_for_async_tool',
        stepCount: 1,
      });
      (service as any).serverDB.query = {
        messagePlugins: { findFirst: vi.fn().mockResolvedValue(null) },
      };
      const casSpy = vi.spyOn(AgentOperationModel.prototype, 'tryResumeFromAsyncTool');

      const won = await service.tryResumeParentFromAsyncTool({ parentOperationId: parentOpId });

      expect(won).toBe(false);
      expect(casSpy).not.toHaveBeenCalled();
      expect(mockQueueService.scheduleMessage).not.toHaveBeenCalled();
    });

    it('does not schedule when it loses the CAS to a concurrent sibling', async () => {
      stubFulfilled();
      vi.spyOn(AgentOperationModel.prototype, 'tryResumeFromAsyncTool').mockResolvedValue(false);

      const won = await service.tryResumeParentFromAsyncTool({ parentOperationId: parentOpId });

      expect(won).toBe(false);
      expect(mockQueueService.scheduleMessage).not.toHaveBeenCalled();
    });

    it('skips when the parent is no longer parked', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        pendingToolsCalling: [],
        status: 'running',
        stepCount: 1,
      });
      const casSpy = vi.spyOn(AgentOperationModel.prototype, 'tryResumeFromAsyncTool');

      const won = await service.tryResumeParentFromAsyncTool({ parentOperationId: parentOpId });

      expect(won).toBe(false);
      expect(casSpy).not.toHaveBeenCalled();
    });

    it('arms the first verify (attempt 1, 15s) when the parent has not parked yet and scheduleVerifyOnHold is set', async () => {
      // Child completed before the parent's parking step persisted its state.
      mockCoordinator.loadAgentState.mockResolvedValue({
        pendingToolsCalling: [],
        status: 'running',
        stepCount: 2,
      });

      const won = await service.tryResumeParentFromAsyncTool(
        { parentOperationId: parentOpId },
        { scheduleVerifyOnHold: true },
      );

      expect(won).toBe(false);
      expect(mockQueueService.scheduleMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          delay: 15_000,
          operationId: parentOpId,
          payload: { asyncToolVerifyAttempt: 1, verifyAsyncToolBarrier: true },
          stepIndex: 2,
        }),
      );
    });

    it('arms a verify when the barrier is unsatisfied and scheduleVerifyOnHold is set', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        pendingToolsCalling: [{ id: 'tc1' }],
        status: 'waiting_for_async_tool',
        stepCount: 1,
      });
      (service as any).serverDB.query = {
        messagePlugins: { findFirst: vi.fn().mockResolvedValue(null) },
      };

      const won = await service.tryResumeParentFromAsyncTool(
        { parentOperationId: parentOpId },
        { scheduleVerifyOnHold: true },
      );

      expect(won).toBe(false);
      expect(mockQueueService.scheduleMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { asyncToolVerifyAttempt: 1, verifyAsyncToolBarrier: true },
        }),
      );
    });

    it('re-arms the next verify with exponential backoff while the barrier holds', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        pendingToolsCalling: [{ id: 'tc1' }],
        status: 'waiting_for_async_tool',
        stepCount: 1,
      });
      (service as any).serverDB.query = {
        messagePlugins: { findFirst: vi.fn().mockResolvedValue(null) },
      };

      // A verify handler running as attempt 2 re-arms attempt 3 (60s).
      await service.tryResumeParentFromAsyncTool(
        { parentOperationId: parentOpId },
        { scheduleVerifyOnHold: true, verifyAttempt: 3 },
      );

      expect(mockQueueService.scheduleMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          delay: 60_000,
          payload: { asyncToolVerifyAttempt: 3, verifyAsyncToolBarrier: true },
        }),
      );
    });

    it('stops re-arming once the bounded attempts are exhausted', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        pendingToolsCalling: [{ id: 'tc1' }],
        status: 'waiting_for_async_tool',
        stepCount: 1,
      });
      (service as any).serverDB.query = {
        messagePlugins: { findFirst: vi.fn().mockResolvedValue(null) },
      };

      const won = await service.tryResumeParentFromAsyncTool(
        { parentOperationId: parentOpId },
        { scheduleVerifyOnHold: true, verifyAttempt: 6 },
      );

      expect(won).toBe(false);
      expect(mockQueueService.scheduleMessage).not.toHaveBeenCalled();
    });

    it('trusts a just-backfilled message id without re-reading it (read-your-writes)', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        pendingToolsCalling: [{ id: 'tc1' }],
        status: 'waiting_for_async_tool',
        stepCount: 3,
      });
      // Plugin row exists (created at park) but its state still reads stale.
      const findById = vi.fn().mockResolvedValue({ content: '' });
      (service as any).serverDB.query = {
        messagePlugins: {
          findFirst: vi.fn().mockResolvedValue({ id: 'msg-tc1', state: null, toolCallId: 'tc1' }),
        },
      };
      (service as any).messageModel.findById = findById;
      const casSpy = vi
        .spyOn(AgentOperationModel.prototype, 'tryResumeFromAsyncTool')
        .mockResolvedValue(true);

      const won = await service.tryResumeParentFromAsyncTool(
        { parentOperationId: parentOpId },
        { knownFulfilledMessageId: 'msg-tc1' },
      );

      expect(won).toBe(true);
      expect(casSpy).toHaveBeenCalledWith(parentOpId);
      // The stale read must be skipped — barrier trusted the local backfill.
      expect(findById).not.toHaveBeenCalled();
    });

    it('arms a fallback verify when a parked op has no pending tools', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        pendingToolsCalling: [],
        status: 'waiting_for_async_tool',
        stepCount: 4,
      });
      const casSpy = vi.spyOn(AgentOperationModel.prototype, 'tryResumeFromAsyncTool');

      const won = await service.tryResumeParentFromAsyncTool(
        { parentOperationId: parentOpId },
        { scheduleVerifyOnHold: true },
      );

      expect(won).toBe(false);
      expect(casSpy).not.toHaveBeenCalled();
      expect(mockQueueService.scheduleMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { asyncToolVerifyAttempt: 1, verifyAsyncToolBarrier: true },
          stepIndex: 4,
        }),
      );
    });

    it('does not arm a verify for terminal parent states', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        pendingToolsCalling: [],
        status: 'done',
        stepCount: 5,
      });

      const won = await service.tryResumeParentFromAsyncTool(
        { parentOperationId: parentOpId },
        { scheduleVerifyOnHold: true },
      );

      expect(won).toBe(false);
      expect(mockQueueService.scheduleMessage).not.toHaveBeenCalled();
    });

    it('arms a verify when the parent state is missing/expired and scheduleVerifyOnHold is set', async () => {
      // Redis read replica hasn't seen the park yet, or the child outran the
      // parent's park. A missing state must retry, not strand on the first miss.
      mockCoordinator.loadAgentState.mockResolvedValue(null);
      const casSpy = vi.spyOn(AgentOperationModel.prototype, 'tryResumeFromAsyncTool');

      const won = await service.tryResumeParentFromAsyncTool(
        { parentOperationId: parentOpId },
        { scheduleVerifyOnHold: true },
      );

      expect(won).toBe(false);
      expect(casSpy).not.toHaveBeenCalled();
      expect(mockQueueService.scheduleMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          operationId: parentOpId,
          payload: { asyncToolVerifyAttempt: 1, verifyAsyncToolBarrier: true },
          // No state to read stepCount from — falls back to 0.
          stepIndex: 0,
        }),
      );
    });

    it('does not arm a verify on missing state when scheduleVerifyOnHold is not set', async () => {
      // The clean-done bridge path resumes without opting into the watchdog;
      // a missing state there must stay a silent no-op, not schedule a re-check.
      mockCoordinator.loadAgentState.mockResolvedValue(null);

      const won = await service.tryResumeParentFromAsyncTool({ parentOperationId: parentOpId });

      expect(won).toBe(false);
      expect(mockQueueService.scheduleMessage).not.toHaveBeenCalled();
    });

    it('stops re-arming on missing state once the bounded attempts are exhausted', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue(null);

      const won = await service.tryResumeParentFromAsyncTool(
        { parentOperationId: parentOpId },
        { scheduleVerifyOnHold: true, verifyAttempt: 6 },
      );

      expect(won).toBe(false);
      expect(mockQueueService.scheduleMessage).not.toHaveBeenCalled();
    });

    it('schedules a finish step when the parked tool requests onComplete=finish (skipCallSupervisor / delegate)', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        pendingToolsCalling: [{ id: 'tc1' }],
        status: 'waiting_for_async_tool',
        stepCount: 4,
      });
      (service as any).serverDB.query = {
        messagePlugins: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'msg-tc1',
            state: { onComplete: 'finish', status: 'completed' },
            toolCallId: 'tc1',
          }),
        },
      };
      (service as any).messageModel.findById = vi.fn().mockResolvedValue({ content: 'answer' });
      vi.spyOn(AgentOperationModel.prototype, 'tryResumeFromAsyncTool').mockResolvedValue(true);

      const won = await service.tryResumeParentFromAsyncTool({ parentOperationId: parentOpId });

      expect(won).toBe(true);
      expect(mockQueueService.scheduleMessage).toHaveBeenCalledWith(
        expect.objectContaining({ payload: { finishAfterAsyncTool: true }, stepIndex: 4 }),
      );
    });
  });

  describe('loadGroupMemberBridge', () => {
    const bridge = {
      anchorMessageId: 'msg-speak',
      expectedMembers: 1,
      groupToolMessageId: 'msg-speak',
      mode: 'isolated',
      onComplete: 'resume',
      parentOperationId: 'op-supervisor',
      threadId: 'thd-1',
    };

    it('reads the member and its bridge from the live runtime snapshot', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        host: { hooks: [{ id: 'group-member-bridge', webhook: { body: bridge } }] },
        origin: {
          agentId: 'agt-carol',
          groupId: 'cg-1',
          lineage: { orchestrationRole: 'member' },
          threadId: 'thd-1',
          topicId: 'tpc-1',
        },
      });

      expect(await service.loadGroupMemberBridge('op-carol')).toEqual({
        agentId: 'agt-carol',
        bridge,
        groupId: 'cg-1',
        threadId: 'thd-1',
        topicId: 'tpc-1',
      });
    });

    it('falls back to the durable row once the snapshot has expired', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue(null);
      vi.spyOn((service as any).agentOperationModel, 'findById').mockResolvedValue({
        agentId: 'agt-carol',
        chatGroupId: 'cg-1',
        metadata: { groupMemberBridge: bridge },
        threadId: 'thd-1',
        topicId: 'tpc-1',
      });

      expect(await service.loadGroupMemberBridge('op-carol')).toEqual({
        agentId: 'agt-carol',
        bridge,
        groupId: 'cg-1',
        threadId: 'thd-1',
        topicId: 'tpc-1',
      });
    });

    it('is undefined for a run that is not a group member', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue(null);
      vi.spyOn((service as any).agentOperationModel, 'findById').mockResolvedValue({
        agentId: 'agt-solo',
        metadata: {},
      });

      expect(await service.loadGroupMemberBridge('op-solo')).toBeUndefined();
    });
  });
});
