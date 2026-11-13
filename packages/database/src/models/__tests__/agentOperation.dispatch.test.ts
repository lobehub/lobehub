// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentOperations, users } from '../../schemas';
import { AgentOperationModel } from '../agentOperation';

const db = await getTestDB();
const userId = 'dispatch-contract-user';
const model = () => new AgentOperationModel(db, userId);
const staleBefore = new Date(Date.now() - 60_000);

beforeEach(async () => {
  await db.insert(users).values({ id: userId });
});
afterEach(async () => {
  await db.delete(agentOperations).where(eq(agentOperations.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
});

const stale = async (id: string) => {
  await model().recordStart({ operationId: id });
  await db
    .update(agentOperations)
    .set({ updatedAt: new Date(0) })
    .where(eq(agentOperations.id, id));
};

describe('failed dispatch recovery boundary', () => {
  it('persists the reason and prevents either recovery entry point from claiming the failed run', async () => {
    await stale('dispatch-error');
    expect(await model().recordDispatchFailure('dispatch-error', 'queue unavailable')).toBe(true);
    expect(await model().findById('dispatch-error')).toMatchObject({
      status: 'error',
      completionReason: 'error',
      error: { message: 'queue unavailable', type: 'QueueDispatchError' },
      completedAt: expect.any(Date),
    });
    await db
      .update(agentOperations)
      .set({ updatedAt: new Date(0) })
      .where(eq(agentOperations.id, 'dispatch-error'));
    expect(
      await Promise.all([
        model().claimStaleRedrive('dispatch-error', staleBefore, 3),
        model().claimStaleRedrive('dispatch-error', staleBefore, 3),
      ]),
    ).toEqual([null, null]);
    expect(await model().settleStaleRunning('dispatch-error', staleBefore)).toBe(false);
  });

  it.each(['done', 'error', 'interrupted'] as const)(
    'preserves an existing %s outcome',
    async (status) => {
      await model().recordStart({ operationId: 'already-terminal' });
      await model().recordCompletion('already-terminal', { status, completionReason: status });
      expect(await model().recordDispatchFailure('already-terminal', 'late timeout')).toBe(false);
      expect(await model().findById('already-terminal')).toMatchObject({ status, error: null });
    },
  );

  it('allows exactly one simultaneous stale claim from separate reaper instances', async () => {
    await stale('concurrent-claim');
    const claims = await Promise.all([
      model().claimStaleRedrive('concurrent-claim', staleBefore, 3),
      model().claimStaleRedrive('concurrent-claim', staleBefore, 3),
    ]);
    expect(claims.filter((attempt) => attempt !== null)).toEqual([1]);
    expect(claims.filter((attempt) => attempt === null)).toHaveLength(1);
  });

  it('lets exactly one of the redrive and abandon entry points claim a stale run', async () => {
    await stale('entry-race');
    const [attempt, settled] = await Promise.all([
      model().claimStaleRedrive('entry-race', staleBefore, 3),
      model().settleStaleRunning('entry-race', staleBefore),
    ]);
    expect([attempt !== null, settled].filter(Boolean)).toHaveLength(1);
  });
});
