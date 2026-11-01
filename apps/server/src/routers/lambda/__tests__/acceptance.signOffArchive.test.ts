// @vitest-environment node
import { randomUUID } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import { acceptances, verifyRuns } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as GoalServiceModule from '@/server/services/goal';

import { acceptanceRouter } from '../acceptance';
import { cleanupTestUser, createTestContext, createTestUser } from './integration/setup';

let serverDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => serverDB }));

const mockArchiveSignedOffTasks = vi.fn();
vi.mock('@/server/services/goal', async (importOriginal) => {
  const actual = await importOriginal<typeof GoalServiceModule>();
  return {
    ...actual,
    GoalService: vi.fn().mockImplementation(function () {
      return { archiveSignedOffTasks: mockArchiveSignedOffTasks };
    }),
  };
});

describe('acceptanceRouter sign-off archives the goal Tasks', () => {
  let userId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    userId = await createTestUser(serverDB);
    mockArchiveSignedOffTasks.mockResolvedValue([]);
  });

  afterEach(async () => {
    mockArchiveSignedOffTasks.mockReset();
    await cleanupTestUser(serverDB, userId);
  });

  const seedAcceptance = async (subjectType: 'standalone' | 'task' = 'task') => {
    const subjectId = randomUUID();
    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({ status: 'delivered', subjectId, subjectType, userId })
      .returning();
    await serverDB
      .insert(verifyRuns)
      .values({ acceptanceId: acceptance.id, roundIndex: 1, status: 'passed', userId });
    return { id: acceptance.id, subjectId };
  };

  it('archives the signed Task’s goal on accept', async () => {
    const { id, subjectId } = await seedAcceptance();
    const caller = acceptanceRouter.createCaller(createTestContext(userId));

    const result = await caller.accept({ id });

    expect(result.status).toBe('accepted');
    expect(mockArchiveSignedOffTasks).toHaveBeenCalledWith(subjectId);
  });

  it('still records the sign-off when archiving fails', async () => {
    const { id } = await seedAcceptance();
    mockArchiveSignedOffTasks.mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const caller = acceptanceRouter.createCaller(createTestContext(userId));

    expect((await caller.accept({ id })).status).toBe('accepted');
    expect(errorSpy).toHaveBeenCalledWith('[goal:sign-off:archive-tasks]', expect.any(Error));
    errorSpy.mockRestore();
  });

  it('archives on an accept from the list, but not on a close', async () => {
    const accepted = await seedAcceptance();
    const closed = await seedAcceptance();
    const caller = acceptanceRouter.createCaller(createTestContext(userId));

    await caller.updateStatus({ id: closed.id, status: 'closed' });
    expect(mockArchiveSignedOffTasks).not.toHaveBeenCalled();

    await caller.updateStatus({ id: accepted.id, status: 'accepted' });
    expect(mockArchiveSignedOffTasks).toHaveBeenCalledWith(accepted.subjectId);
  });

  it('leaves an acceptance that is not about a Task alone', async () => {
    const { id } = await seedAcceptance('standalone');
    const caller = acceptanceRouter.createCaller(createTestContext(userId));

    await caller.accept({ id });

    expect(mockArchiveSignedOffTasks).not.toHaveBeenCalled();
  });
});
