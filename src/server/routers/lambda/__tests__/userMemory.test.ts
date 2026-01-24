import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { userMemoryRouter } from '@/server/routers/lambda/userMemory';
import { AsyncTaskStatus, AsyncTaskType } from '@/types/asyncTask';
import { MemorySourceType } from '@/types/userMemory';

const mockFindActiveByType = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockFindById = vi.fn();

const mockCountTopicsForMemoryExtractor = vi.fn();
const { mockTriggerProcessUsers } = vi.hoisted(() => ({
  mockTriggerProcessUsers: vi.fn(),
}));

vi.mock('@/database/models/asyncTask', () => ({
  AsyncTaskModel: vi.fn(() => ({
    create: mockCreate,
    findById: mockFindById,
    findActiveByType: mockFindActiveByType,
    update: mockUpdate,
  })),
  initUserMemoryExtractionMetadata: vi.fn((metadata) => metadata),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(() => ({
    countTopicsForMemoryExtractor: mockCountTopicsForMemoryExtractor,
  })),
}));

vi.mock('@/envs/app', () => ({
  appEnv: {
    APP_URL: 'https://example.com',
    INTERNAL_APP_URL: 'https://internal.example.com',
  },
}));

vi.mock('@/server/globalConfig/parseMemoryExtractionConfig', () => ({
  parseMemoryExtractionConfig: vi.fn(() => ({
    webhook: { baseUrl: 'https://internal.example.com' },
    upstashWorkflowExtraHeaders: { 'x-test': 'ok' },
  })),
}));

vi.mock('@/server/services/memory/userMemory/extract', () => ({
  MemoryExtractionWorkflowService: {
    triggerProcessUsers: mockTriggerProcessUsers,
  },
  buildWorkflowPayloadInput: (payload: any) => payload,
  normalizeMemoryExtractionPayload: (payload: any) => payload,
}));

const createCaller = (ctxOverrides: Partial<any> = {}) => {
  const ctx = {
    serverDB: {} as any,
    userId: 'user-1',
    ...ctxOverrides,
  };

  return userMemoryRouter.createCaller(ctx);
};

describe('userMemoryRouter.requestMemoryFromChatTopic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dedupes when an active task exists', async () => {
    mockFindActiveByType.mockResolvedValue({
      id: 'existing-task',
      metadata: { progress: { completedTopics: 0, totalTopics: 1 } },
      status: AsyncTaskStatus.Pending,
    });

    const caller = createCaller();
    const result = await caller.requestMemoryFromChatTopic({});

    expect(result).toEqual({
      deduped: true,
      id: 'existing-task',
      metadata: { progress: { completedTopics: 0, totalTopics: 1 } },
      status: AsyncTaskStatus.Pending,
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockTriggerProcessUsers).not.toHaveBeenCalled();
  });

  it('creates task and triggers workflow with user context and dates', async () => {
    mockFindActiveByType.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue('new-task');
    mockCountTopicsForMemoryExtractor.mockResolvedValue(2);

    const caller = createCaller();
    const result = await caller.requestMemoryFromChatTopic({
      fromDate: new Date('2024-01-01'),
      toDate: new Date('2024-02-01'),
    });

    expect(mockCreate).toHaveBeenCalledWith({
      metadata: {
        progress: { completedTopics: 0, totalTopics: 2 },
        range: { from: new Date('2024-01-01').toISOString(), to: new Date('2024-02-01').toISOString() },
        source: 'chat_topic',
      },
      status: AsyncTaskStatus.Pending,
      type: AsyncTaskType.UserMemoryExtractionWithChatTopic,
    });
    expect(mockTriggerProcessUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        asyncTaskId: 'new-task',
        baseUrl: 'https://internal.example.com',
        fromDate: new Date('2024-01-01'),
        sources: [MemorySourceType.ChatTopic],
        toDate: new Date('2024-02-01'),
        userIds: ['user-1'],
        userInitiated: true,
      }),
      { extraHeaders: { 'x-test': 'ok' } },
    );
    expect(result).toMatchObject({
      deduped: false,
      id: 'new-task',
      status: AsyncTaskStatus.Pending,
    });
  });

  it('returns success immediately when no topics', async () => {
    mockFindActiveByType.mockResolvedValue(undefined);
    mockCountTopicsForMemoryExtractor.mockResolvedValue(0);
    mockCreate.mockResolvedValue('empty-task');

    const caller = createCaller();
    const result = await caller.requestMemoryFromChatTopic({});

    expect(result).toEqual({
      deduped: false,
      id: 'empty-task',
      metadata: {
        progress: { completedTopics: 0, totalTopics: 0 },
        range: { from: undefined, to: undefined },
        source: 'chat_topic',
      },
      status: AsyncTaskStatus.Success,
    });
    expect(mockTriggerProcessUsers).not.toHaveBeenCalled();
  });

  it('throws on invalid date range', async () => {
    const caller = createCaller();
    await expect(
      caller.requestMemoryFromChatTopic({
        fromDate: new Date('2024-02-02'),
        toDate: new Date('2024-01-01'),
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});

describe('userMemoryRouter.getMemoryExtractionTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no active task', async () => {
    mockFindActiveByType.mockResolvedValue(undefined);

    const caller = createCaller();
    const result = await caller.getMemoryExtractionTask();

    expect(result).toBeNull();
  });

  it('returns active task with normalized metadata', async () => {
    mockFindActiveByType.mockResolvedValue({
      id: 'task-1',
      metadata: {
        progress: { completedTopics: 1, totalTopics: 4 },
        source: 'chat_topic',
      },
      status: AsyncTaskStatus.Processing,
      userId: 'user-1',
    });

    const caller = createCaller();
    const result = await caller.getMemoryExtractionTask();

    expect(result).toEqual({
      error: undefined,
      id: 'task-1',
      metadata: {
        progress: { completedTopics: 1, totalTopics: 4 },
        range: undefined,
        source: 'chat_topic',
      },
      status: AsyncTaskStatus.Processing,
    });
  });

  it('fetches by task id when provided', async () => {
    mockFindActiveByType.mockResolvedValue(undefined);
    mockFindById.mockResolvedValue({
      id: 'a0a0a0a0-a0a0-4a0a-a0a0-a0a0a0a0a0a0',
      metadata: {
        progress: { completedTopics: 2, totalTopics: 8 },
        source: 'chat_topic',
      },
      status: AsyncTaskStatus.Pending,
      userId: 'user-1',
    });

    const caller = createCaller();
    const result = await caller.getMemoryExtractionTask({
      taskId: 'a0a0a0a0-a0a0-4a0a-a0a0-a0a0a0a0a0a0',
    });

    expect(mockFindById).toHaveBeenCalledWith('a0a0a0a0-a0a0-4a0a-a0a0-a0a0a0a0a0a0');
    expect(result?.id).toBe('a0a0a0a0-a0a0-4a0a-a0a0-a0a0a0a0a0a0');
  });
});
