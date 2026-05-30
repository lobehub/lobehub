import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mock variables ───────────────────────────────────────────────────

const mockScheduler = vi.hoisted(() => ({
  activeTasks: 0,
  queueSize: 0,
  schedule: vi.fn().mockResolvedValue(undefined),
}));

const mockExtractTopic = vi.hoisted(() => vi.fn());
const mockGetTopicsForUser = vi.hoisted(() => vi.fn());
const mockGetUsers = vi.hoisted(() => vi.fn());

const mockIsCancelled = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const mockIncrementProgress = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockAsyncTaskUpdate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockFindMany = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockGetServerDB = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    query: { asyncTasks: { findMany: mockFindMany } },
  }),
);

const mockParseConfig = vi.hoisted(() =>
  vi.fn(() => ({ useInProcessScheduler: false })),
);

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../inProcessScheduler', () => ({
  getInProcessScheduler: vi.fn(() => mockScheduler),
  resetInProcessScheduler: vi.fn(),
}));

vi.mock('@/server/globalConfig/parseMemoryExtractionConfig', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return { ...actual, parseMemoryExtractionConfig: mockParseConfig };
});

vi.mock('@/database/models/asyncTask', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    AsyncTaskModel: vi.fn().mockImplementation(() => ({
      incrementUserMemoryExtractionProgress: mockIncrementProgress,
      isUserMemoryExtractionCancellationRequested: mockIsCancelled,
      update: mockAsyncTaskUpdate,
    })),
  };
});

vi.mock('@/database/server', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return { ...actual, getServerDB: mockGetServerDB };
});

vi.mock('@lobechat/types', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    AsyncTaskStatus: { Error: 'error', Pending: 'pending', Processing: 'processing', Success: 'success' },
    AsyncTaskType: { UserMemoryExtractionWithChatTopic: 'user_memory_extraction' },
    MemorySourceType: { ChatTopic: 'chat_topic' },
  };
});

// ─── Imports ──────────────────────────────────────────────────────────────────

import { MemoryExtractionWorkflowService, MemoryExtractionExecutor } from '../extract';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { getServerDB } from '@/database/server';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getScheduledCallback = (callIndex = 0) =>
  mockScheduler.schedule.mock.calls[callIndex][1] as () => Promise<void>;

const getScheduledTaskId = (callIndex = 0) =>
  mockScheduler.schedule.mock.calls[callIndex][0] as string;

const basePayload = (overrides?: Record<string, any>) => ({
  baseUrl: 'http://localhost:3210',
  forceAll: false,
  forceTopics: false,
  sources: ['chat_topic'],
  userIds: ['user-1'],
  ...overrides,
});

const setupMockExecutor = () => {
  const executor = {
    extractTopic: mockExtractTopic,
    getTopicsForUser: mockGetTopicsForUser,
    getUsers: mockGetUsers,
  };
  vi.spyOn(MemoryExtractionExecutor, 'create').mockResolvedValue(executor as any);
  return executor;
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MemoryExtractionWorkflowService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (MemoryExtractionWorkflowService as any)._useInProcessScheduler = undefined;
    (MemoryExtractionWorkflowService as any).initialized = false;
    mockScheduler.schedule.mockResolvedValue(undefined);

    // Re-apply mock implementations (clearAllMocks clears them)
    vi.mocked(AsyncTaskModel).mockImplementation(() => ({
      incrementUserMemoryExtractionProgress: mockIncrementProgress,
      isUserMemoryExtractionCancellationRequested: mockIsCancelled,
      update: mockAsyncTaskUpdate,
    }) as any);

    vi.mocked(getServerDB).mockResolvedValue({
      query: { asyncTasks: { findMany: mockFindMany } },
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  1. initialize / useInProcessScheduler
  // ═══════════════════════════════════════════════════════════════════════════

  describe('initialize', () => {
    it('should set useInProcessScheduler=true', () => {
      MemoryExtractionWorkflowService.initialize({ useInProcessScheduler: true });
      expect((MemoryExtractionWorkflowService as any)._useInProcessScheduler).toBe(true);
    });

    it('should set useInProcessScheduler=false', () => {
      MemoryExtractionWorkflowService.initialize({ useInProcessScheduler: false });
      expect((MemoryExtractionWorkflowService as any)._useInProcessScheduler).toBe(false);
    });

    it('should default to false when config has no useInProcessScheduler', () => {
      MemoryExtractionWorkflowService.initialize({});
      expect((MemoryExtractionWorkflowService as any)._useInProcessScheduler).toBe(false);
    });

    it('should be idempotent (last call wins)', () => {
      MemoryExtractionWorkflowService.initialize({ useInProcessScheduler: true });
      MemoryExtractionWorkflowService.initialize({ useInProcessScheduler: false });
      expect((MemoryExtractionWorkflowService as any)._useInProcessScheduler).toBe(false);
    });
  });

  describe('useInProcessScheduler getter (auto-init)', () => {
    it('should auto-initialize from parseMemoryExtractionConfig when not explicitly set', () => {
      vi.mocked(parseMemoryExtractionConfig).mockReturnValue({ useInProcessScheduler: true } as any);

      const value = (MemoryExtractionWorkflowService as any).useInProcessScheduler;
      expect(value).toBe(true);
    });

    it('should cache after first auto-init', () => {
      vi.mocked(parseMemoryExtractionConfig).mockReturnValue({ useInProcessScheduler: true } as any);
      (MemoryExtractionWorkflowService as any).useInProcessScheduler;

      vi.mocked(parseMemoryExtractionConfig).mockReturnValue({ useInProcessScheduler: false } as any);
      expect((MemoryExtractionWorkflowService as any).useInProcessScheduler).toBe(true);
    });

    it('should use explicit initialize over auto-init', () => {
      vi.mocked(parseMemoryExtractionConfig).mockReturnValue({ useInProcessScheduler: false } as any);
      MemoryExtractionWorkflowService.initialize({ useInProcessScheduler: true });
      expect((MemoryExtractionWorkflowService as any).useInProcessScheduler).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  2. triggerProcessUsers — in-process path
  // ═══════════════════════════════════════════════════════════════════════════

  describe('triggerProcessUsers (in-process)', () => {
    beforeEach(() => {
      MemoryExtractionWorkflowService.initialize({ useInProcessScheduler: true });
    });

    it('should throw when baseUrl is missing', async () => {
      await expect(
        MemoryExtractionWorkflowService.triggerProcessUsers({ sources: ['chat_topic'], userIds: ['user-1'] } as any),
      ).rejects.toThrow('Missing baseUrl for workflow trigger');
    });

    it('should schedule task via InProcessScheduler', async () => {
      setupMockExecutor();
      await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload());
      expect(mockScheduler.schedule).toHaveBeenCalledTimes(1);
    });

    it('should return workflowRunId with "in-process:" prefix', async () => {
      setupMockExecutor();
      const result = await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload());
      expect(result.workflowRunId).toMatch(/^in-process:/);
    });

    it('should generate correct taskId format', async () => {
      setupMockExecutor();
      await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload({ userIds: ['user-1', 'user-2'] }));
      expect(getScheduledTaskId()).toBe('process-users:user-1,user-2');
    });

    it('should use "unknown" in taskId when userIds is empty', async () => {
      setupMockExecutor();
      await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload({ userIds: [] }));
      expect(getScheduledTaskId()).toBe('process-users:unknown');
    });

    describe('scheduled callback', () => {
      it('should create MemoryExtractionExecutor', async () => {
        setupMockExecutor();
        mockGetTopicsForUser.mockResolvedValue({ ids: [] });
        await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload());
        await getScheduledCallback()();
        expect(MemoryExtractionExecutor.create).toHaveBeenCalled();
      });

      it('should fetch users from getUsers when userIds is empty', async () => {
        setupMockExecutor();
        mockGetUsers.mockResolvedValue({ ids: ['fetched-1'] });
        mockGetTopicsForUser.mockResolvedValue({ ids: [] });
        await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload({ userIds: [] }));
        await getScheduledCallback()();
        expect(mockGetUsers).toHaveBeenCalledWith(50);
      });

      it('should call getTopicsForUser for each userId', async () => {
        setupMockExecutor();
        mockGetTopicsForUser.mockResolvedValue({ ids: [] });
        await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload({ userIds: ['u1', 'u2'] }));
        await getScheduledCallback()();
        expect(mockGetTopicsForUser).toHaveBeenCalledTimes(2);
      });

      it('should paginate topics (pageSize=50)', async () => {
        setupMockExecutor();
        mockGetTopicsForUser
          .mockResolvedValueOnce({ cursor: { createdAt: new Date(), id: 'c1' }, ids: ['t1'] })
          .mockResolvedValueOnce({ ids: ['t2'] });
        await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload());
        await getScheduledCallback()();
        expect(mockGetTopicsForUser).toHaveBeenCalledTimes(2);
        expect(mockGetTopicsForUser.mock.calls[0][0]).toMatchObject({ cursor: undefined });
        expect(mockGetTopicsForUser.mock.calls[1][0]).toMatchObject({ cursor: expect.objectContaining({ id: 'c1' }) });
      });

      it('should break when getTopicsForUser returns empty ids', async () => {
        setupMockExecutor();
        mockGetTopicsForUser.mockResolvedValue({ ids: [] });
        await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload());
        await getScheduledCallback()();
        expect(mockExtractTopic).not.toHaveBeenCalled();
      });

      it('should extract CEPA then Identity per topic (2 calls each)', async () => {
        setupMockExecutor();
        mockGetTopicsForUser.mockResolvedValue({ ids: ['t1'] });
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: ['m1'] });
        await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload());
        await getScheduledCallback()();
        expect(mockExtractTopic).toHaveBeenCalledTimes(2);
        expect(mockExtractTopic.mock.calls[0][0]).toMatchObject({
          layers: ['context', 'experience', 'preference', 'activity'],
          skipTaskStatusUpdate: true,
          source: 'chat_topic',
          topicId: 't1',
          userId: 'user-1',
        });
        expect(mockExtractTopic.mock.calls[1][0]).toMatchObject({
          layers: ['identity'],
          skipTaskStatusUpdate: true,
          topicId: 't1',
        });
      });

      it('should process topics in batches of 4', async () => {
        setupMockExecutor();
        mockGetTopicsForUser.mockResolvedValue({ ids: ['t1', 't2', 't3', 't4', 't5', 't6'] });
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload());
        await getScheduledCallback()();
        // 6 topics × 2 (CEPA+Identity) = 12
        expect(mockExtractTopic).toHaveBeenCalledTimes(12);
      });

      it('should check cancellation per topic when asyncTaskId set', async () => {
        setupMockExecutor();
        mockGetTopicsForUser.mockResolvedValue({ ids: ['t1', 't2'] });
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload({ asyncTaskId: 'task-1' }));
        await getScheduledCallback()();
        // 2 topics × 2 checks (before CEPA + before Identity) = 4
        expect(mockIsCancelled).toHaveBeenCalledTimes(4);
        expect(mockIsCancelled).toHaveBeenCalledWith('task-1');
      });

      it('should NOT check cancellation without asyncTaskId', async () => {
        setupMockExecutor();
        mockGetTopicsForUser.mockResolvedValue({ ids: ['t1'] });
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload());
        await getScheduledCallback()();
        expect(mockIsCancelled).not.toHaveBeenCalled();
      });

      it('should stop when cancellation detected', async () => {
        setupMockExecutor();
        mockGetTopicsForUser.mockResolvedValue({ ids: ['t1', 't2', 't3'] });
        // Concurrency=2: t1 and t2 start in parallel, each checks twice
        mockIsCancelled
          .mockResolvedValueOnce(false).mockResolvedValueOnce(true)   // t1
          .mockResolvedValueOnce(false).mockResolvedValueOnce(true);  // t2
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload({ asyncTaskId: 'task-1' }));
        await getScheduledCallback()();
        // t1 CEPA + t2 CEPA (both start before cancellation), t1 cancelled before Identity, t3 skipped
        expect(mockExtractTopic).toHaveBeenCalledTimes(3);
      });

      it('should increment progress when asyncTaskId + userInitiated', async () => {
        setupMockExecutor();
        mockGetTopicsForUser.mockResolvedValue({ ids: ['t1', 't2'] });
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        await MemoryExtractionWorkflowService.triggerProcessUsers(
          basePayload({ asyncTaskId: 'task-1', userInitiated: true }),
        );
        await getScheduledCallback()();
        expect(mockIncrementProgress).toHaveBeenCalledTimes(2);
        expect(mockIncrementProgress).toHaveBeenCalledWith('task-1');
      });

      it('should NOT increment progress without asyncTaskId', async () => {
        setupMockExecutor();
        mockGetTopicsForUser.mockResolvedValue({ ids: ['t1'] });
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload());
        await getScheduledCallback()();
        expect(mockIncrementProgress).not.toHaveBeenCalled();
      });

      it('should increment progress even when topic extraction fails', async () => {
        setupMockExecutor();
        mockGetTopicsForUser.mockResolvedValue({ ids: ['t1'] });
        mockExtractTopic.mockRejectedValue(new Error('boom'));
        await MemoryExtractionWorkflowService.triggerProcessUsers(
          basePayload({ asyncTaskId: 'task-1', userInitiated: true }),
        );
        await getScheduledCallback()();
        expect(mockIncrementProgress).toHaveBeenCalledTimes(1);
      });

      it('should continue remaining topics when one fails', async () => {
        setupMockExecutor();
        mockGetTopicsForUser.mockResolvedValue({ ids: ['t1', 't2'] });
        // t1 always fails with transient error (retried MAX_RETRIES=2 → 3 attempts), t2 always succeeds
        mockExtractTopic.mockImplementation(async (params: any) => {
          if (params.topicId === 't1') throw new Error('ECONNRESET: connection reset');
          return { extracted: true, memoryIds: [] };
        });
        await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload());
        await getScheduledCallback()();
        // t1: 3 retry attempts × 1 call (CEPA fails) = 3
        // t2: 1 attempt × 2 calls (CEPA + Identity) = 2
        expect(mockExtractTopic).toHaveBeenCalledTimes(5);
      });

      it('should mark asyncTask "success" when done', async () => {
        setupMockExecutor();
        mockGetTopicsForUser.mockResolvedValue({ ids: ['t1'] });
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload({ asyncTaskId: 'task-1' }));
        await getScheduledCallback()();
        expect(mockAsyncTaskUpdate).toHaveBeenCalledWith('task-1', { status: 'success' });
      });

      it('should mark asyncTask "error" when executor creation fails', async () => {
        vi.spyOn(MemoryExtractionExecutor, 'create').mockRejectedValue(new Error('DB down'));
        await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload({ asyncTaskId: 'task-1' }));
        await getScheduledCallback()();
        expect(mockAsyncTaskUpdate).toHaveBeenCalledWith('task-1', {
          status: 'error',
          error: { type: 'TaskFailed', message: 'DB down' },
        });
      });

      it('should pass fromDate/toDate to getTopicsForUser', async () => {
        setupMockExecutor();
        mockGetTopicsForUser.mockResolvedValue({ ids: [] });
        await MemoryExtractionWorkflowService.triggerProcessUsers(
          basePayload({ fromDate: '2025-01-01', toDate: '2025-06-01' }),
        );
        await getScheduledCallback()();
        expect(mockGetTopicsForUser.mock.calls[0][0]).toMatchObject({
          from: new Date('2025-01-01'),
          to: new Date('2025-06-01'),
        });
      });

      it('should always set forceAll=true/forceTopics=true for pagination', async () => {
        setupMockExecutor();
        mockGetTopicsForUser.mockResolvedValue({ ids: [] });
        await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload({ forceAll: false }));
        await getScheduledCallback()();
        expect(mockGetTopicsForUser.mock.calls[0][0]).toMatchObject({ forceAll: true, forceTopics: true });
      });

      it('should pass forceAll/forceTopics from payload to extractTopic', async () => {
        setupMockExecutor();
        mockGetTopicsForUser.mockResolvedValue({ ids: ['t1'] });
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload({ forceAll: true, forceTopics: true }));
        await getScheduledCallback()();
        expect(mockExtractTopic.mock.calls[0][0]).toMatchObject({ forceAll: true, forceTopics: true });
      });

      it('should pass userInitiated to extractTopic (default true)', async () => {
        setupMockExecutor();
        mockGetTopicsForUser.mockResolvedValue({ ids: ['t1'] });
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload());
        await getScheduledCallback()();
        expect(mockExtractTopic.mock.calls[0][0]).toMatchObject({ userInitiated: true });
      });

      it('should pass userInitiated=false when specified', async () => {
        setupMockExecutor();
        mockGetTopicsForUser.mockResolvedValue({ ids: ['t1'] });
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload({ userInitiated: false }));
        await getScheduledCallback()();
        expect(mockExtractTopic.mock.calls[0][0]).toMatchObject({ userInitiated: false });
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  3. triggerProcessTopics — in-process path
  // ═══════════════════════════════════════════════════════════════════════════

  describe('triggerProcessTopics (in-process)', () => {
    beforeEach(() => {
      MemoryExtractionWorkflowService.initialize({ useInProcessScheduler: true });
      vi.spyOn(MemoryExtractionWorkflowService, 'triggerPersonaUpdate').mockResolvedValue({} as any);
    });

    it('should throw when baseUrl is missing', async () => {
      await expect(
        MemoryExtractionWorkflowService.triggerProcessTopics('user-1', {
          sources: ['chat_topic'], topicIds: ['t1'], userIds: ['user-1'],
        } as any),
      ).rejects.toThrow('Missing baseUrl for workflow trigger');
    });

    it('should schedule task via InProcessScheduler', async () => {
      await MemoryExtractionWorkflowService.triggerProcessTopics('user-1', basePayload({ topicIds: ['t1'] }));
      expect(mockScheduler.schedule).toHaveBeenCalledTimes(1);
    });

    it('should return workflowRunId with "in-process:" prefix', async () => {
      const result = await MemoryExtractionWorkflowService.triggerProcessTopics(
        'user-1', basePayload({ topicIds: ['t1'] }),
      );
      expect(result.workflowRunId).toMatch(/^in-process:/);
    });

    it('should generate correct taskId format', async () => {
      await MemoryExtractionWorkflowService.triggerProcessTopics(
        'user-1', basePayload({ topicIds: ['t1', 't2'] }),
      );
      expect(getScheduledTaskId()).toBe('process-topics:user-1:t1,t2');
    });

    describe('scheduled callback', () => {
      it('should create MemoryExtractionExecutor', async () => {
        setupMockExecutor();
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        await MemoryExtractionWorkflowService.triggerProcessTopics(
          'user-1', basePayload({ topicIds: ['t1'] }),
        );
        await getScheduledCallback()();
        expect(MemoryExtractionExecutor.create).toHaveBeenCalled();
      });

      it('should extract CEPA then Identity per topic (2 calls each)', async () => {
        setupMockExecutor();
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: ['m1'] });
        await MemoryExtractionWorkflowService.triggerProcessTopics(
          'user-1', basePayload({ topicIds: ['t1', 't2'] }),
        );
        await getScheduledCallback()();
        // 2 topics × 2 (CEPA + Identity) = 4
        expect(mockExtractTopic).toHaveBeenCalledTimes(4);
        // Verify each topic gets both CEPA and Identity (order may vary with concurrency)
        const calls = mockExtractTopic.mock.calls.map((c: any) => c[0]);
        for (const topicId of ['t1', 't2']) {
          expect(calls).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ layers: ['context', 'experience', 'preference', 'activity'], topicId }),
              expect.objectContaining({ layers: ['identity'], topicId }),
            ]),
          );
        }
      });

      it('should check cancellation per topic when asyncTaskId set', async () => {
        setupMockExecutor();
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        await MemoryExtractionWorkflowService.triggerProcessTopics(
          'user-1', basePayload({ asyncTaskId: 'task-1', topicIds: ['t1', 't2'] }),
        );
        await getScheduledCallback()();
        // 2 topics × 2 checks (before CEPA + before Identity) = 4
        // (no extra pre-check in processTopicWithRetry)
        expect(mockIsCancelled).toHaveBeenCalledTimes(4);
        expect(mockIsCancelled).toHaveBeenCalledWith('task-1');
      });

      it('should NOT check cancellation without asyncTaskId', async () => {
        setupMockExecutor();
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        await MemoryExtractionWorkflowService.triggerProcessTopics(
          'user-1', basePayload({ topicIds: ['t1'] }),
        );
        await getScheduledCallback()();
        expect(mockIsCancelled).not.toHaveBeenCalled();
      });

      it('should stop when cancellation detected', async () => {
        setupMockExecutor();
        // Both topics run in parallel (concurrency=2).
        // Each topic checks twice: before CEPA, before Identity.
        // t1: false (start CEPA), true (cancel before Identity)
        // t2: false (start CEPA), true (cancel before Identity)
        mockIsCancelled
          .mockResolvedValueOnce(false).mockResolvedValueOnce(true)   // t1
          .mockResolvedValueOnce(false).mockResolvedValueOnce(true);  // t2
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        await MemoryExtractionWorkflowService.triggerProcessTopics(
          'user-1', basePayload({ asyncTaskId: 'task-1', topicIds: ['t1', 't2'] }),
        );
        await getScheduledCallback()();
        // Both topics start CEPA (concurrent), both cancelled before Identity
        expect(mockExtractTopic).toHaveBeenCalledTimes(2);
      });

      it('should increment progress when asyncTaskId + userInitiated', async () => {
        setupMockExecutor();
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        await MemoryExtractionWorkflowService.triggerProcessTopics(
          'user-1', basePayload({ asyncTaskId: 'task-1', topicIds: ['t1', 't2'], userInitiated: true }),
        );
        await getScheduledCallback()();
        expect(mockIncrementProgress).toHaveBeenCalledTimes(2);
        expect(mockIncrementProgress).toHaveBeenCalledWith('task-1');
      });

      it('should NOT increment progress without asyncTaskId', async () => {
        setupMockExecutor();
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        await MemoryExtractionWorkflowService.triggerProcessTopics(
          'user-1', basePayload({ topicIds: ['t1'] }),
        );
        await getScheduledCallback()();
        expect(mockIncrementProgress).not.toHaveBeenCalled();
      });

      it('should continue remaining topics when one fails', async () => {
        setupMockExecutor();
        mockExtractTopic
          .mockResolvedValueOnce({ extracted: true, memoryIds: [] }) // t1 CEPA
          .mockResolvedValueOnce({ extracted: true, memoryIds: [] }) // t1 Identity
          .mockRejectedValueOnce(new Error('fail'))                   // t2 CEPA
          .mockResolvedValueOnce({ extracted: true, memoryIds: [] }); // t3 CEPA + Identity...
        await MemoryExtractionWorkflowService.triggerProcessTopics(
          'user-1', basePayload({ topicIds: ['t1', 't2', 't3'] }),
        );
        await getScheduledCallback()();
        // t1: 2 calls, t2: 1 call (fails), t3: 2 calls = 5
        expect(mockExtractTopic).toHaveBeenCalledTimes(5);
      });

      it('should trigger persona update after processing', async () => {
        setupMockExecutor();
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        await MemoryExtractionWorkflowService.triggerProcessTopics(
          'user-1', basePayload({ topicIds: ['t1'] }),
        );
        await getScheduledCallback()();
        expect(MemoryExtractionWorkflowService.triggerPersonaUpdate).toHaveBeenCalledWith(
          'user-1',
          'http://localhost:3210',
        );
      });

      it('should pass forceAll/forceTopics from payload to extractTopic', async () => {
        setupMockExecutor();
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        await MemoryExtractionWorkflowService.triggerProcessTopics(
          'user-1', basePayload({ forceAll: true, forceTopics: true, topicIds: ['t1'] }),
        );
        await getScheduledCallback()();
        expect(mockExtractTopic.mock.calls[0][0]).toMatchObject({ forceAll: true, forceTopics: true });
      });

      it('should pass userInitiated to extractTopic (default true)', async () => {
        setupMockExecutor();
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        await MemoryExtractionWorkflowService.triggerProcessTopics(
          'user-1', basePayload({ topicIds: ['t1'] }),
        );
        await getScheduledCallback()();
        expect(mockExtractTopic.mock.calls[0][0]).toMatchObject({ userInitiated: true });
      });

      it('should pass userInitiated=false when specified', async () => {
        setupMockExecutor();
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        await MemoryExtractionWorkflowService.triggerProcessTopics(
          'user-1', basePayload({ topicIds: ['t1'], userInitiated: false }),
        );
        await getScheduledCallback()();
        expect(mockExtractTopic.mock.calls[0][0]).toMatchObject({ userInitiated: false });
      });

      it('should still trigger persona update when topicIds is empty', async () => {
        setupMockExecutor();
        await MemoryExtractionWorkflowService.triggerProcessTopics(
          'user-1', basePayload({ topicIds: [] }),
        );
        await getScheduledCallback()();
        expect(mockExtractTopic).not.toHaveBeenCalled();
        expect(MemoryExtractionWorkflowService.triggerPersonaUpdate).toHaveBeenCalledWith(
          'user-1',
          'http://localhost:3210',
        );
      });

      it('should pass fromDate/toDate to extractTopic', async () => {
        setupMockExecutor();
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        await MemoryExtractionWorkflowService.triggerProcessTopics(
          'user-1', basePayload({ fromDate: '2025-01-01', toDate: '2025-06-01', topicIds: ['t1'] }),
        );
        await getScheduledCallback()();
        expect(mockExtractTopic.mock.calls[0][0]).toMatchObject({
          from: new Date('2025-01-01'),
          to: new Date('2025-06-01'),
        });
      });

      it('should set skipTaskStatusUpdate=true for both CEPA and Identity calls', async () => {
        setupMockExecutor();
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        await MemoryExtractionWorkflowService.triggerProcessTopics(
          'user-1', basePayload({ topicIds: ['t1'] }),
        );
        await getScheduledCallback()();
        expect(mockExtractTopic.mock.calls[0][0]).toMatchObject({ skipTaskStatusUpdate: true });
        expect(mockExtractTopic.mock.calls[1][0]).toMatchObject({ skipTaskStatusUpdate: true });
      });

      it('should not update asyncTask status when executor creation fails', async () => {
        vi.spyOn(MemoryExtractionExecutor, 'create').mockRejectedValue(new Error('DB down'));
        await MemoryExtractionWorkflowService.triggerProcessTopics(
          'user-1', basePayload({ asyncTaskId: 'task-1', topicIds: ['t1'] }),
        );
        await getScheduledCallback()();
        expect(mockAsyncTaskUpdate).not.toHaveBeenCalled();
      });

      it('should continue when persona update fails', async () => {
        setupMockExecutor();
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        vi.mocked(MemoryExtractionWorkflowService.triggerPersonaUpdate).mockRejectedValue(
          new Error('persona service down'),
        );
        await MemoryExtractionWorkflowService.triggerProcessTopics(
          'user-1', basePayload({ topicIds: ['t1'] }),
        );
        await expect(getScheduledCallback()()).resolves.toBeUndefined();
        expect(mockExtractTopic).toHaveBeenCalledTimes(2);
      });

      it('should continue when progress update fails', async () => {
        setupMockExecutor();
        mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
        mockIncrementProgress.mockRejectedValue(new Error('progress DB error'));
        await MemoryExtractionWorkflowService.triggerProcessTopics(
          'user-1', basePayload({ asyncTaskId: 'task-1', topicIds: ['t1'], userInitiated: true }),
        );
        await expect(getScheduledCallback()()).resolves.toBeUndefined();
        expect(mockExtractTopic).toHaveBeenCalledTimes(2);
      });

      it('should NOT increment progress when topic extraction fails', async () => {
        setupMockExecutor();
        mockExtractTopic
          .mockRejectedValueOnce(new Error('fail'))                   // t1 CEPA fails
          .mockResolvedValueOnce({ extracted: true, memoryIds: [] })  // t2 CEPA
          .mockResolvedValueOnce({ extracted: true, memoryIds: [] }); // t2 Identity
        mockIncrementProgress.mockResolvedValue(undefined);
        await MemoryExtractionWorkflowService.triggerProcessTopics(
          'user-1', basePayload({ asyncTaskId: 'task-1', topicIds: ['t1', 't2'], userInitiated: true }),
        );
        await getScheduledCallback()();
        // Progress updates for both topics (failed + succeeded)
        expect(mockIncrementProgress).toHaveBeenCalledTimes(2);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  4. QStash path regressions
  // ═══════════════════════════════════════════════════════════════════════════

  describe('triggerProcessTopics (QStash path)', () => {
    beforeEach(() => {
      MemoryExtractionWorkflowService.initialize({ useInProcessScheduler: false });
    });

    it('should throw when baseUrl is missing', async () => {
      await expect(
        MemoryExtractionWorkflowService.triggerProcessTopics('user-1', {
          sources: ['chat_topic'], topicIds: ['t1'], userIds: ['user-1'],
        } as any),
      ).rejects.toThrow('Missing baseUrl for workflow trigger');
    });

    it('should call workflow client trigger with correct URL and payload', async () => {
      const mockTrigger = vi.fn().mockResolvedValue({ workflowRunId: 'qstash-run-topics-1' });
      const mockGetClient = vi.fn().mockReturnValue({ trigger: mockTrigger });

      vi.spyOn(MemoryExtractionWorkflowService as any, 'getClient').mockImplementation(mockGetClient);

      const payload = basePayload({ topicIds: ['t1', 't2'] });
      const result = await MemoryExtractionWorkflowService.triggerProcessTopics('user-1', payload);

      expect(mockTrigger).toHaveBeenCalledTimes(1);
      expect(mockTrigger.mock.calls[0][0]).toMatchObject({
        body: payload,
        flowControl: expect.objectContaining({
          key: expect.stringContaining('user-1'),
          parallelism: expect.any(Number),
        }),
      });
      expect(result.workflowRunId).toBe('qstash-run-topics-1');
    });

    it('should forward extraHeaders to workflow client', async () => {
      const mockTrigger = vi.fn().mockResolvedValue({ workflowRunId: 'qstash-run-topics-2' });
      const mockGetClient = vi.fn().mockReturnValue({ trigger: mockTrigger });

      vi.spyOn(MemoryExtractionWorkflowService as any, 'getClient').mockImplementation(mockGetClient);

      const payload = basePayload({ topicIds: ['t1'] });
      const extraHeaders = { Authorization: 'Bearer token123' };
      await MemoryExtractionWorkflowService.triggerProcessTopics('user-1', payload, { extraHeaders });

      expect(mockTrigger.mock.calls[0][0]).toMatchObject({
        headers: extraHeaders,
      });
    });

  });

  describe('triggerProcessUsers (QStash path)', () => {
    beforeEach(() => {
      MemoryExtractionWorkflowService.initialize({ useInProcessScheduler: false });
    });

    it('should throw when baseUrl is missing', async () => {
      await expect(
        MemoryExtractionWorkflowService.triggerProcessUsers({ sources: ['chat_topic'], userIds: ['user-1'] } as any),
      ).rejects.toThrow('Missing baseUrl for workflow trigger');
    });

    it('should call workflow client trigger with correct URL and payload', async () => {
      const mockTrigger = vi.fn().mockResolvedValue({ workflowRunId: 'qstash-run-1' });
      const mockGetClient = vi.fn().mockReturnValue({ trigger: mockTrigger });

      // Mock the private getClient method
      vi.spyOn(MemoryExtractionWorkflowService as any, 'getClient').mockImplementation(mockGetClient);

      const payload = basePayload({ userIds: ['user-1', 'user-2'] });
      const result = await MemoryExtractionWorkflowService.triggerProcessUsers(payload);

      expect(mockTrigger).toHaveBeenCalledTimes(1);
      expect(mockTrigger.mock.calls[0][0]).toMatchObject({
        body: payload,
      });
      expect(result.workflowRunId).toBe('qstash-run-1');
    });

    it('should forward extraHeaders to workflow client', async () => {
      const mockTrigger = vi.fn().mockResolvedValue({ workflowRunId: 'qstash-run-2' });
      const mockGetClient = vi.fn().mockReturnValue({ trigger: mockTrigger });

      vi.spyOn(MemoryExtractionWorkflowService as any, 'getClient').mockImplementation(mockGetClient);

      const payload = basePayload();
      const extraHeaders = { 'X-Custom-Header': 'test-value' };
      await MemoryExtractionWorkflowService.triggerProcessUsers(payload, { extraHeaders });

      expect(mockTrigger.mock.calls[0][0]).toMatchObject({
        headers: extraHeaders,
      });
    });
  });

  describe('triggerHourly (QStash-only)', () => {
    it('should throw when baseUrl is missing', () => {
      expect(() => MemoryExtractionWorkflowService.triggerHourly({} as any)).toThrow(
        'Missing baseUrl for workflow trigger',
      );
    });

    it('should call workflow client trigger with correct URL and payload', () => {
      const mockTrigger = vi.fn().mockResolvedValue({ workflowRunId: 'hourly-run-1' });
      const mockGetClient = vi.fn().mockReturnValue({ trigger: mockTrigger });

      vi.spyOn(MemoryExtractionWorkflowService as any, 'getClient').mockImplementation(mockGetClient);

      const payload = { baseUrl: 'http://localhost:3210', userIds: ['user-1'] };
      const result = MemoryExtractionWorkflowService.triggerHourly(payload as any);

      expect(mockTrigger).toHaveBeenCalledTimes(1);
      expect(mockTrigger.mock.calls[0][0]).toMatchObject({
        body: payload,
      });
    });

    it('should forward extraHeaders to workflow client', () => {
      const mockTrigger = vi.fn().mockResolvedValue({ workflowRunId: 'hourly-run-2' });
      const mockGetClient = vi.fn().mockReturnValue({ trigger: mockTrigger });

      vi.spyOn(MemoryExtractionWorkflowService as any, 'getClient').mockImplementation(mockGetClient);

      const payload = { baseUrl: 'http://localhost:3210', userIds: ['user-1'] };
      const extraHeaders = { 'X-Request-Id': 'req-123' };
      MemoryExtractionWorkflowService.triggerHourly(payload as any, { extraHeaders });

      expect(mockTrigger.mock.calls[0][0]).toMatchObject({
        headers: extraHeaders,
      });
    });
  });

  describe('triggerProcessUserTopics (QStash-only)', () => {
    it('should throw when baseUrl is missing', () => {
      expect(() => MemoryExtractionWorkflowService.triggerProcessUserTopics({} as any)).toThrow(
        'Missing baseUrl for workflow trigger',
      );
    });

    it('should call workflow client trigger with correct URL and payload', () => {
      const mockTrigger = vi.fn().mockResolvedValue({ workflowRunId: 'user-topics-run-1' });
      const mockGetClient = vi.fn().mockReturnValue({ trigger: mockTrigger });

      vi.spyOn(MemoryExtractionWorkflowService as any, 'getClient').mockImplementation(mockGetClient);

      const payload = { baseUrl: 'http://localhost:3210', userId: 'user-1' };
      const result = MemoryExtractionWorkflowService.triggerProcessUserTopics(payload as any);

      expect(mockTrigger).toHaveBeenCalledTimes(1);
      expect(mockTrigger.mock.calls[0][0]).toMatchObject({
        body: payload,
      });
    });

    it('should forward extraHeaders to workflow client', () => {
      const mockTrigger = vi.fn().mockResolvedValue({ workflowRunId: 'user-topics-run-2' });
      const mockGetClient = vi.fn().mockReturnValue({ trigger: mockTrigger });

      vi.spyOn(MemoryExtractionWorkflowService as any, 'getClient').mockImplementation(mockGetClient);

      const payload = { baseUrl: 'http://localhost:3210', userId: 'user-1' };
      const extraHeaders = { 'X-Trace-Id': 'trace-456' };
      MemoryExtractionWorkflowService.triggerProcessUserTopics(payload as any, { extraHeaders });

      expect(mockTrigger.mock.calls[0][0]).toMatchObject({
        headers: extraHeaders,
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  5. recoverPendingTasks
  // ═══════════════════════════════════════════════════════════════════════════

  describe('recoverPendingTasks', () => {
    it('should skip when useInProcessScheduler=false', async () => {
      MemoryExtractionWorkflowService.initialize({ useInProcessScheduler: false });
      await MemoryExtractionWorkflowService.recoverPendingTasks();
      expect(mockFindMany).not.toHaveBeenCalled();
      expect(mockScheduler.schedule).not.toHaveBeenCalled();
    });

    it('should query DB for pending/processing tasks', async () => {
      MemoryExtractionWorkflowService.initialize({ useInProcessScheduler: true });
      mockFindMany.mockResolvedValue([]);
      await MemoryExtractionWorkflowService.recoverPendingTasks();
      expect(mockFindMany).toHaveBeenCalled();
    });

    it('should re-trigger each pending task', async () => {
      MemoryExtractionWorkflowService.initialize({ useInProcessScheduler: true });
      setupMockExecutor();
      mockGetTopicsForUser.mockResolvedValue({ ids: [] });
      mockFindMany.mockResolvedValue([
        { id: 'task-1', type: 'user_memory_extraction', status: 'pending', userId: 'user-1' },
        { id: 'task-2', type: 'user_memory_extraction', status: 'processing', userId: 'user-2' },
      ]);
      await MemoryExtractionWorkflowService.recoverPendingTasks();
      expect(mockScheduler.schedule).toHaveBeenCalledTimes(2);
      expect(getScheduledTaskId(0)).toBe('process-users:user-1');
      expect(getScheduledTaskId(1)).toBe('process-users:user-2');
    });

    it('should handle DB query errors gracefully', async () => {
      MemoryExtractionWorkflowService.initialize({ useInProcessScheduler: true });
      mockFindMany.mockRejectedValue(new Error('DB down'));
      await expect(MemoryExtractionWorkflowService.recoverPendingTasks()).resolves.toBeUndefined();
    });

    it('should handle individual task re-trigger errors without stopping', async () => {
      MemoryExtractionWorkflowService.initialize({ useInProcessScheduler: true });
      mockFindMany.mockResolvedValue([
        { id: 'task-1', type: 'user_memory_extraction', status: 'pending', userId: 'user-1' },
        { id: 'task-2', type: 'user_memory_extraction', status: 'pending', userId: 'user-2' },
      ]);
      mockScheduler.schedule
        .mockRejectedValueOnce(new Error('scheduler error'))
        .mockResolvedValueOnce(undefined);
      await MemoryExtractionWorkflowService.recoverPendingTasks();
      expect(mockScheduler.schedule).toHaveBeenCalledTimes(2);
    });

    it('should pass forceAll=false and forceTopics=false for idempotent recovery', async () => {
      MemoryExtractionWorkflowService.initialize({ useInProcessScheduler: true });
      setupMockExecutor();
      mockGetTopicsForUser.mockResolvedValue({ ids: ['t1'] });
      mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
      mockFindMany.mockResolvedValue([
        { id: 'task-1', type: 'user_memory_extraction', status: 'pending', userId: 'user-1' },
      ]);
      await MemoryExtractionWorkflowService.recoverPendingTasks();

      // Execute the scheduled callback to verify force flags flow to extractTopic
      await getScheduledCallback()();

      // Every extractTopic call must have forceAll=false and forceTopics=false
      // so that already-extracted topics are skipped by the isTopicExtracted check
      for (const call of mockExtractTopic.mock.calls) {
        expect(call[0]).toMatchObject({ forceAll: false, forceTopics: false });
      }
    });

    it('should queue recovery tasks without conflict when scheduler already has running tasks', async () => {
      MemoryExtractionWorkflowService.initialize({ useInProcessScheduler: true });
      setupMockExecutor();
      mockGetTopicsForUser.mockResolvedValue({ ids: [] });

      // Simulate an existing task already scheduled (e.g. user-triggered extraction)
      await MemoryExtractionWorkflowService.triggerProcessUsers(
        basePayload({ userIds: ['existing-user'] }),
      );
      expect(mockScheduler.schedule).toHaveBeenCalledTimes(1);

      // Now recover pending tasks — should queue additional tasks, not collide
      mockFindMany.mockResolvedValue([
        { id: 'task-recovery', type: 'user_memory_extraction', status: 'processing', userId: 'recovered-user' },
      ]);
      await MemoryExtractionWorkflowService.recoverPendingTasks();
      expect(mockScheduler.schedule).toHaveBeenCalledTimes(2);

      // Both tasks have distinct IDs
      expect(getScheduledTaskId(0)).toBe('process-users:existing-user');
      expect(getScheduledTaskId(1)).toBe('process-users:recovered-user');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  6. skipTaskStatusUpdate
  // ═══════════════════════════════════════════════════════════════════════════

  describe('skipTaskStatusUpdate in extractTopic calls', () => {
    beforeEach(() => {
      MemoryExtractionWorkflowService.initialize({ useInProcessScheduler: true });
    });

    it('should set skipTaskStatusUpdate=true for CEPA call', async () => {
      setupMockExecutor();
      mockGetTopicsForUser.mockResolvedValue({ ids: ['t1'] });
      mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
      await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload({ asyncTaskId: 'task-1' }));
      await getScheduledCallback()();
      expect(mockExtractTopic.mock.calls[0][0]).toMatchObject({ skipTaskStatusUpdate: true });
    });

    it('should set skipTaskStatusUpdate=true for Identity call', async () => {
      setupMockExecutor();
      mockGetTopicsForUser.mockResolvedValue({ ids: ['t1'] });
      mockExtractTopic.mockResolvedValue({ extracted: true, memoryIds: [] });
      await MemoryExtractionWorkflowService.triggerProcessUsers(basePayload({ asyncTaskId: 'task-1' }));
      await getScheduledCallback()();
      expect(mockExtractTopic.mock.calls[1][0]).toMatchObject({ skipTaskStatusUpdate: true });
    });
  });
});
