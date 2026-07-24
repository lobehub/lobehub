import { MemorySourceType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processTopicHandler } from '../processTopic';

const mocks = vi.hoisted(() => ({
  createExecutor: vi.fn(),
  extractTopic: vi.fn(),
  isHourlyMemoryExtractionCancellationRequested: vi.fn(),
}));

vi.mock('@lobechat/observability-otel/modules/upstash-workflow', () => ({
  buildUpstashWorkflowMetricAttributes: vi.fn(() => ({})),
  tracer: {
    startActiveSpan: vi.fn((_name: string, callback: (span: unknown) => unknown) =>
      callback({
        end: vi.fn(),
        recordException: vi.fn(),
        setAttributes: vi.fn(),
        setStatus: vi.fn(),
      }),
    ),
  },
}));

vi.mock('@/server/services/memory/userMemory/extract', () => ({
  MemoryExtractionExecutor: {
    create: mocks.createExecutor,
  },
  normalizeMemoryExtractionPayload: (payload: Record<string, unknown>) => ({
    ...payload,
    forceAll: payload.forceAll ?? false,
    forceTopics: payload.forceTopics ?? false,
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

describe('processTopicHandler hourly task behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createExecutor.mockResolvedValue({ extractTopic: mocks.extractTopic });
    mocks.extractTopic.mockResolvedValue(undefined);
    mocks.isHourlyMemoryExtractionCancellationRequested.mockResolvedValue(false);
  });

  it('checks hourly cancellation before CEPA and identity extraction', async () => {
    /**
     * @example
     * await processTopicHandler(contextWithHourlyTask);
     */
    const context = createContext({
      baseUrl: 'https://app.example.com',
      hourlyTaskId: '00000000-0000-4000-8000-000000000001',
      sources: [MemorySourceType.ChatTopic],
      topicIds: ['t1'],
      userIds: ['u1'],
    });

    await expect(processTopicHandler(context as never)).resolves.toMatchObject({
      processedTopics: 1,
      processedUsers: 1,
    });

    expect(mocks.isHourlyMemoryExtractionCancellationRequested).toHaveBeenCalledTimes(2);
    expect(mocks.extractTopic).toHaveBeenCalledTimes(2);
  });

  it('skips CEPA extraction when the hourly task is cancelled before heavy work', async () => {
    /**
     * @example
     * await expect(processTopicHandler(context)).resolves.toMatchObject({ skipped: true });
     */
    mocks.isHourlyMemoryExtractionCancellationRequested.mockResolvedValue(true);

    const context = createContext({
      baseUrl: 'https://app.example.com',
      hourlyTaskId: '00000000-0000-4000-8000-000000000001',
      sources: [MemorySourceType.ChatTopic],
      topicIds: ['t1'],
      userIds: ['u1'],
    });

    await expect(processTopicHandler(context as never)).resolves.toEqual({
      message: 'Hourly memory extraction task cancellation requested, skip topic.',
      skipped: true,
    });
    expect(mocks.createExecutor).not.toHaveBeenCalled();
    expect(mocks.extractTopic).not.toHaveBeenCalled();
  });
});
