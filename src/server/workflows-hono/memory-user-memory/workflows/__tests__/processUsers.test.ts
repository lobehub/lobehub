import { MemorySourceType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processUsersHandler } from '../processUsers';

const mocks = vi.hoisted(() => ({
  createExecutor: vi.fn(),
  getUsers: vi.fn(),
  triggerProcessUserTopics: vi.fn(),
  triggerProcessUsers: vi.fn(),
}));

vi.mock('@/server/globalConfig/parseMemoryExtractionConfig', () => ({
  parseMemoryExtractionConfig: () => ({ upstashWorkflowExtraHeaders: {} }),
}));

vi.mock('@/server/services/memory/userMemory/extract', () => ({
  buildWorkflowPayloadInput: (payload: unknown) => payload,
  MemoryExtractionExecutor: {
    create: mocks.createExecutor,
  },
  MemoryExtractionWorkflowService: {
    triggerProcessUserTopics: mocks.triggerProcessUserTopics,
    triggerProcessUsers: mocks.triggerProcessUsers,
  },
  normalizeMemoryExtractionPayload: (payload: Record<string, unknown>) => ({
    ...payload,
    sources: payload.sources ?? [],
    userIds: payload.userIds ?? [],
  }),
}));

vi.mock('@/database/models/asyncTask', () => ({ AsyncTaskModel: class {} }));
vi.mock('@/database/server', () => ({ getServerDB: vi.fn() }));

vi.mock('../runGuard', () => ({
  checkGuard: vi.fn().mockResolvedValue({ result: true }),
  ensureWorkflowStarted: vi.fn().mockResolvedValue({ started: true }),
}));

describe('processUsersHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createExecutor.mockResolvedValue({ getUsers: mocks.getUsers });
    mocks.getUsers.mockResolvedValue({
      cursor: { createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 'user-cursor' },
      ids: ['user-1', 'user-2'],
    });
    mocks.triggerProcessUserTopics.mockResolvedValue({ workflowRunId: 'user-topics-run' });
    mocks.triggerProcessUsers.mockResolvedValue({ workflowRunId: 'next-users-run' });
  });

  it('returns scheduling statistics without enqueueing child workflows when dryRun is enabled', async () => {
    const result = await processUsersHandler({
      requestPayload: {
        baseUrl: 'https://app.example.com',
        dryRun: true,
        sources: [MemorySourceType.ChatTopic],
      },
      run: vi.fn((_name: string, callback: () => unknown) => callback()),
    } as never);

    expect(result).toEqual({
      batches: 1,
      dryRun: true,
      nextCursor: 'user-cursor',
      processedUsers: 2,
      scheduledBatches: 0,
    });
    expect(mocks.triggerProcessUserTopics).not.toHaveBeenCalled();
    expect(mocks.triggerProcessUsers).not.toHaveBeenCalled();
  });
});
