import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';

// Real-Postgres reproduction of the lost-update race on `topic.metadata` that
// strands a finished heterogeneous task at `task_topics.status = 'running'`.
//
// In production execAgent serializes the run's lifecycle hooks onto
// `metadata.runningOperation.hooks`; during the run heteroIngest repeatedly
// writes `metadata.heteroCurrentMsgId`. `TopicModel.updateMetadata` is a
// non-atomic read-modify-write (`{ ...existing, ...patch }`), so two writers
// whose reads overlap can drop each other's keys. If the ingest write merges a
// patch over a snapshot taken before the seed landed, `runningOperation`
// (hooks and all) is lost — and heteroFinish, running in another process with
// an empty in-memory dispatcher, then has nothing to deliver.
//
// This test exercises the REAL TopicModel against a REAL node-postgres pool
// (separate connections per query → genuine interleave). Before the fix the
// concurrent ingest write clobbered `runningOperation` ~half the time and at
// least one key was lost in 29/30 trials. The fix wraps the merge in a
// `SELECT … FOR UPDATE` transaction, so writers serialize on the row and every
// key survives — this test now guards that (clobbered === 0, bothSurvived ===
// TRIALS).

const userId = 'updatemeta-race-user';
const serverDB: LobeChatDatabase = await getTestDB();
const topicModel = new TopicModel(serverDB, userId);

const cleanup = async () => {
  await serverDB.delete(topics).where(eq(topics.userId, userId));
  await serverDB.delete(users).where(eq(users.id, userId));
};

describe('TopicModel.updateMetadata — concurrent lost-update (real Postgres)', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([{ id: userId }]);
  });

  afterAll(cleanup);

  it('serializes concurrent writers so neither runningOperation nor heteroCurrentMsgId is lost', async () => {
    const TRIALS = 30;
    let clobbered = 0;
    let bothSurvived = 0;

    for (let i = 0; i < TRIALS; i++) {
      const topicId = `race-${i}`;
      // Topic starts with no runningOperation — exactly the pre-seed snapshot a
      // racing ingest reader would observe.
      await serverDB.insert(topics).values({ id: topicId, metadata: {}, title: 't', userId });

      // Writer A = execAgent seed; Writer B = heteroIngest step write. Fired
      // concurrently so their read-modify-writes can interleave on the pool.
      await Promise.all([
        topicModel.updateMetadata(topicId, {
          runningOperation: { hooks: [{ id: 'task-on-complete' }], operationId: 'op' } as any,
        }),
        topicModel.updateMetadata(topicId, {
          heteroCurrentMsgId: { msgId: 'm', operationId: 'op' } as any,
        }),
      ]);

      const after = await topicModel.findById(topicId);
      const meta = (after?.metadata ?? {}) as Record<string, any>;
      if (!meta.runningOperation) clobbered++;
      if (meta.runningOperation && meta.heteroCurrentMsgId) bothSurvived++;
    }

    console.log(
      `[updateMetadata race] runningOperation clobbered in ${clobbered}/${TRIALS} trials; both keys survived in ${bothSurvived}/${TRIALS}`,
    );

    // With the row-locked merge, concurrent writers serialize on the row: every
    // trial must keep BOTH keys. A single clobber means the lost-update race is
    // back (the production failure mode that stranded finished hetero tasks).
    expect(clobbered).toBe(0);
    expect(bothSurvived).toBe(TRIALS);
  });
});
