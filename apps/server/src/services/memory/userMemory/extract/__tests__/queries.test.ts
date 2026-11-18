// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemoryExtractionExecutorContext } from '../context';
import { getTopicsForUser, getUsers, getUsersForHourlyExtraction } from '../queries';

const mocks = vi.hoisted(() => ({
  listTopicsForMemoryExtractor: vi.fn(),
  listUsersForHourlyMemoryExtractor: vi.fn(),
  listUsersForMemoryExtractor: vi.fn(),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: {
    listUsersForHourlyMemoryExtractor: mocks.listUsersForHourlyMemoryExtractor,
    listUsersForMemoryExtractor: mocks.listUsersForMemoryExtractor,
  },
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(function () {
    return { listTopicsForMemoryExtractor: mocks.listTopicsForMemoryExtractor };
  }),
}));

const ctx = {
  db: Promise.resolve({}),
  privateConfig: { whitelistUsers: [] },
} as unknown as MemoryExtractionExecutorContext;

const rows = (...ids: string[]) =>
  ids.map((id, index) => ({ createdAt: new Date(Date.UTC(2026, 10, 17, 0, 0, index)), id }));

describe('memory extraction pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [
      'getUsersForHourlyExtraction',
      mocks.listUsersForHourlyMemoryExtractor,
      getUsersForHourlyExtraction,
    ],
    ['getUsers', mocks.listUsersForMemoryExtractor, getUsers],
  ] as const)('%s returns a cursor only after a full page', async (_name, list, get) => {
    list.mockResolvedValueOnce(rows('u1', 'u2'));
    await expect(get(ctx, 2)).resolves.toEqual({
      cursor: { createdAt: rows('u1', 'u2')[1].createdAt, id: 'u2' },
      ids: ['u1', 'u2'],
    });

    // A short page is the last one: no cursor, so the workflow schedules no further run.
    list.mockResolvedValueOnce(rows('u3'));
    await expect(get(ctx, 2)).resolves.toEqual({ cursor: undefined, ids: ['u3'] });
  });

  it('getTopicsForUser returns a cursor only after a full page', async () => {
    const job = { userId: 'u1' } as Parameters<typeof getTopicsForUser>[1];

    mocks.listTopicsForMemoryExtractor.mockResolvedValueOnce(rows('t1', 't2'));
    await expect(getTopicsForUser(ctx, job, 2)).resolves.toEqual({
      cursor: { createdAt: rows('t1', 't2')[1].createdAt, id: 't2' },
      ids: ['t1', 't2'],
    });

    mocks.listTopicsForMemoryExtractor.mockResolvedValueOnce(rows('t3'));
    await expect(getTopicsForUser(ctx, job, 2)).resolves.toEqual({
      cursor: undefined,
      ids: ['t3'],
    });
  });
});
