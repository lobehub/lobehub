// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  backfillAcceptanceRepairCommentIds,
  type BackfillPool,
} from '../../../../../scripts/backfillAcceptanceRepairCommentIdsCore';
import { getTestDB } from '../../core/getTestDB';
import { acceptanceComments, acceptances, tasks, users } from '../../schemas';

const db = await getTestDB();
const userId = 'repair-backfill-user';

const pool: BackfillPool = {
  connect: async () => ({
    query: async (text, params) => (db as any).$client.query(text, params),
  }),
};

let acceptanceId: string;
let rootId: string;
let replyId: string;

const seed = async (taskAcceptanceId?: string) => {
  const [acceptance] = await db
    .insert(acceptances)
    .values({ subjectId: randomUUID(), subjectType: 'site', userId })
    .returning();
  acceptanceId = acceptance.id;
  const [root] = await db
    .insert(acceptanceComments)
    .values({ acceptanceId, authorUserId: userId, clientId: randomUUID(), content: 'root' })
    .returning();
  const [reply] = await db
    .insert(acceptanceComments)
    .values({
      acceptanceId,
      authorUserId: userId,
      clientId: randomUUID(),
      content: 'reply',
      parentCommentId: root.id,
    })
    .returning();
  rootId = root.id;
  replyId = reply.id;
  await db.insert(tasks).values({
    config: {
      acceptanceRepair: { acceptanceId: taskAcceptanceId ?? acceptanceId, requestId: 'req-1' },
    },
    createdByUserId: userId,
    id: 'repair-task',
    identifier: 'T-1',
    instruction: 'x',
    seq: 1,
  });
  await db
    .update(acceptances)
    .set({
      metadata: {
        repair: { commentIds: [rootId, replyId], id: 'req-1', taskId: 'repair-task' },
      } as any,
    })
    .where(eq(acceptances.id, acceptanceId));
};

const taskComments = async () => {
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, 'repair-task') });
  return (task?.config as any)?.acceptanceRepair?.commentIds;
};

beforeEach(async () => {
  await db.insert(users).values({ id: userId });
});
afterEach(async () => {
  await db.delete(tasks);
  await db.delete(users);
});

describe('backfillAcceptanceRepairCommentIds', () => {
  it('copies the latest hand-off as root ids onto its Task', async () => {
    await seed();
    const progress = await backfillAcceptanceRepairCommentIds(pool, { apply: true, batchSize: 10 });
    expect(await taskComments()).toEqual([rootId]);
    expect(progress.updated).toBe(1);
  });

  it('is idempotent', async () => {
    await seed();
    await backfillAcceptanceRepairCommentIds(pool, { apply: true, batchSize: 10 });
    const again = await backfillAcceptanceRepairCommentIds(pool, { apply: true, batchSize: 10 });
    expect(again.updated).toBe(0);
  });

  it('writes nothing on a dry run', async () => {
    await seed();
    const progress = await backfillAcceptanceRepairCommentIds(pool, {
      apply: false,
      batchSize: 10,
    });
    expect(progress.updated).toBe(1);
    expect(await taskComments()).toBeUndefined();
  });

  it('skips a Task that belongs to another acceptance', async () => {
    await seed(randomUUID());
    const progress = await backfillAcceptanceRepairCommentIds(pool, { apply: true, batchSize: 10 });
    expect(progress.updated).toBe(0);
    expect(await taskComments()).toBeUndefined();
  });
});
