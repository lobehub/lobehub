import { LayersEnum, MemorySourceType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStepRunner } from '@/server/workflows/testing/stepContext';

import { processTopicHandler } from '../processTopic';

const mocks = vi.hoisted(() => ({
  createExecutor: vi.fn(),
  extractTopic: vi.fn(),
  isHourlyMemoryExtractionCancellationRequested: vi.fn(),
}));

vi.mock('@lobechat/observability-otel/modules/upstash-workflow', () => ({
  buildUpstashWorkflowMetricAttributes: vi.fn(function () {
    return {};
  }),
  tracer: {
    startActiveSpan: vi.fn(function (_name: string, callback: (span: unknown) => unknown) {
      return callback({
        end: vi.fn(),
        recordException: vi.fn(),
        setAttributes: vi.fn(),
        setStatus: vi.fn(),
      });
    }),
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
  AsyncTaskModel: vi.fn(function () {
    return {
      isHourlyMemoryExtractionCancellationRequested:
        mocks.isHourlyMemoryExtractionCancellationRequested,
    };
  }),
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
  run: createStepRunner(),
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

  it('never asks the extractor for the retired experience layer', async () => {
    /**
     * @example
     * Experience extraction is retired; neither the default layer set nor an explicit
     * request may reach the extractor with LayersEnum.Experience.
     */
    const explicit = createContext({
      baseUrl: 'https://app.example.com',
      layers: [LayersEnum.Experience, LayersEnum.Context, LayersEnum.Identity],
      sources: [MemorySourceType.ChatTopic],
      topicIds: ['t1'],
      userIds: ['u1'],
    });
    await processTopicHandler(explicit as never);

    const implicit = createContext({
      baseUrl: 'https://app.example.com',
      sources: [MemorySourceType.ChatTopic],
      topicIds: ['t1'],
      userIds: ['u1'],
    });
    await processTopicHandler(implicit as never);

    expect(mocks.extractTopic).toHaveBeenCalledTimes(4);
    for (const [call] of mocks.extractTopic.mock.calls) {
      expect(call.layers).not.toContain(LayersEnum.Experience);
    }
    expect(mocks.extractTopic.mock.calls[2][0].layers).toEqual([
      LayersEnum.Context,
      LayersEnum.Preference,
      LayersEnum.Activity,
    ]);
  });

  it('skips both extraction blocks for a request that names only the retired experience layer', async () => {
    /**
     * @example
     * The executor treats an empty layer list as unrestricted, so an Experience-only request
     * must not reach it at all — neither the CEPA block nor the identity block runs.
     */
    const context = createContext({
      baseUrl: 'https://app.example.com',
      layers: [LayersEnum.Experience],
      sources: [MemorySourceType.ChatTopic],
      topicIds: ['t1'],
      userIds: ['u1'],
    });

    await processTopicHandler(context as never);

    expect(mocks.extractTopic).not.toHaveBeenCalled();
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
