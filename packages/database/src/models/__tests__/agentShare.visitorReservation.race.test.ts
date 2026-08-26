// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentShareModel } from '../agentShare';
import { TopicModel } from '../topic';

// Real-Postgres reproduction of LOBE-11930 hole 1.
//
// A visitor's `shareChat.execAgent` passes `findByShareIdWithAccessCheck`
// once, at request entry, while the share is still `link`. Thousands of
// lines of agent-config/tool/knowledge-base resolution later,
// `execAgentWithReservation` actually creates the operation and writes
// `topics.metadata.runningOperation`. If the owner revokes the share (or a
// config write resets it — see `agentConfigShareReset.test.ts`) in that
// window, the OLD one-shot `interruptActiveShareRuns` query — fired from the
// revocation's `after()` callback — found no `runningOperation` yet (nothing
// had been created), and the operation that started afterward was then
// unstoppable by the visitor (`shareChat.interruptTask` re-checks visibility
// and gets `FORBIDDEN`).
//
// The fix adds `AgentShareModel.assertRunnableForVisitor`, re-checked under
// the SAME `agents.id FOR UPDATE` lock revocation (`deleteByAgentId` /
// `updateVisibility`) already takes, immediately before the run creates its
// operation marker — plus a bounded retry in `interruptActiveShareRuns` for
// the residual window between that check and the marker actually being
// persisted (see that method's JSDoc in apps/server/src/services/aiAgent).
//
// This test drives a REAL "visitor start" (assertRunnableForVisitor, then —
// only if it passes — persist the `runningOperation` marker, mirroring
// `execAgentWithReservation`'s own ordering) against a REAL "owner revoke"
// (`deleteByAgentId`, then a bounded retry loop standing in for
// `interruptActiveShareRuns`) on separate connections, so genuine
// interleaving is possible. Every trial must land in one of two safe
// outcomes: the start failed closed (no operation ever created), or it
// succeeded and the revoke's retry still found and cleared the marker it
// raced against. It must never end with a live, unaccounted-for operation.

const ownerId = 'agent-share-visitor-reservation-owner';
const visitorId = 'agent-share-visitor-reservation-visitor';

const serverDB: LobeChatDatabase = await getTestDB();
const agentShareModel = new AgentShareModel(serverDB, ownerId);
const topicModel = new TopicModel(serverDB, ownerId);

const cleanup = async () => {
  await serverDB.delete(users).where(eq(users.id, ownerId));
};

describe('AgentShareModel.assertRunnableForVisitor × deleteByAgentId — reservation race (real Postgres)', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([{ id: ownerId }]);
  });

  afterAll(cleanup);

  it('never leaves an unstoppable operation after a concurrent revoke', async () => {
    const TRIALS = 15;
    let failedClosed = 0;
    let caughtByRetry = 0;
    let unsafeLeak = 0;

    for (let i = 0; i < TRIALS; i += 1) {
      const agentId = `visitor-reservation-race-${i}`;
      await serverDB
        .insert(agents)
        .values({ id: agentId, model: 'gpt-4o', title: 'Race Agent', userId: ownerId });
      await agentShareModel.create(agentId, 'link');
      const [topic] = await serverDB
        .insert(topics)
        .values({ agentId, senderId: visitorId, userId: ownerId })
        .returning();

      // Mirrors `execAgentWithReservation`: recheck first, only persist the
      // operation marker if the recheck actually passed.
      const startTask = async (): Promise<'rejected' | 'started'> => {
        try {
          await agentShareModel.assertRunnableForVisitor(agentId);
        } catch {
          return 'rejected';
        }

        await topicModel.updateMetadata(topic.id, {
          runningOperation: {
            assistantMessageId: 'test-message',
            operationId: `op-${i}`,
            startedAt: new Date().toISOString(),
          },
        } as any);
        return 'started';
      };

      // Mirrors `agentShareRouter.disableShare` followed by
      // `interruptActiveShareRuns`'s bounded retry.
      const revokeTask = async (): Promise<boolean> => {
        await agentShareModel.deleteByAgentId(agentId);

        for (let attempt = 0; attempt < 4; attempt += 1) {
          const active = await topicModel.findActiveVisitorRunTopics(agentId);
          if (active.some((run) => run.topicId === topic.id)) {
            await topicModel.updateMetadata(topic.id, { runningOperation: null } as any);
            return true;
          }

          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return false;
      };

      const [startResult, caught] = await Promise.all([startTask(), revokeTask()]);

      if (startResult === 'rejected') {
        failedClosed += 1;
      } else if (caught) {
        caughtByRetry += 1;
      } else {
        const [row] = await serverDB
          .select({ metadata: topics.metadata })
          .from(topics)
          .where(eq(topics.id, topic.id));
        if ((row?.metadata as any)?.runningOperation?.operationId) unsafeLeak += 1;
      }
    }

    console.log(
      `[visitor reservation race] failed-closed=${failedClosed} caught-by-retry=${caughtByRetry} leaked=${unsafeLeak} / ${TRIALS}`,
    );

    // Regardless of which side won the row-lock race, no trial may end with
    // a live operation the visitor can no longer stop.
    expect(unsafeLeak).toBe(0);
  });
});
