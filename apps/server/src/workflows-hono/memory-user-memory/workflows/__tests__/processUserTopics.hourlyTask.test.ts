import { MemorySourceType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processUserTopicsHandler } from '../processUserTopics';

const mocks = vi.hoisted(() => ({
  appendUserMemoryWorkflowRunIds: vi.fn(),
  createExecutor: vi.fn(),
  getTopicsForUser: vi.fn(),
  isHourlyMemoryExtractionCancellationRequested: vi.fn(),
  triggerProcessTopics: vi.fn(),
  triggerProcessUserTopics: vi.fn(),
}));

vi.mock('@/server/globalConfig/parseMemoryExtractionConfig', () => ({
  parseMemoryExtractionConfig: () => ({
    upstashWorkflowExtraHeaders: {},
    workflow: { maxTopicsPerUserPerRun: 10 },
  }),
}));

vi.mock('@/server/services/memory/userMemory/extract', () => ({
  buildWorkflowPayloadInput: (payload: unknown) => payload,
  MemoryExtractionExecutor: {
    create: mocks.createExecutor,
  },
  MemoryExtractionWorkflowService: {
    triggerProcessTopics: mocks.triggerProcessTopics,
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

describe('processUserTopicsHandler hourly task behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendUserMemoryWorkflowRunIds.mockResolvedValue(undefined);
    mocks.createExecutor.mockResolvedValue({ getTopicsForUser: mocks.getTopicsForUser });
    mocks.getTopicsForUser.mockResolvedValue({ ids: ['t1', 't2'] });
    mocks.isHourlyMemoryExtractionCancellationRequested.mockResolvedValue(false);
    mocks.triggerProcessTopics.mockResolvedValue({ workflowRunId: 'process-topics-run' });
    mocks.triggerProcessUserTopics.mockResolvedValue({ workflowRunId: 'next-user-topics-run' });
  });

  it('propagates hourlyTaskId and records process-topics workflow run ids', async () => {
    /**
     * @example
     * await processUserTopicsHandler(contextWithHourlyTask);
     */
    const context = createContext({
      baseUrl: 'https://app.example.com',
      hourlyTaskId: '00000000-0000-4000-8000-000000000001',
      sources: [MemorySourceType.ChatTopic],
      userIds: ['u1'],
    });

    await expect(processUserTopicsHandler(context as never)).resolves.toEqual({
      processedUsers: 1,
    });

    expect(mocks.triggerProcessTopics).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        hourlyTaskId: '00000000-0000-4000-8000-000000000001',
        topicIds: ['t1', 't2'],
      }),
      { extraHeaders: {} },
    );
    expect(mocks.appendUserMemoryWorkflowRunIds).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      ['process-topics-run'],
    );
  });

  it('skips process-user-topics fan-out when the hourly task is cancelled', async () => {
    /**
     * @example
     * await expect(processUserTopicsHandler(context)).resolves.toMatchObject({ skipped: true });
     */
    mocks.isHourlyMemoryExtractionCancellationRequested.mockResolvedValue(true);

    const context = createContext({
      baseUrl: 'https://app.example.com',
      hourlyTaskId: '00000000-0000-4000-8000-000000000001',
      sources: [MemorySourceType.ChatTopic],
      userIds: ['u1'],
    });

    await expect(processUserTopicsHandler(context as never)).resolves.toEqual({
      message: 'Hourly memory extraction task cancellation requested, skip user topic fan-out.',
      processedUsers: 0,
      skipped: true,
    });
    expect(mocks.createExecutor).not.toHaveBeenCalled();
    expect(mocks.getTopicsForUser).not.toHaveBeenCalled();
    expect(mocks.triggerProcessTopics).not.toHaveBeenCalled();
  });
});
