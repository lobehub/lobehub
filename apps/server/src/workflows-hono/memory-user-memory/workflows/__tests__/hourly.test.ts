import { AsyncTaskStatus } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hourlyWorkflowHandler } from '../hourly';

const mocks = vi.hoisted(() => ({
  appendUserMemoryWorkflowRunIds: vi.fn(),
  createExecutor: vi.fn(),
  getUsersForHourlyExtraction: vi.fn(),
  isHourlyMemoryExtractionCancellationRequested: vi.fn(),
  markHourlyMemoryExtractionSuccess: vi.fn(),
  triggerHourly: vi.fn(),
  triggerHourlyTracked: vi.fn(),
  triggerProcessUsers: vi.fn(),
}));

vi.mock('@/envs/app', () => ({
  appEnv: {
    APP_URL: 'https://app.example.com',
    INTERNAL_APP_URL: undefined,
  },
}));

vi.mock('@/server/globalConfig/parseMemoryExtractionConfig', () => ({
  parseMemoryExtractionConfig: () => ({
    upstashWorkflowExtraHeaders: {},
    webhook: { baseUrl: 'https://app.example.com' },
  }),
}));

vi.mock('@/server/services/memory/userMemory/extract', () => ({
  buildWorkflowPayloadInput: (payload: unknown) => payload,
  MemoryExtractionExecutor: {
    create: mocks.createExecutor,
  },
  MemoryExtractionWorkflowService: {
    triggerHourly: mocks.triggerHourly,
    triggerHourlyTracked: mocks.triggerHourlyTracked,
    triggerProcessUsers: mocks.triggerProcessUsers,
  },
  normalizeMemoryExtractionPayload: (payload: unknown) => payload,
}));

vi.mock('@/database/models/asyncTask', () => ({
  AsyncTaskModel: vi.fn(() => ({
    appendUserMemoryWorkflowRunIds: mocks.appendUserMemoryWorkflowRunIds,
    isHourlyMemoryExtractionCancellationRequested:
      mocks.isHourlyMemoryExtractionCancellationRequested,
    markHourlyMemoryExtractionSuccess: mocks.markHourlyMemoryExtractionSuccess,
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

describe('hourlyWorkflowHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createExecutor.mockResolvedValue({
      getUsersForHourlyExtraction: mocks.getUsersForHourlyExtraction,
    });
    mocks.appendUserMemoryWorkflowRunIds.mockResolvedValue(undefined);
    mocks.isHourlyMemoryExtractionCancellationRequested.mockResolvedValue(false);
    mocks.markHourlyMemoryExtractionSuccess.mockResolvedValue(undefined);
    mocks.triggerHourly.mockResolvedValue({ workflowRunId: 'next-page-run' });
    mocks.triggerHourlyTracked.mockResolvedValue({
      taskId: '00000000-0000-4000-8000-000000000001',
      workflowRunId: 'tracked-hourly-run',
    });
    mocks.triggerProcessUsers.mockResolvedValue({ workflowRunId: 'process-users-run' });
  });

  it('creates a tracked hourly task when the entrypoint has no hourlyTaskId', async () => {
    /**
     * @example
     * await expect(hourlyWorkflowHandler(cronContext)).resolves.toMatchObject({ scheduled: true });
     */
    const context = {
      requestPayload: { dryRun: true },
      run: vi.fn((_name: string, callback: () => unknown) => callback()),
      workflowRunId: 'entry-hourly-run',
    };

    await expect(hourlyWorkflowHandler(context as never)).resolves.toEqual({
      dryRun: true,
      message: 'Tracked hourly memory extraction task scheduled.',
      scheduled: true,
      taskId: '00000000-0000-4000-8000-000000000001',
      workflowRunId: 'tracked-hourly-run',
    });

    expect(mocks.triggerHourlyTracked).toHaveBeenCalledWith(
      {
        baseUrl: 'https://app.example.com',
        cursor: undefined,
        dryRun: true,
      },
      { entryWorkflowRunId: 'entry-hourly-run', extraHeaders: {} },
    );
    expect(mocks.createExecutor).not.toHaveBeenCalled();
    expect(mocks.triggerProcessUsers).not.toHaveBeenCalled();
  });

  it('continues pagination when Upstash restores the user batch cursor as JSON', async () => {
    /**
     * @example
     * await expect(hourlyWorkflowHandler(context)).resolves.toMatchObject({ hasNextPage: true });
     */
    // ROOT CAUSE:
    //
    // Upstash Workflow persists context.run results as JSON between steps.
    // Date values returned from the user listing step come back as ISO strings.
    //
    // Before the fix, hourlyWorkflowHandler called:
    // userBatch.cursor.createdAt.toISOString()
    //
    // We should normalize that boundary before scheduling the next page.
    mocks.getUsersForHourlyExtraction.mockResolvedValue({
      cursor: {
        createdAt: '2024-07-02T09:36:44.073Z',
        id: 'user_2igX4ULK7Q2tADwibFkEpng0xRc',
      },
      ids: ['user_2gmT7yMAt730UeHuzNpjZiw4Z2X'],
    });

    const context = {
      requestPayload: {
        dryRun: true,
        hourlyTaskId: '00000000-0000-4000-8000-000000000001',
      },
      run: vi.fn((_name: string, callback: () => unknown) => callback()),
    };

    await expect(hourlyWorkflowHandler(context as never)).resolves.toMatchObject({
      dryRun: true,
      hasNextPage: true,
      processedUsers: 1,
      scheduledBatches: 0,
    });
    expect(mocks.triggerHourly).toHaveBeenCalledWith(
      {
        baseUrl: 'https://app.example.com',
        cursor: {
          createdAt: '2024-07-02T09:36:44.073Z',
          id: 'user_2igX4ULK7Q2tADwibFkEpng0xRc',
        },
        dryRun: true,
        hourlyTaskId: '00000000-0000-4000-8000-000000000001',
      },
      { extraHeaders: {} },
    );
  });

  it('propagates hourlyTaskId and records process-users workflow run ids', async () => {
    /**
     * @example
     * await hourlyWorkflowHandler(contextWithHourlyTask);
     */
    mocks.getUsersForHourlyExtraction.mockResolvedValue({
      ids: Array.from({ length: 21 }, (_, index) => `user-${index + 1}`),
    });

    const context = {
      requestPayload: { hourlyTaskId: '00000000-0000-4000-8000-000000000001' },
      run: vi.fn((_name: string, callback: () => unknown) => callback()),
    };

    await expect(hourlyWorkflowHandler(context as never)).resolves.toMatchObject({
      processedUsers: 21,
      scheduledBatches: 2,
    });

    expect(mocks.triggerProcessUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        hourlyTaskId: '00000000-0000-4000-8000-000000000001',
        userIds: expect.any(Array),
      }),
      { extraHeaders: {} },
    );
    expect(mocks.appendUserMemoryWorkflowRunIds).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      ['process-users-run'],
    );
  });

  it('skips hourly fan-out when the hourly task is cancelled', async () => {
    /**
     * @example
     * await expect(hourlyWorkflowHandler(context)).resolves.toMatchObject({ skipped: true });
     */
    mocks.isHourlyMemoryExtractionCancellationRequested.mockResolvedValue(true);
    mocks.getUsersForHourlyExtraction.mockResolvedValue({
      ids: ['user-1'],
    });

    const context = {
      requestPayload: { hourlyTaskId: '00000000-0000-4000-8000-000000000001' },
      run: vi.fn((_name: string, callback: () => unknown) => callback()),
    };

    await expect(hourlyWorkflowHandler(context as never)).resolves.toEqual({
      message: 'Hourly memory extraction task cancellation requested, skip hourly fan-out.',
      processedUsers: 0,
      skipped: true,
    });
    expect(mocks.triggerProcessUsers).not.toHaveBeenCalled();
  });

  it('marks the hourly task as success when the final user page has been scheduled', async () => {
    mocks.getUsersForHourlyExtraction.mockResolvedValue({
      ids: Array.from({ length: 21 }, (_, index) => `user-${index + 1}`),
    });

    const context = {
      requestPayload: { hourlyTaskId: '00000000-0000-4000-8000-000000000001' },
      run: vi.fn((_name: string, callback: () => unknown) => callback()),
    };

    await expect(hourlyWorkflowHandler(context as never)).resolves.toMatchObject({
      processedUsers: 21,
      scheduledBatches: 2,
    });

    expect(mocks.markHourlyMemoryExtractionSuccess).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      {
        processedUsers: 21,
        scheduledBatches: 2,
        scheduledChildRuns: 2,
        status: AsyncTaskStatus.Success,
      },
    );
  });
});
