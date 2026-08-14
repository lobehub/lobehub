import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStepRunner } from '@/server/workflows/testing/stepContext';

import { dispatchTopicAutoSummary } from './dispatch';

const mocks = vi.hoisted(() => ({
  listCandidates: vi.fn(),
  triggerDispatch: vi.fn(),
  triggerExecute: vi.fn(),
}));

vi.mock('@/database/server', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));
vi.mock('@/database/models/topicSummary', () => ({
  TopicSummaryModel: class {
    listCandidates = mocks.listCandidates;
  },
}));
vi.mock('@/server/workflows/topicAutoSummary', () => ({
  TopicAutoSummaryWorkflow: {
    triggerDispatch: mocks.triggerDispatch,
    triggerExecute: mocks.triggerExecute,
  },
}));

const createContext = (requestPayload: Record<string, unknown>) =>
  ({ requestPayload, run: createStepRunner() }) as never;

describe('dispatchTopicAutoSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.triggerDispatch.mockResolvedValue({ workflowRunId: 'next' });
    mocks.triggerExecute.mockResolvedValue({ workflowRunId: 'execute' });
  });

  it('uses the rolling 24-hour and one-hour idle defaults in dry-run mode', async () => {
    mocks.listCandidates.mockResolvedValue([]);
    const before = Date.now();

    const result = await dispatchTopicAutoSummary(createContext({ dryRun: true }));
    const after = Date.now();
    const options = mocks.listCandidates.mock.calls[0][0];

    expect(result).toMatchObject({ candidates: 0, dryRun: true, scheduled: 0 });
    expect(options.limit).toBe(100);
    expect(options.idleBefore.getTime()).toBeGreaterThanOrEqual(before - 60 * 60_000);
    expect(options.idleBefore.getTime()).toBeLessThanOrEqual(after - 60 * 60_000);
    expect(options.topicCreatedAfter.getTime()).toBeGreaterThanOrEqual(before - 24 * 3_600_000);
    expect(options.topicCreatedAfter.getTime()).toBeLessThanOrEqual(after - 24 * 3_600_000);
    expect(mocks.triggerExecute).not.toHaveBeenCalled();
  });

  it('counts every eligible dry-run page up to the operator limit', async () => {
    const createCandidates = (start: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `topic-${start + index}`,
        lastMessageUpdatedAt: new Date(
          `2026-07-31T10:${String(start + index).padStart(2, '0')}:00Z`,
        ),
        userId: 'user-1',
        workspaceId: null,
      }));
    mocks.listCandidates
      .mockResolvedValueOnce(createCandidates(0, 2))
      .mockResolvedValueOnce(createCandidates(2, 2))
      .mockResolvedValueOnce(createCandidates(4, 1));

    const result = await dispatchTopicAutoSummary(
      createContext({ dryRun: true, maxTopics: 10, pageSize: 2 }),
    );

    expect(result).toMatchObject({ candidates: 5, dryRun: true, truncated: false });
    expect(mocks.listCandidates).toHaveBeenCalledTimes(3);
    expect(mocks.listCandidates.mock.calls[1][0].cursor).toEqual({
      id: 'topic-1',
      lastMessageUpdatedAt: new Date('2026-07-31T10:01:00.000Z'),
    });
    expect(mocks.triggerDispatch).not.toHaveBeenCalled();
    expect(mocks.triggerExecute).not.toHaveBeenCalled();
  });

  it('reports when a dry run is truncated by maxTopics', async () => {
    const candidate = (id: string, minute: number) => ({
      id,
      lastMessageUpdatedAt: new Date(`2026-07-31T10:0${minute}:00Z`),
      userId: 'user-1',
      workspaceId: null,
    });
    mocks.listCandidates
      .mockResolvedValueOnce([candidate('topic-1', 0), candidate('topic-2', 1)])
      .mockResolvedValueOnce([candidate('topic-3', 2)]);

    const result = await dispatchTopicAutoSummary(
      createContext({ dryRun: true, maxTopics: 2, pageSize: 2 }),
    );

    expect(result).toMatchObject({ candidates: 2, dryRun: true, truncated: true });
    expect(mocks.listCandidates).toHaveBeenCalledTimes(2);
  });

  it('honors operator parameters and schedules a cursor continuation', async () => {
    const candidates = [
      {
        id: 'topic-1',
        lastMessageUpdatedAt: new Date('2026-07-31T10:00:00Z'),
        userId: 'user-1',
        workspaceId: null,
      },
      {
        id: 'topic-2',
        lastMessageUpdatedAt: new Date('2026-07-31T10:01:00Z'),
        userId: 'user-2',
        workspaceId: 'workspace-2',
      },
    ];
    mocks.listCandidates.mockResolvedValue(candidates);

    const result = await dispatchTopicAutoSummary(
      createContext({
        force: true,
        idleMinutes: 90,
        lookbackHours: 48,
        maxTopics: 10,
        pageSize: 2,
      }),
    );

    expect(result).toMatchObject({ hasNextPage: true, processed: 2, scheduled: 2 });
    expect(mocks.listCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ force: true, limit: 2 }),
    );
    expect(mocks.triggerExecute).toHaveBeenCalledTimes(2);
    expect(mocks.triggerExecute).toHaveBeenLastCalledWith({
      force: true,
      topicId: 'topic-2',
      userId: 'user-2',
      workspaceId: 'workspace-2',
    });
    expect(mocks.triggerDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: 'topic-2', lastMessageUpdatedAt: '2026-07-31T10:01:00.000Z' },
        processed: 2,
      }),
    );
  });

  it('rejects a malformed cursor instead of querying with an invalid date', async () => {
    mocks.listCandidates.mockResolvedValue([]);

    await expect(
      dispatchTopicAutoSummary(
        createContext({ cursor: { id: 'topic-1', lastMessageUpdatedAt: 'not-a-date' } }),
      ),
    ).rejects.toThrow('Invalid topic auto summary cursor timestamp');
    expect(mocks.listCandidates).not.toHaveBeenCalled();
  });
});
