import { MemorySourceType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processUserTopicsHandler } from '../processUserTopics';

const mocks = vi.hoisted(() => ({
  createExecutor: vi.fn(),
  getTopicsForUser: vi.fn(),
  triggerProcessTopics: vi.fn(),
  triggerProcessUserTopics: vi.fn(),
}));

// NOTICE: The module reads MAX_TOPICS_PER_USER_PER_RUN from this config at import time, so the cap
// is fixed to 4 for the whole file to keep the fixtures small.
vi.mock('@/server/globalConfig/parseMemoryExtractionConfig', () => ({
  parseMemoryExtractionConfig: () => ({
    upstashWorkflowExtraHeaders: {},
    workflow: { maxTopicsPerUserPerRun: 4 },
  }),
}));

vi.mock('@/server/services/memory/userMemory/extract', () => ({
  buildWorkflowPayloadInput: (payload: unknown) => payload,
  MemoryExtractionExecutor: {
    create: mocks.createExecutor,
  },
  MemoryExtractionWorkflowService: {
    triggerProcessTopics: mocks.triggerProcessTopics,
    triggerProcessUserTopics: mocks.triggerProcessUserTopics,
  },
  // Mirror the real default so params.topicFanoutCount is always a number.
  normalizeMemoryExtractionPayload: (payload: Record<string, unknown>) => ({
    ...payload,
    layers: payload.layers ?? [],
    sources: payload.sources ?? [],
    topicFanoutCount: payload.topicFanoutCount ?? 0,
    topicIds: payload.topicIds ?? [],
    userIds: payload.userIds ?? [],
  }),
}));

vi.mock('@/database/models/asyncTask', () => ({ AsyncTaskModel: class {} }));
vi.mock('@/database/server', () => ({ getServerDB: vi.fn() }));

vi.mock('../runGuard', () => ({
  checkGuard: vi.fn().mockResolvedValue({ result: true }),
  ensureWorkflowStarted: vi.fn().mockResolvedValue({ started: true }),
}));

const createContext = () => ({
  run: vi.fn((_name: string, callback: () => unknown) => callback()),
});

const basePayload = {
  baseUrl: 'https://app.example.com',
  sources: [MemorySourceType.ChatTopic],
  userIds: ['u1'],
};

describe('processUserTopicsHandler per-user fan-out ceiling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createExecutor.mockResolvedValue({ getTopicsForUser: mocks.getTopicsForUser });
    mocks.triggerProcessTopics.mockResolvedValue({ workflowRunId: 'process-topics-run' });
    mocks.triggerProcessUserTopics.mockResolvedValue({ workflowRunId: 'next-page-run' });
  });

  it('truncates the page to the remaining budget and stops paginating at the ceiling', async () => {
    // Cap is 4 and this user has already fanned out 2 topics, so only 2 more may be triggered even
    // though the page returns 4 — and no next page is scheduled because the ceiling is reached.
    mocks.getTopicsForUser.mockResolvedValue({
      cursor: { createdAt: '2024-07-02T09:36:44.073Z', id: 'cursor1' },
      ids: ['t1', 't2', 't3', 't4'],
    });

    const context = createContext();
    await processUserTopicsHandler({
      requestPayload: { ...basePayload, topicFanoutCount: 2 },
      ...context,
    } as never);

    expect(mocks.triggerProcessTopics).toHaveBeenCalledTimes(1);
    expect(mocks.triggerProcessTopics).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ topicIds: ['t1', 't2'] }),
      { extraHeaders: {} },
    );
    // Ceiling reached (2 + 2 === 4) → never schedule the next page.
    expect(mocks.triggerProcessUserTopics).not.toHaveBeenCalled();
  });

  it('threads the running fan-out count into the next page when under the ceiling', async () => {
    mocks.getTopicsForUser.mockResolvedValue({
      cursor: { createdAt: '2024-07-02T09:36:44.073Z', id: 'cursor1' },
      ids: ['t1', 't2'],
    });

    const context = createContext();
    await processUserTopicsHandler({
      requestPayload: { ...basePayload, topicFanoutCount: 0 },
      ...context,
    } as never);

    expect(mocks.triggerProcessTopics).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ topicIds: ['t1', 't2'] }),
      { extraHeaders: {} },
    );
    // 0 + 2 === 2 < 4 → schedule the next page carrying the accumulated count.
    expect(mocks.triggerProcessUserTopics).toHaveBeenCalledWith(
      expect.objectContaining({
        topicCursor: { createdAt: '2024-07-02T09:36:44.073Z', id: 'cursor1', userId: 'u1' },
        topicFanoutCount: 2,
      }),
      { extraHeaders: {} },
    );
  });
});
