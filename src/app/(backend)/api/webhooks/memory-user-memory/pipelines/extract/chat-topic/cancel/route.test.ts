import { AsyncTaskStatus, AsyncTaskType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AsyncTaskModelModule from '@/database/models/asyncTask';

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@upstash/workflow', () => ({
  Client: vi.fn(() => ({
    cancel: mocks.cancel,
  })),
}));

vi.mock('@/database/models/asyncTask', async (importOriginal) => {
  const actual = await importOriginal<typeof AsyncTaskModelModule>();

  return {
    ...actual,
    AsyncTaskModel: vi.fn(() => ({
      update: mocks.update,
    })),
  };
});

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(async () => ({
    query: {
      asyncTasks: {
        findFirst: mocks.findFirst,
      },
    },
  })),
}));

vi.mock('@/server/globalConfig/parseMemoryExtractionConfig', () => ({
  parseMemoryExtractionConfig: () => ({
    webhook: { headers: { 'x-memory-secret': 'secret' } },
  }),
}));

const { POST } = await import('./route');

const createRequest = (body: Record<string, unknown>) =>
  new Request(
    'https://app.example.com/api/webhooks/memory-user-memory/pipelines/extract/chat-topic/cancel',
    {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        'x-memory-secret': 'secret',
      },
      method: 'POST',
    },
  );

describe('memory extraction cancel route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('QSTASH_TOKEN', 'test-qstash-token');
    mocks.cancel.mockResolvedValue({ cancelled: 2 });
    mocks.update.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('cancels an hourly memory extraction task using stored and requested workflow run ids', async () => {
    /**
     * @example
     * await POST(cancelHourlyTaskRequest);
     */
    mocks.findFirst.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      metadata: {
        control: {
          upstash: { workflowRunIds: ['root-run', 'child-run'] },
        },
        progress: {
          processedUsers: 0,
          scheduledBatches: 0,
          scheduledChildRuns: 0,
        },
        source: 'hourly_chat_topic',
        startedAt: '2026-07-06T00:00:00.000Z',
      },
      type: AsyncTaskType.UserMemoryExtractionHourly,
      userId: 'service-user',
      workspaceId: null,
    });

    const response = await POST(
      createRequest({
        reason: 'operator stop',
        taskId: '00000000-0000-4000-8000-000000000001',
        workflowRunId: 'child-run',
        workflowRunIds: ['late-run'],
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      cancelledWorkflowRuns: 2,
      status: AsyncTaskStatus.Error,
      taskId: '00000000-0000-4000-8000-000000000001',
    });

    expect(response.status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith({ ids: ['root-run', 'child-run', 'late-run'] });
    expect(mocks.update).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      expect.objectContaining({
        metadata: expect.objectContaining({
          control: expect.objectContaining({
            cancelReason: 'operator stop',
            cancelledBy: 'webhook',
            upstash: { workflowRunIds: ['root-run', 'child-run', 'late-run'] },
          }),
          source: 'hourly_chat_topic',
        }),
        status: AsyncTaskStatus.Error,
      }),
    );
  });

  it('keeps manual chat-topic cancellation behavior', async () => {
    /**
     * @example
     * await POST(cancelManualTaskRequest);
     */
    mocks.findFirst.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000002',
      metadata: {
        control: {
          upstash: { workflowRunIds: ['manual-run'] },
        },
        progress: {
          completedTopics: 0,
          failedTopics: 0,
          totalTopics: 1,
        },
        source: 'chat_topic',
      },
      type: AsyncTaskType.UserMemoryExtractionWithChatTopic,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    const response = await POST(
      createRequest({
        taskId: '00000000-0000-4000-8000-000000000002',
        userId: 'user-1',
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      cancelledWorkflowRuns: 2,
      status: AsyncTaskStatus.Error,
      taskId: '00000000-0000-4000-8000-000000000002',
    });

    expect(response.status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith({ ids: ['manual-run'] });
    expect(mocks.update).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000002',
      expect.objectContaining({
        metadata: expect.objectContaining({
          control: expect.objectContaining({
            cancelledBy: 'webhook',
            upstash: { workflowRunIds: ['manual-run'] },
          }),
          source: 'chat_topic',
        }),
        status: AsyncTaskStatus.Error,
      }),
    );
  });

  it('normalizes hourly tasks with missing metadata before cancellation', async () => {
    /**
     * @example
     * await POST(cancelHourlyTaskWithMissingMetadataRequest);
     */
    mocks.findFirst.mockResolvedValue({
      createdAt: new Date('2026-07-06T01:00:00.000Z'),
      id: '00000000-0000-4000-8000-000000000003',
      metadata: undefined,
      type: AsyncTaskType.UserMemoryExtractionHourly,
      userId: 'service-user',
      workspaceId: null,
    });

    const response = await POST(
      createRequest({
        taskId: '00000000-0000-4000-8000-000000000003',
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      cancelledWorkflowRuns: 0,
      status: AsyncTaskStatus.Error,
      taskId: '00000000-0000-4000-8000-000000000003',
    });

    expect(response.status).toBe(200);
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000003',
      expect.objectContaining({
        metadata: expect.objectContaining({
          progress: {
            processedUsers: 0,
            scheduledBatches: 0,
            scheduledChildRuns: 0,
          },
          source: 'hourly_chat_topic',
          startedAt: '2026-07-06T01:00:00.000Z',
        }),
        status: AsyncTaskStatus.Error,
      }),
    );
  });
});
