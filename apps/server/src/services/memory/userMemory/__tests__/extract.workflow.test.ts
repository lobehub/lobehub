// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
} from '@/types/asyncTask';

import { MemoryExtractionWorkflowService } from '../extract';

interface HourlyMetadataInput {
  cursor?: {
    createdAt: string;
    id: string;
  };
  startedAt: string;
}

const {
  mockAppendUserMemoryWorkflowRunIds,
  mockAsyncTaskModel,
  mockCreate,
  mockFindFirst,
  mockGetServerDB,
  mockTrigger,
  mockUpdate,
} = vi.hoisted(() => ({
  mockAppendUserMemoryWorkflowRunIds: vi.fn(),
  mockAsyncTaskModel: vi.fn(),
  mockCreate: vi.fn(),
  mockFindFirst: vi.fn(),
  mockGetServerDB: vi.fn(),
  mockTrigger: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('@/database/server', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/database/models/asyncTask', () => ({
  AsyncTaskModel: mockAsyncTaskModel,
  initHourlyUserMemoryExtractionMetadata: vi.fn((metadata: HourlyMetadataInput) => ({
    control: (metadata as HourlyMetadataInput & { control?: unknown }).control,
    cursor: metadata.cursor,
    progress: {
      processedUsers: 0,
      scheduledBatches: 0,
      scheduledChildRuns: 0,
    },
    source: 'hourly_chat_topic',
    startedAt: metadata.startedAt,
  })),
}));

vi.mock('@/libs/qstash', () => ({
  OtelWorkflowClient: vi.fn(() => ({
    trigger: mockTrigger,
  })),
}));

describe('MemoryExtractionWorkflowService.triggerHourlyTracked', () => {
  const originalServiceUserId = process.env.MEMORY_EXTRACTION_HOURLY_TASK_USER_ID;
  const originalQstashToken = process.env.QSTASH_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-06T00:00:00.000Z'));

    process.env.MEMORY_EXTRACTION_HOURLY_TASK_USER_ID = 'service-account-user';
    process.env.QSTASH_TOKEN = 'test-qstash-token';

    mockGetServerDB.mockResolvedValue({
      db: 'server',
      query: { asyncTasks: { findFirst: mockFindFirst } },
    });
    mockCreate.mockResolvedValue('00000000-0000-4000-8000-000000000001');
    mockFindFirst.mockResolvedValue(undefined);
    mockAppendUserMemoryWorkflowRunIds.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);
    mockTrigger.mockResolvedValue({ workflowRunId: 'workflow-run-1' });
    mockAsyncTaskModel.mockImplementation(() => ({
      appendUserMemoryWorkflowRunIds: mockAppendUserMemoryWorkflowRunIds,
      create: mockCreate,
      update: mockUpdate,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();

    if (originalServiceUserId === undefined) {
      delete process.env.MEMORY_EXTRACTION_HOURLY_TASK_USER_ID;
    } else {
      process.env.MEMORY_EXTRACTION_HOURLY_TASK_USER_ID = originalServiceUserId;
    }

    if (originalQstashToken === undefined) {
      delete process.env.QSTASH_TOKEN;
    } else {
      process.env.QSTASH_TOKEN = originalQstashToken;
    }
  });

  it('creates an hourly async task, triggers the workflow, and appends the root run id', async () => {
    /**
     * @example
     * await MemoryExtractionWorkflowService.triggerHourlyTracked({ baseUrl });
     */
    const result = await MemoryExtractionWorkflowService.triggerHourlyTracked(
      {
        baseUrl: 'https://app.example.com',
        cursor: {
          createdAt: '2026-07-05T23:00:00.000Z',
          id: 'cursor-user',
        },
      },
      { extraHeaders: { 'x-test-header': '1' } },
    );

    expect(result).toEqual({
      taskId: '00000000-0000-4000-8000-000000000001',
      workflowRunId: 'workflow-run-1',
    });
    expect(mockGetServerDB).toHaveBeenCalledTimes(1);
    expect(mockAsyncTaskModel).toHaveBeenCalledWith(
      { db: 'server', query: { asyncTasks: { findFirst: mockFindFirst } } },
      'service-account-user',
    );
    expect(mockCreate).toHaveBeenCalledWith({
      metadata: {
        control: undefined,
        cursor: {
          createdAt: '2026-07-05T23:00:00.000Z',
          id: 'cursor-user',
        },
        progress: {
          processedUsers: 0,
          scheduledBatches: 0,
          scheduledChildRuns: 0,
        },
        source: 'hourly_chat_topic',
        startedAt: '2026-07-06T00:00:00.000Z',
      },
      status: AsyncTaskStatus.Pending,
      type: AsyncTaskType.UserMemoryExtractionHourly,
    });
    expect(mockTrigger).toHaveBeenCalledWith({
      body: {
        baseUrl: 'https://app.example.com',
        cursor: {
          createdAt: '2026-07-05T23:00:00.000Z',
          id: 'cursor-user',
        },
        hourlyTaskId: '00000000-0000-4000-8000-000000000001',
      },
      headers: { 'x-test-header': '1' },
      url: 'https://app.example.com/api/workflows/memory-user-memory/call-cron-hourly-analysis',
    });
    expect(mockAppendUserMemoryWorkflowRunIds).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      ['workflow-run-1'],
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('uses deterministic workflow run ids when an entry workflow run id is provided', async () => {
    /**
     * @example
     * await MemoryExtractionWorkflowService.triggerHourlyTracked({ baseUrl }, { entryWorkflowRunId });
     */
    const result = await MemoryExtractionWorkflowService.triggerHourlyTracked(
      {
        baseUrl: 'https://app.example.com',
      },
      { entryWorkflowRunId: 'entry-run-1' },
    );

    expect(result).toEqual({
      taskId: '00000000-0000-4000-8000-000000000001',
      workflowRunId: 'workflow-run-1',
    });
    expect(mockCreate).toHaveBeenCalledWith({
      metadata: {
        control: {
          upstash: {
            entryWorkflowRunId: 'entry-run-1',
            workflowRunIds: ['entry-run-1', 'memory-user-memory-hourly-entry-run-1'],
          },
        },
        cursor: undefined,
        progress: {
          processedUsers: 0,
          scheduledBatches: 0,
          scheduledChildRuns: 0,
        },
        source: 'hourly_chat_topic',
        startedAt: '2026-07-06T00:00:00.000Z',
      },
      status: AsyncTaskStatus.Pending,
      type: AsyncTaskType.UserMemoryExtractionHourly,
    });
    expect(mockTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'memory-user-memory-hourly-entry-run-1',
      }),
    );
  });

  it('marks the created async task as error and rethrows when workflow scheduling fails', async () => {
    /**
     * @example
     * await expect(MemoryExtractionWorkflowService.triggerHourlyTracked({ baseUrl })).rejects.toThrow();
     */
    const triggerError = new Error('upstash unavailable');
    mockTrigger.mockRejectedValue(triggerError);

    await expect(
      MemoryExtractionWorkflowService.triggerHourlyTracked({
        baseUrl: 'https://app.example.com',
      }),
    ).rejects.toBe(triggerError);

    expect(mockCreate).toHaveBeenCalledWith({
      metadata: {
        control: undefined,
        cursor: undefined,
        progress: {
          processedUsers: 0,
          scheduledBatches: 0,
          scheduledChildRuns: 0,
        },
        source: 'hourly_chat_topic',
        startedAt: '2026-07-06T00:00:00.000Z',
      },
      status: AsyncTaskStatus.Pending,
      type: AsyncTaskType.UserMemoryExtractionHourly,
    });
    expect(mockUpdate).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001', {
      error: new AsyncTaskError(
        AsyncTaskErrorType.TaskTriggerError,
        'Failed to schedule hourly memory extraction workflow',
      ),
      status: AsyncTaskStatus.Error,
    });
    expect(mockAppendUserMemoryWorkflowRunIds).not.toHaveBeenCalled();
  });

  it('throws before triggering when the service-account user id env is missing', async () => {
    /**
     * @example
     * await expect(MemoryExtractionWorkflowService.triggerHourlyTracked({ baseUrl })).rejects.toThrow();
     */
    delete process.env.MEMORY_EXTRACTION_HOURLY_TASK_USER_ID;

    await expect(
      MemoryExtractionWorkflowService.triggerHourlyTracked({
        baseUrl: 'https://app.example.com',
      }),
    ).rejects.toThrow(
      'MEMORY_EXTRACTION_HOURLY_TASK_USER_ID is required for tracked hourly extraction',
    );

    expect(mockGetServerDB).not.toHaveBeenCalled();
    expect(mockAsyncTaskModel).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockTrigger).not.toHaveBeenCalled();
  });
});
