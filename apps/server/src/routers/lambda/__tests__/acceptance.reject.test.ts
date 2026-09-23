// @vitest-environment node
import { randomUUID } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import { acceptances, verifyRuns } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { acceptanceRouter } from '../acceptance';
import { cleanupTestUser, createTestContext, createTestUser } from './integration/setup';

let serverDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => serverDB }));
vi.mock('@/server/workflows/expertiseRejection', () => ({
  ExpertiseRejectionWorkflow: { trigger: vi.fn() },
}));

describe('acceptanceRouter reject', () => {
  let userId: string;
  let strangerId: string;
  let acceptanceId: string;
  let runId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    userId = await createTestUser(serverDB);
    strangerId = await createTestUser(serverDB);
    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({
        status: 'delivered',
        subjectId: randomUUID(),
        subjectType: 'standalone',
        userId,
      })
      .returning();
    acceptanceId = acceptance.id;
    const [run] = await serverDB
      .insert(verifyRuns)
      .values({
        acceptanceId,
        roundIndex: 1,
        status: 'passed',
        userId,
      })
      .returning();
    runId = run.id;
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, strangerId);
    await cleanupTestUser(serverDB, userId);
  });

  it.each([undefined, '', '   ', '  Add dark mode evidence  '])(
    'returns the delivery and records the optional reason (%j)',
    async (comment) => {
      const caller = acceptanceRouter.createCaller(createTestContext(userId));
      const result = await caller.reject({ comment, id: acceptanceId });
      expect(result.status).toBe('rejected');
      const [run] = await serverDB.select().from(verifyRuns).where(eq(verifyRuns.id, runId));
      expect(run.userDecision).toBe('reject');
      expect(run.decisionDetail?.comment).toBe(comment?.trim() || undefined);
      expect(run.decisionDetail?.decidedBy).toBe(userId);
    },
  );

  it('still rejects reasons over the length limit', async () => {
    const caller = acceptanceRouter.createCaller(createTestContext(userId));
    await expect(
      caller.reject({ comment: 'x'.repeat(2001), id: acceptanceId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('does not let another user return a private delivery without a reason', async () => {
    const caller = acceptanceRouter.createCaller(createTestContext(strangerId));
    await expect(caller.reject({ id: acceptanceId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [acceptance] = await serverDB
      .select()
      .from(acceptances)
      .where(eq(acceptances.id, acceptanceId));
    expect(acceptance.status).toBe('delivered');
  });
});
