import { MemorySourceType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processUsersHandler } from '../processUsers';

const mocks = vi.hoisted(() => ({
  appendUserMemoryWorkflowRunIds: vi.fn(),
  createExecutor: vi.fn(),
  getUsers: vi.fn(),
  isHourlyMemoryExtractionCancellationRequested: vi.fn(),
  triggerProcessUsers: vi.fn(),
  triggerProcessUserTopics: vi.fn(),
}));

vi.mock('@/server/globalConfig/parseMemoryExtractionConfig', () => ({
  parseMemoryExtractionConfig: () => ({
    upstashWorkflowExtraHeaders: {},
  }),
}));

vi.mock('@/server/services/memory/userMemory/extract', () => ({
  buildWorkflowPayloadInput: (payload: unknown) => payload,
  MemoryExtractionExecutor: {
    create: mocks.createExecutor,
  },
  MemoryExtractionWorkflowService: {
    triggerProcessUsers: mocks.triggerProcessUsers,
    triggerProcessUserTopics: mocks.triggerProcessUserTopics,
  },
  normalizeMemoryExtractionPayload: (payload: Record<string, unknown>) => ({
    ...payload,
    layers: payload.layers ?? [],
    mode: payload.mode ?? 'workflow',
    sources: payload.sources ?? [],
    topicFanoutCount: payload.topicFanoutCount ?? 0,
    topicIds: payload.topicIds ?? [],
    userIds: payload.userIds ?? [],
  }),
}));

vi.mock('@/database/models/asyncTask', () => ({
  AsyncTaskModel: vi.fn(() => ({
    appendUserMemoryWorkflowRunIds: mocks.appendUserMemoryWorkflowRunIds,
    isHourlyMemoryExtractionCancellationRequested:
      mocks.isHourlyMemoryExtractionCancellationRequested,
  })),
}));

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(async () => ({
    query: {
      asyncTasks: {
        findFirst: vi.fn(async () => ({ userId: 'hourly-task-user', workspaceId: null })),
      },
    },
  })),
}));

vi.mock('../runGuard', () => ({
  checkGuard: vi.fn().mockResolvedValue({ result: true }),
  ensureWorkflowStarted: vi.fn().mockResolvedValue({ started: true }),
}));

const createContext = (requestPayload: Record<string, unknown>) => ({
  requestPayload,
  run: vi.fn((_name: string, callback: () => unknown) => callback()),
});

describe('processUsersHandler hourly task behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendUserMemoryWorkflowRunIds.mockResolvedValue(undefined);
    mocks.createExecutor.mockResolvedValue({ getUsers: mocks.getUsers });
    mocks.isHourlyMemoryExtractionCancellationRequested.mockResolvedValue(false);
    mocks.triggerProcessUsers.mockResolvedValue({ workflowRunId: 'next-process-users-run' });
    mocks.triggerProcessUserTopics.mockResolvedValue({ workflowRunId: 'process-user-topics-run' });
  });

  it('propagates hourlyTaskId and records process-user-topics workflow run ids', async () => {
    /**
     * @example
     * await processUsersHandler(contextWithHourlyTask);
     */
    const context = createContext({
      baseUrl: 'https://app.example.com',
      hourlyTaskId: '00000000-0000-4000-8000-000000000001',
      sources: [MemorySourceType.ChatTopic],
      userIds: ['u1', 'u2'],
    });

    await expect(processUsersHandler(context as never)).resolves.toMatchObject({
      processedUsers: 2,
    });

    expect(mocks.triggerProcessUserTopics).toHaveBeenCalledWith(
      expect.objectContaining({
        hourlyTaskId: '00000000-0000-4000-8000-000000000001',
        userIds: ['u1', 'u2'],
      }),
      { extraHeaders: {} },
    );
    expect(mocks.appendUserMemoryWorkflowRunIds).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      ['process-user-topics-run'],
    );
  });

  it('skips process-users fan-out when the hourly task is cancelled', async () => {
    /**
     * @example
     * await expect(processUsersHandler(context)).resolves.toMatchObject({ skipped: true });
     */
    mocks.isHourlyMemoryExtractionCancellationRequested.mockResolvedValue(true);

    const context = createContext({
      baseUrl: 'https://app.example.com',
      hourlyTaskId: '00000000-0000-4000-8000-000000000001',
      sources: [MemorySourceType.ChatTopic],
      userIds: ['u1'],
    });

    await expect(processUsersHandler(context as never)).resolves.toEqual({
      message: 'Hourly memory extraction task cancellation requested, skip processing users.',
      skipped: true,
    });
    expect(mocks.createExecutor).not.toHaveBeenCalled();
    expect(mocks.getUsers).not.toHaveBeenCalled();
    expect(mocks.triggerProcessUserTopics).not.toHaveBeenCalled();
  });
});
