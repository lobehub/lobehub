import { LayersEnum, MemorySourceType } from '@lobechat/types';
import { WorkflowAbort } from '@upstash/workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStepRunner } from '@/server/workflows/testing/stepContext';

import { processTopicHandler } from '../processTopic';
import { checkGuard, ensureWorkflowStarted } from '../runGuard';

const mocks = vi.hoisted(() => ({
  incrementProgress: vi.fn(),
  isBanned: vi.fn(),
  spanEnd: vi.fn(),
  createExecutor: vi.fn(),
  extractTopic: vi.fn(),
  isHourlyMemoryExtractionCancellationRequested: vi.fn(),
  shouldConsolidateAfterExtraction: vi.fn(),
  triggerConsolidation: vi.fn(),
}));

vi.mock('@lobechat/observability-otel/modules/upstash-workflow', () => ({
  buildUpstashWorkflowMetricAttributes: vi.fn(function () {
    return {};
  }),
  tracer: {
    startActiveSpan: vi.fn(function (_name: string, callback: (span: unknown) => unknown) {
      return callback({
        end: mocks.spanEnd,
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
  MemoryExtractionWorkflowService: { triggerConsolidation: mocks.triggerConsolidation },
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
      incrementUserMemoryExtractionProgress: mocks.incrementProgress,
      isUserMemoryExtractionCancellationRequested: vi.fn(async () => false),
    };
  }),
}));

vi.mock('@/database/models/userMemory/consolidation', () => ({
  shouldConsolidateAfterExtraction: mocks.shouldConsolidateAfterExtraction,
}));

vi.mock('@/server/globalConfig/parseMemoryExtractionConfig', () => ({
  parseMemoryExtractionConfig: () => ({ upstashWorkflowExtraHeaders: {} }),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: { isBanned: mocks.isBanned },
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
    mocks.isBanned.mockResolvedValue(false);
    mocks.isHourlyMemoryExtractionCancellationRequested.mockResolvedValue(false);
    mocks.shouldConsolidateAfterExtraction.mockResolvedValue(true);
    mocks.triggerConsolidation.mockResolvedValue({ workflowRunId: 'consolidation-run' });
  });

  const topicPayload = {
    baseUrl: 'https://app.example.com',
    sources: [MemorySourceType.ChatTopic],
    topicIds: ['t1'],
    userIds: ['u1'],
  };

  it('schedules a delayed consolidation after a topic writes a context', async () => {
    mocks.extractTopic.mockResolvedValueOnce({
      extracted: true,
      layers: { [LayersEnum.Context]: 1 },
      memoryIds: ['m1'],
    });

    await processTopicHandler(createContext(topicPayload) as never);

    expect(mocks.triggerConsolidation).toHaveBeenCalledWith('u1', 'https://app.example.com', {
      delay: 600,
      extraHeaders: {},
    });
  });

  it('does not consolidate when the topic wrote no context or the backlog awaits the backfill', async () => {
    mocks.extractTopic.mockResolvedValueOnce({
      extracted: true,
      layers: { [LayersEnum.Preference]: 2 },
      memoryIds: ['m1', 'm2'],
    });
    await processTopicHandler(createContext(topicPayload) as never);
    expect(mocks.shouldConsolidateAfterExtraction).not.toHaveBeenCalled();

    mocks.extractTopic.mockResolvedValueOnce({
      extracted: true,
      layers: { [LayersEnum.Context]: 1 },
      memoryIds: ['m1'],
    });
    mocks.shouldConsolidateAfterExtraction.mockResolvedValueOnce(false);
    await processTopicHandler(createContext(topicPayload) as never);
    expect(mocks.shouldConsolidateAfterExtraction).toHaveBeenCalledTimes(1);

    expect(mocks.triggerConsolidation).not.toHaveBeenCalled();
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

  it('cancels a banned user untracked run before any step instead of returning', async () => {
    mocks.isBanned.mockResolvedValue(true);
    // Upstash's request authentication and its real context both surface cancel() as a
    // WorkflowAbort; a handler that returns instead fails authentication with a 400.
    const cancel = vi.fn().mockRejectedValue(new WorkflowAbort('cancel', undefined, true));
    const context = {
      ...createContext({
        baseUrl: 'https://app.example.com',
        sources: [MemorySourceType.ChatTopic],
        topicIds: ['t1'],
        userIds: ['u1'],
      }),
      cancel,
    };

    await expect(processTopicHandler(context as never)).rejects.toBeInstanceOf(WorkflowAbort);

    expect(cancel).toHaveBeenCalledTimes(1);
    // Ends before any persisted step, so nothing is queued on the shared flow-control key. The
    // startup helpers are mocked, so assert they were never reached rather than `context.run`.
    expect(ensureWorkflowStarted).not.toHaveBeenCalled();
    expect(checkGuard).not.toHaveBeenCalled();
    expect(context.run).not.toHaveBeenCalled();
    expect(mocks.extractTopic).not.toHaveBeenCalled();
    expect(mocks.spanEnd).toHaveBeenCalledTimes(1);
  });

  it('still reports progress for a banned user tracked task, without extracting', async () => {
    mocks.isBanned.mockResolvedValue(true);
    const context = createContext({
      asyncTaskId: '00000000-0000-4000-8000-000000000002',
      baseUrl: 'https://app.example.com',
      sources: [MemorySourceType.ChatTopic],
      topicIds: ['t1'],
      userIds: ['u1'],
      userInitiated: true,
    });

    await processTopicHandler(context as never);

    // The extraction steps stay in the sequence, so a ban during replay cannot shift it.
    const steps = (context.run as ReturnType<typeof vi.fn>).mock.calls.map(([name]) => name);
    expect(steps.some((name: string) => name.endsWith(':cepa'))).toBe(true);
    expect(steps.some((name: string) => name.endsWith(':identity'))).toBe(true);
    expect(mocks.extractTopic).not.toHaveBeenCalled();
    expect(mocks.incrementProgress).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000002');
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
