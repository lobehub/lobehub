// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, agentShareRunReservations, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentShareModel } from '../agentShare';

// Real-Postgres reproduction of a reservation-abort race:
// `AgentRuntimeService`'s step-0 share-reservation gate used to abort a
// still-`pending` reservation (retry budget exhausted, or a `'revoked'` read)
// WITHOUT touching the `agent_share_run_reservations` row. `confirmReservation`
// is a SEPARATE, unbounded-duration step of the SAME originating request — it
// can be paused for arbitrarily long between `createOperation` returning and
// the gate giving up — so it could still land AFTER the abort, delete the
// row, and write the topic's `runningOperation` marker for an operation that
// will never run another step: the visitor's original request returns
// success, and their Stop button targets a marker naming a dead operation
// forever.
//
// `AgentShareModel.invalidateReservation` fixes this by sharing
// `confirmReservation`'s own DELETE predicate (`id = operationId AND
// revoked_at IS NULL`) — ordinary Postgres row locking then makes the two
// calls resolve consistently no matter which one the caller happens to fire
// first: whichever commits first is the one that actually removes the row,
// and the other's DELETE affects zero rows once it unblocks.
const ownerId = 'agent-share-invalidate-reservation-owner';
const visitorId = 'agent-share-invalidate-reservation-visitor';

const serverDB: LobeChatDatabase = await getTestDB();
const agentShareModel = new AgentShareModel(serverDB, ownerId);

const cleanup = async () => {
  await serverDB.delete(users).where(eq(users.id, ownerId));
};

const setupAgentAndTopic = async (agentId: string) => {
  await serverDB
    .insert(agents)
    .values({ id: agentId, model: 'gpt-4o', title: 'Invalidate Race Agent', userId: ownerId });
  await agentShareModel.create(agentId, 'link');
  const [topic] = await serverDB
    .insert(topics)
    .values({ agentId, senderId: visitorId, userId: ownerId })
    .returning();
  return topic;
};

describe('AgentShareModel.invalidateReservation × confirmReservation race (real Postgres)', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([{ id: ownerId }]);
  });

  afterAll(cleanup);

  it('invalidates a still-pending reservation and makes a later confirmReservation fail closed', async () => {
    const agentId = 'invalidate-reservation-wins';
    const operationId = 'op-invalidate-wins';
    const topic = await setupAgentAndTopic(agentId);

    await agentShareModel.assertRunnableForVisitor({
      agentId,
      expectedGeneration: 1,
      operationId,
      topicId: topic.id,
      visitorUserId: visitorId,
    });

    // The step-0 gate invalidates first (simulates retries exhausting before
    // the originating request ever reaches `confirmReservation`).
    const invalidated = await agentShareModel.invalidateReservation(operationId);
    expect(invalidated).toBe(true);

    const [leftover] = await serverDB
      .select({ id: agentShareRunReservations.id })
      .from(agentShareRunReservations)
      .where(eq(agentShareRunReservations.id, operationId));
    expect(leftover).toBeUndefined();

    // The originating request finally catches up and tries to confirm — it
    // must fail closed and never write the runningOperation marker.
    const confirmed = await agentShareModel.confirmReservation({
      operationId,
      runningOperation: {
        assistantMessageId: 'test-message',
        operationId,
        startedAt: new Date().toISOString(),
      },
      topicId: topic.id,
    });
    expect(confirmed).toBe(false);

    const [persistedTopic] = await serverDB
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(eq(topics.id, topic.id));
    expect((persistedTopic?.metadata as any)?.runningOperation).toBeFalsy();
  });

  it('reports the row already gone once a racing confirmReservation has already committed', async () => {
    const agentId = 'invalidate-reservation-loses';
    const operationId = 'op-invalidate-loses';
    const topic = await setupAgentAndTopic(agentId);

    await agentShareModel.assertRunnableForVisitor({
      agentId,
      expectedGeneration: 1,
      operationId,
      topicId: topic.id,
      visitorUserId: visitorId,
    });

    // The originating request wins the race this time: it confirms first.
    const confirmed = await agentShareModel.confirmReservation({
      operationId,
      runningOperation: {
        assistantMessageId: 'test-message',
        operationId,
        startedAt: new Date().toISOString(),
      },
      topicId: topic.id,
    });
    expect(confirmed).toBe(true);

    // The step-0 gate's belated invalidation attempt must find nothing left
    // to invalidate — never mistake a legitimately confirmed run for a live
    // reservation it can still tear down.
    const invalidated = await agentShareModel.invalidateReservation(operationId);
    expect(invalidated).toBe(false);

    // The marker `confirmReservation` wrote must survive untouched.
    const [persistedTopic] = await serverDB
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(eq(topics.id, topic.id));
    expect((persistedTopic?.metadata as any)?.runningOperation?.operationId).toBe(operationId);
  });

  it('is a safe no-op when there was never a reservation to invalidate', async () => {
    const invalidated = await agentShareModel.invalidateReservation('op-never-existed');
    expect(invalidated).toBe(false);
  });
});
