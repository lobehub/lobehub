import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertWorkflowRunAllowed: vi.fn(),
  initializeRedis: vi.fn(),
  isRedisEnabled: vi.fn(),
}));

vi.mock('@/libs/redis', () => ({
  initializeRedis: mocks.initializeRedis,
  isRedisEnabled: mocks.isRedisEnabled,
}));

vi.mock('@/envs/redis', () => ({
  getRedisConfig: vi.fn(() => ({ enabled: true, url: 'redis://test' })),
}));

vi.mock('@/server/workflows/runGuard', () => ({
  assertWorkflowRunAllowed: mocks.assertWorkflowRunAllowed,
}));

const { assertMemoryWorkflowContextAllowed, assertMemoryWorkflowRunAllowed } =
  await import('../runGuard');

describe('memory workflow run guard helper', () => {
  beforeEach(() => {
    mocks.assertWorkflowRunAllowed.mockReset();
    mocks.initializeRedis.mockReset();
    mocks.isRedisEnabled.mockReset();
    mocks.isRedisEnabled.mockReturnValue(true);
    mocks.initializeRedis.mockResolvedValue({ get: vi.fn() });
    mocks.assertWorkflowRunAllowed.mockResolvedValue(undefined);
  });

  it('builds a memory workflow guard scope', async () => {
    const redis = { get: vi.fn() };
    mocks.initializeRedis.mockResolvedValue(redis);

    await assertMemoryWorkflowRunAllowed({
      payload: {
        userId: 'user-1',
        userIds: ['user-1'],
      },
      stepName: 'memory:user-memory:extract:cepa',
      workflowPath: 'api/workflows/memory-user-memory/pipelines/chat-topic/process-topic',
      workflowRunId: 'wfr_1',
    });

    expect(mocks.assertWorkflowRunAllowed).toHaveBeenCalledWith(
      redis,
      expect.objectContaining({
        stepName: 'memory:user-memory:extract:cepa',
        userId: 'user-1',
        workflowPath: 'api/workflows/memory-user-memory/pipelines/chat-topic/process-topic',
        workflowRunId: 'wfr_1',
      }),
    );
    expect(mocks.assertWorkflowRunAllowed).toHaveBeenCalledTimes(1);
  });

  it('uses workflowRunId from workflow context when available', async () => {
    const redis = { get: vi.fn() };
    mocks.initializeRedis.mockResolvedValue(redis);

    await assertMemoryWorkflowContextAllowed(
      {
        requestPayload: {
          userIds: ['user-2'],
        },
        workflowRunId: 'wfr_context',
      } as never,
      'api/workflows/memory-user-memory/pipelines/chat-topic/process-users',
      'memory:user-memory:extract:get-users',
    );

    expect(mocks.assertWorkflowRunAllowed).toHaveBeenCalledWith(
      redis,
      expect.objectContaining({
        stepName: 'memory:user-memory:extract:get-users',
        userId: 'user-2',
        workflowRunId: 'wfr_context',
      }),
    );
    expect(mocks.assertWorkflowRunAllowed).toHaveBeenCalledTimes(1);
  });

  it('passes null Redis when Redis is disabled', async () => {
    mocks.isRedisEnabled.mockReturnValue(false);

    await assertMemoryWorkflowRunAllowed({
      payload: { userId: 'user-1' },
      workflowPath: 'api/workflows/memory-user-memory/pipelines/chat-topic/process-users',
    });

    expect(mocks.initializeRedis).not.toHaveBeenCalled();
    expect(mocks.assertWorkflowRunAllowed).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('ignores malformed user ids from unknown payloads', async () => {
    const redis = { get: vi.fn() };
    mocks.initializeRedis.mockResolvedValue(redis);

    await assertMemoryWorkflowRunAllowed({
      payload: {
        userId: 123,
        userIds: [false, 'user-from-array'],
      },
      workflowPath: 'api/workflows/memory-user-memory/pipelines/chat-topic/process-users',
    });

    expect(mocks.assertWorkflowRunAllowed).toHaveBeenCalledWith(
      redis,
      expect.objectContaining({ userId: 'user-from-array' }),
    );
  });

  it('propagates guard rejections', async () => {
    const error = new Error('blocked');
    mocks.assertWorkflowRunAllowed.mockRejectedValue(error);

    await expect(
      assertMemoryWorkflowRunAllowed({
        payload: { userId: 'user-1' },
        workflowPath: 'api/workflows/memory-user-memory/pipelines/chat-topic/process-users',
      }),
    ).rejects.toBe(error);
  });
});
