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
  WorkflowRunGuardError: class WorkflowRunGuardError extends Error {
    guardScope = 'workflow';
    matchedKey = 'workflow-run-guard:test';
    reason = 'maintenance';
  },
}));

const { checkGuard } = await import('../runGuard');

const createContext = (payload: unknown, workflowRunId = 'wfr_context') => ({
  requestPayload: payload,
  run: vi.fn((_name: string, callback: () => unknown) => callback()),
  workflowRunId,
});

describe('memory workflow run guard helper', () => {
  beforeEach(() => {
    mocks.assertWorkflowRunAllowed.mockReset();
    mocks.initializeRedis.mockReset();
    mocks.isRedisEnabled.mockReset();
    mocks.isRedisEnabled.mockReturnValue(true);
    mocks.initializeRedis.mockResolvedValue({ get: vi.fn() });
    mocks.assertWorkflowRunAllowed.mockResolvedValue(undefined);
  });

  it('runs the Redis guard lookup inside a workflow step', async () => {
    const redis = { get: vi.fn() };
    mocks.initializeRedis.mockResolvedValue(redis);
    const context = createContext({ userId: 'user-1', userIds: ['user-1'] });

    await expect(
      checkGuard(
        context as never,
        'api/workflows/memory-user-memory/pipelines/chat-topic/process-topic',
      ),
    ).resolves.toEqual({ result: true });

    expect(context.run).toHaveBeenCalledWith(
      'memory:user-memory:run-guard:api/workflows/memory-user-memory/pipelines/chat-topic/process-topic:entry',
      expect.any(Function),
    );
    expect(mocks.assertWorkflowRunAllowed).toHaveBeenCalledWith(
      redis,
      expect.objectContaining({
        stepName: undefined,
        userId: 'user-1',
        workflowPath: 'api/workflows/memory-user-memory/pipelines/chat-topic/process-topic',
        workflowRunId: 'wfr_context',
      }),
    );
  });

  it('includes step scope when checking a step boundary', async () => {
    const redis = { get: vi.fn() };
    mocks.initializeRedis.mockResolvedValue(redis);
    const context = createContext({ userIds: ['user-2'] });

    await checkGuard(
      context as never,
      'api/workflows/memory-user-memory/pipelines/chat-topic/process-users',
      {
        stepName: 'memory:user-memory:extract:get-users',
      },
    );

    expect(context.run).toHaveBeenCalledWith(
      'memory:user-memory:run-guard:api/workflows/memory-user-memory/pipelines/chat-topic/process-users:memory:user-memory:extract:get-users',
      expect.any(Function),
    );
    expect(mocks.assertWorkflowRunAllowed).toHaveBeenCalledWith(
      redis,
      expect.objectContaining({
        stepName: 'memory:user-memory:extract:get-users',
        userId: 'user-2',
        workflowRunId: 'wfr_context',
      }),
    );
  });

  it('passes null Redis when Redis is disabled', async () => {
    mocks.isRedisEnabled.mockReturnValue(false);
    const context = createContext({ userId: 'user-1' });

    await expect(
      checkGuard(
        context as never,
        'api/workflows/memory-user-memory/pipelines/chat-topic/process-users',
      ),
    ).resolves.toEqual({ result: true });

    expect(mocks.initializeRedis).not.toHaveBeenCalled();
    expect(mocks.assertWorkflowRunAllowed).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('ignores malformed user ids from unknown payloads', async () => {
    const redis = { get: vi.fn() };
    mocks.initializeRedis.mockResolvedValue(redis);
    const context = createContext({ userId: 123, userIds: [false, 'user-from-array'] });

    await expect(
      checkGuard(
        context as never,
        'api/workflows/memory-user-memory/pipelines/chat-topic/process-users',
      ),
    ).resolves.toEqual({ result: true });

    expect(mocks.assertWorkflowRunAllowed).toHaveBeenCalledWith(
      redis,
      expect.objectContaining({ userId: 'user-from-array' }),
    );
  });

  it('propagates unexpected guard rejections', async () => {
    const error = new Error('blocked');
    mocks.assertWorkflowRunAllowed.mockRejectedValue(error);
    const context = createContext({ userId: 'user-1' });

    await expect(
      checkGuard(
        context as never,
        'api/workflows/memory-user-memory/pipelines/chat-topic/process-users',
      ),
    ).rejects.toBe(error);
  });

  it('converts workflow guard rejections into block details and a response', async () => {
    const { WorkflowRunGuardError } = await import('@/server/workflows/runGuard');
    mocks.assertWorkflowRunAllowed.mockRejectedValue(
      new WorkflowRunGuardError({
        match: {
          key: 'workflow-run-guard:test',
          scope: 'global',
          value: { reason: 'maintenance' },
        },
        scope: {
          workflowPath: 'api/workflows/memory-user-memory/pipelines/chat-topic/process-users',
        },
      }),
    );
    const context = createContext({ userId: 'user-1' });

    await expect(
      checkGuard(
        context as never,
        'api/workflows/memory-user-memory/pipelines/chat-topic/process-users',
        {
          response: { processedUsers: 0 },
        },
      ),
    ).resolves.toEqual({
      block: {
        matchedKey: 'workflow-run-guard:test',
        reason: 'maintenance',
        scope: 'workflow',
      },
      response: {
        message: 'Memory workflow disabled by run guard (maintenance); skipping.',
        processedUsers: 0,
        skipped: true,
      },
      result: false,
    });
  });
});
