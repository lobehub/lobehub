/**
 * @vitest-environment node
 */
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentOperationModel } from '@/database/models/agentOperation';

import { hookDispatcher } from '../hooks';
import { AgentRuntimeService } from '.';
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
  let mockDb: any;
  const mockUserId = 'test-user-id';

  beforeEach(() => {
    ({ service, mockCoordinator, mockDb } = setUpService(AgentRuntimeService, mockUserId));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.AGENT_RUNTIME_BASE_URL;
    hookDispatcher.unregister('test-operation-1');
  });

  describe('interruptOperation', () => {
    let findOperation: MockInstance<AgentOperationModel['findById']>;

    beforeEach(() => {
      findOperation = vi.spyOn(AgentOperationModel.prototype, 'findById');
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        }),
      });
    });

    afterEach(() => {
      findOperation.mockRestore();
    });

    it('should interrupt a running operation', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        operationId: 'op-1',
        status: 'running',
        stepCount: 3,
        lastModified: new Date().toISOString(),
      });

      const result = await service.interruptOperation('op-1');

      expect(result).toBe(true);
      expect(mockCoordinator.saveAgentState).toHaveBeenCalledWith(
        'op-1',
        expect.objectContaining({
          status: 'interrupted',
          lastModified: expect.any(String),
        }),
      );
      expect(mockCoordinator.markInterrupted).toHaveBeenCalledWith('op-1');
      // Sentinel must land before the state save: the step-boundary check
      // reads only the sentinel, so state-first ordering would let a check
      // between the two writes miss the interrupt and clobber it.
      expect(mockCoordinator.markInterrupted.mock.invocationCallOrder[0]).toBeLessThan(
        mockCoordinator.saveAgentState.mock.invocationCallOrder[0],
      );
    });

    it('should interrupt a waiting_for_human operation', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        operationId: 'op-2',
        status: 'waiting_for_human',
        stepCount: 1,
      });

      const result = await service.interruptOperation('op-2');

      expect(result).toBe(true);
      expect(mockCoordinator.saveAgentState).toHaveBeenCalledWith(
        'op-2',
        expect.objectContaining({ status: 'interrupted' }),
      );
    });

    it('should return false when state and owned operation are not found', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue(null);

      const result = await service.interruptOperation('non-existent');

      expect(result).toBe(false);
      expect(mockCoordinator.saveAgentState).not.toHaveBeenCalled();
      expect(mockCoordinator.markInterrupted).not.toHaveBeenCalled();
    });

    it('should acknowledge cancellation when operation already done', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        operationId: 'op-done',
        status: 'done',
        stepCount: 5,
      });

      const result = await service.interruptOperation('op-done');

      expect(result).toBe(true);
      expect(mockCoordinator.saveAgentState).not.toHaveBeenCalled();
    });

    it('should acknowledge cancellation when operation already in error state', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        operationId: 'op-err',
        status: 'error',
        stepCount: 2,
      });

      const result = await service.interruptOperation('op-err');

      expect(result).toBe(true);
      expect(mockCoordinator.saveAgentState).not.toHaveBeenCalled();
    });

    it('should acknowledge cancellation when operation already interrupted', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        operationId: 'op-int',
        status: 'interrupted',
        stepCount: 4,
      });

      const result = await service.interruptOperation('op-int');

      expect(result).toBe(true);
      expect(mockCoordinator.saveAgentState).not.toHaveBeenCalled();
    });

    it.each(['done', 'error', 'interrupted', 'abandoned'] as const)(
      'acknowledges an expired runtime state when the owned operation is %s',
      async (status) => {
        mockCoordinator.loadAgentState.mockResolvedValue(null);
        findOperation.mockResolvedValue({
          id: 'op-expired',
          status,
        } as Awaited<ReturnType<AgentOperationModel['findById']>>);
        expect(await service.interruptOperation('op-expired')).toBe(true);
        expect(mockCoordinator.saveAgentState).not.toHaveBeenCalled();
        expect(mockCoordinator.markInterrupted).not.toHaveBeenCalled();
      },
    );

    it.each(['idle', 'running', 'waiting_for_human', 'waiting_for_async_tool'] as const)(
      'does not treat missing runtime state as stopped when the owned operation is %s',
      async (status) => {
        mockCoordinator.loadAgentState.mockResolvedValue(null);
        findOperation.mockResolvedValue({
          id: 'op-active',
          status,
        } as Awaited<ReturnType<AgentOperationModel['findById']>>);
        expect(await service.interruptOperation('op-active')).toBe(false);
        expect(mockCoordinator.saveAgentState).not.toHaveBeenCalled();
        expect(mockCoordinator.markInterrupted).not.toHaveBeenCalled();
      },
    );

    describe('running operation whose runtime state is gone', () => {
      let settleStale: MockInstance<AgentOperationModel['settleStaleRunning']>;

      beforeEach(() => {
        mockCoordinator.loadAgentState.mockResolvedValue(null);
        settleStale = vi.spyOn(AgentOperationModel.prototype, 'settleStaleRunning');
      });

      afterEach(() => {
        settleStale.mockRestore();
      });

      it('retires a dead operation so the stop is confirmed', async () => {
        const updatedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        findOperation.mockResolvedValue({
          id: 'op-dead',
          status: 'running',
          updatedAt,
        } as Awaited<ReturnType<AgentOperationModel['findById']>>);
        settleStale.mockResolvedValue(true);

        expect(await service.interruptOperation('op-dead')).toBe(true);
        expect(settleStale).toHaveBeenCalledWith('op-dead', expect.any(Date));
        const staleBefore = settleStale.mock.calls[0][1];
        expect(staleBefore.getTime()).toBeGreaterThan(updatedAt.getTime());
        expect(staleBefore.getTime()).toBeLessThan(Date.now() - 5 * 60 * 1000);
      });

      it('keeps refusing while the lease is fresh', async () => {
        findOperation.mockResolvedValue({
          id: 'op-live',
          status: 'running',
          updatedAt: new Date(Date.now() - 60 * 1000),
        } as Awaited<ReturnType<AgentOperationModel['findById']>>);

        expect(await service.interruptOperation('op-live')).toBe(false);
        expect(settleStale).not.toHaveBeenCalled();
      });

      it('keeps refusing when a heartbeat wins the retirement race', async () => {
        findOperation.mockResolvedValue({
          id: 'op-race',
          status: 'running',
          updatedAt: new Date(Date.now() - 60 * 60 * 1000),
        } as Awaited<ReturnType<AgentOperationModel['findById']>>);
        settleStale.mockResolvedValue(false);

        expect(await service.interruptOperation('op-race')).toBe(false);
      });
    });
  });

  // Stream events at step / operation boundaries should carry the canonical
  // UIChatMessage[] snapshot so the client can use the pushed payload as
  // Source of Truth instead of refetching from DB.
  describe('queryUiMessages', () => {
    const stubMessageService = (svc: any, queryMessages: ReturnType<typeof vi.fn>) => {
      svc.messageServiceInstance = { queryMessages };
    };

    it('returns messageService.queryMessages result when agentId + topicId are present', async () => {
      const stubMessages = [{ id: 'msg_x', role: 'user' }];
      const queryMessages = vi.fn().mockResolvedValue(stubMessages);
      stubMessageService(service, queryMessages);

      const result = await service.queryUiMessages({
        origin: { agentId: 'agt_1', topicId: 'tpc_1' },
      } as any);

      expect(queryMessages).toHaveBeenCalledWith(
        { agentId: 'agt_1', topicId: 'tpc_1' },
        expect.anything(),
      );
      expect(result).toEqual(stubMessages);
    });

    it('assembles a share visitor run snapshot under the visitor share Work scope', async () => {
      // Regression: the visitor's Works are registered under their share scope,
      // which the ordinary scope never resolves. Without it the terminal
      // snapshot carried no Work card, so a sandbox-exported pptx only showed
      // its card after the visitor reloaded the page.
      const queryMessages = vi.fn().mockResolvedValue([]);
      stubMessageService(service, queryMessages);

      await service.queryUiMessages({
        origin: { agentId: 'agt_1', topicId: 'tpc_1' },
        principal: {
          actor: { shareVisitor: { shareId: 'share_1', visitorUserId: 'visitor_1' } },
        },
      } as any);

      expect(queryMessages).toHaveBeenCalledWith(
        expect.objectContaining({ includeFileWorks: true, topicId: 'tpc_1' }),
        {
          allowShareVisitor: true,
          workAccessScope: {
            shareId: 'share_1',
            topicId: 'tpc_1',
            type: 'agentShare',
            visitorUserId: 'visitor_1',
          },
        },
      );
    });

    it('keeps the ordinary Work scope and file-Work gate for a non-share run', async () => {
      const queryMessages = vi.fn().mockResolvedValue([]);
      stubMessageService(service, queryMessages);

      await service.queryUiMessages({ origin: { agentId: 'agt_1', topicId: 'tpc_1' } } as any);

      expect(queryMessages.mock.calls[0][0].includeFileWorks).toBeUndefined();
      expect(queryMessages.mock.calls[0][1]).toEqual({ allowShareVisitor: true });
    });

    it('includes file Works for an ordinary run whose client declared it renders them', async () => {
      // Regression: an ordinary run's terminal snapshot/patch dropped the
      // exported pptx card until the user reloaded the conversation.
      const queryMessages = vi.fn().mockResolvedValue([]);
      stubMessageService(service, queryMessages);

      await service.queryUiMessages({
        host: { acceptsFileWorks: true },
        origin: { agentId: 'agt_1', topicId: 'tpc_1' },
      } as any);

      expect(queryMessages.mock.calls[0][0].includeFileWorks).toBe(true);
      expect(queryMessages.mock.calls[0][1]).toEqual({ allowShareVisitor: true });
    });

    it.each([undefined, 'visitor_1'])(
      'includes visitor rows (visitor=%s)',
      async (visitorUserId) => {
        // Regression: `MessageModel.query()` hides share-visitor messages by
        // default. A visitor run executes under the creator's identity, so
        // without the opt-in the terminal snapshot for the visitor's topic is
        // `[]` and the client replaces the conversation it just streamed with
        // nothing.
        const queryMessages = vi.fn().mockResolvedValue([]);
        stubMessageService(service, queryMessages);

        await service.queryUiMessages({
          origin: { agentId: 'agt_1', topicId: 'tpc_1' },
          principal: visitorUserId ? { actor: { shareVisitor: { visitorUserId } } } : undefined,
        } as any);

        // The pushed snapshot always carries whole tool payloads now: it only
        // reaches a client that did not ask for protocol 2, which has no way to
        // fetch an omitted payload back.
        expect(queryMessages).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ allowShareVisitor: true }),
        );
      },
    );

    it('scopes the snapshot to the run thread when the operation is a subtopic run', async () => {
      // Regression: without `threadId` the snapshot is the topic's MAIN
      // conversation, and the client writes it into the thread's bucket at
      // step_start / agent_runtime_end — wiping the turn the run just produced,
      // so a freshly created subtopic renders the main conversation instead.
      const queryMessages = vi.fn().mockResolvedValue([]);
      stubMessageService(service, queryMessages);

      await service.queryUiMessages({
        origin: { agentId: 'agt_1', threadId: 'thd_1', topicId: 'tpc_1' },
      } as any);

      expect(queryMessages).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agt_1', threadId: 'thd_1', topicId: 'tpc_1' }),
        expect.anything(),
      );
    });

    it('leaves threadId unset for a main-conversation run', async () => {
      const queryMessages = vi.fn().mockResolvedValue([]);
      stubMessageService(service, queryMessages);

      await service.queryUiMessages({
        origin: { agentId: 'agt_1', topicId: 'tpc_1' },
      } as any);

      expect(queryMessages.mock.calls[0][0].threadId).toBeUndefined();
    });

    it('returns undefined when agentId or topicId is missing (skips empty-array push)', async () => {
      const queryMessages = vi.fn();
      stubMessageService(service, queryMessages);

      const noAgent = await service.queryUiMessages({
        origin: { topicId: 'tpc_1' },
      } as any);
      const noTopic = await service.queryUiMessages({
        origin: { agentId: 'agt_1' },
      } as any);
      const noMeta = await service.queryUiMessages({} as any);

      expect(noAgent).toBeUndefined();
      expect(noTopic).toBeUndefined();
      expect(noMeta).toBeUndefined();
      expect(queryMessages).not.toHaveBeenCalled();
    });

    it('returns undefined and never throws when DB query fails (stream events must not fail the step)', async () => {
      const queryMessages = vi.fn().mockRejectedValue(new Error('db down'));
      stubMessageService(service, queryMessages);

      const result = await service.queryUiMessages({
        origin: { agentId: 'agt_1', topicId: 'tpc_1' },
      } as any);

      expect(result).toBeUndefined();
    });
  });
});
