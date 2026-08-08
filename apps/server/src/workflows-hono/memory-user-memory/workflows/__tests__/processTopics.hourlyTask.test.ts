import { MemorySourceType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processTopicsHandler } from '../processTopics';

const mocks = vi.hoisted(() => ({
  appendUserMemoryWorkflowRunIds: vi.fn(),
  isHourlyMemoryExtractionCancellationRequested: vi.fn(),
  triggerPersonaUpdate: vi.fn(),
  triggerProcessTopic: vi.fn(),
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

vi.mock('@/server/globalConfig/parseMemoryExtractionConfig', () => ({
  parseMemoryExtractionConfig: () => ({
    upstashWorkflowExtraHeaders: {},
  }),
}));

vi.mock('@/server/services/memory/userMemory/extract', () => ({
  buildWorkflowPayloadInput: (payload: unknown) => payload,
  MemoryExtractionWorkflowService: {
    triggerPersonaUpdate: mocks.triggerPersonaUpdate,
    triggerProcessTopic: mocks.triggerProcessTopic,
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

describe('processTopicsHandler hourly task behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendUserMemoryWorkflowRunIds.mockResolvedValue(undefined);
    mocks.isHourlyMemoryExtractionCancellationRequested.mockResolvedValue(false);
    mocks.triggerPersonaUpdate.mockResolvedValue({ workflowRunId: 'persona-update-run' });
    mocks.triggerProcessTopic.mockResolvedValue({ workflowRunId: 'process-topic-run' });
  });

  it('propagates hourlyTaskId and records process-topic plus persona workflow run ids', async () => {
    /**
     * @example
     * await processTopicsHandler(contextWithHourlyTask);
     */
    const context = createContext({
      baseUrl: 'https://app.example.com',
      hourlyTaskId: '00000000-0000-4000-8000-000000000001',
      sources: [MemorySourceType.ChatTopic],
      topicIds: ['t1'],
      userIds: ['u1'],
    });

    await expect(processTopicsHandler(context as never)).resolves.toMatchObject({
      processedTopics: 1,
      processedUsers: 1,
    });

    expect(mocks.triggerProcessTopic).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        hourlyTaskId: '00000000-0000-4000-8000-000000000001',
        topicIds: ['t1'],
      }),
      { extraHeaders: {} },
    );
    expect(mocks.appendUserMemoryWorkflowRunIds).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      ['process-topic-run'],
    );
    expect(mocks.triggerPersonaUpdate).toHaveBeenCalledWith('u1', 'https://app.example.com', {
      extraHeaders: {},
      hourlyTaskId: '00000000-0000-4000-8000-000000000001',
    });
    expect(mocks.appendUserMemoryWorkflowRunIds).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      ['persona-update-run'],
    );
  });

  it('skips topic fan-out and persona update when the hourly task is cancelled', async () => {
    /**
     * @example
     * await expect(processTopicsHandler(context)).resolves.toMatchObject({ skipped: true });
     */
    mocks.isHourlyMemoryExtractionCancellationRequested.mockResolvedValue(true);

    const context = createContext({
      baseUrl: 'https://app.example.com',
      hourlyTaskId: '00000000-0000-4000-8000-000000000001',
      sources: [MemorySourceType.ChatTopic],
      topicIds: ['t1'],
      userIds: ['u1'],
    });

    await expect(processTopicsHandler(context as never)).resolves.toEqual({
      message: 'Hourly memory extraction task cancellation requested, skip topic batch.',
      processedTopics: 0,
      processedUsers: 0,
      skipped: true,
    });
    expect(mocks.triggerProcessTopic).not.toHaveBeenCalled();
    expect(mocks.triggerPersonaUpdate).not.toHaveBeenCalled();
  });
});
