// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, agentShareRunReservations, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentShareModel } from '../agentShare';

// Regression tests for the abandoned-reservation leak in
// `packages/database/src/models/agentShare.ts:538`:
//
// If the request process dies after `assertRunnableForVisitor` inserts a
// reservation but before `confirmReservation` or the catch-path
// `releaseReservation`, nothing used to remove that row. A later revocation
// only set `revoked_at`, so a REVOKED reservation lingered forever, and a
// reservation the owner never revokes (an agent whose share config is never
// touched again) lingered forever too — an indexed row per abandoned startup,
// unbounded.
//
// Two fixes, tested separately:
// 1. `revokeReservations` now DELETEs instead of soft-updating — closes the
//    "revoked but never cleaned up" leak.
// 2. `AgentShareModel.sweepAbandonedReservations` deletes any reservation
//    older than a threshold regardless of status — closes the
//    "pending forever, nobody ever revokes it" leak that (1) alone cannot
//    reach.

const ownerId = 'agent-share-reservation-cleanup-owner';
const visitorId = 'agent-share-reservation-cleanup-visitor';

const serverDB: LobeChatDatabase = await getTestDB();
const agentShareModel = new AgentShareModel(serverDB, ownerId);

const cleanup = async () => {
  await serverDB.delete(users).where(eq(users.id, ownerId));
};

describe('AgentShareModel abandoned reservation cleanup (real Postgres)', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([{ id: ownerId }]);
  });

  afterAll(cleanup);

  it('revokeReservations deletes the row instead of leaving a revoked tombstone behind', async () => {
    const agentId = 'reservation-cleanup-revoke-deletes';
    await serverDB
      .insert(agents)
      .values({ id: agentId, model: 'gpt-4o', title: 'Revoke Deletes', userId: ownerId });
    await agentShareModel.create(agentId, 'link');
    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId, senderId: visitorId, userId: ownerId })
      .returning();

    const operationId = 'op-revoke-deletes';
    await agentShareModel.assertRunnableForVisitor({
      agentId,
      expectedGeneration: 1,
      operationId,
      topicId: topic.id,
      visitorUserId: visitorId,
    });

    // Never confirmed or released — simulates the process dying right here,
    // mid-startup. The row is still `agentShareRunReservations`'s only
    // record of this attempted run.
    const [beforeRevoke] = await serverDB
      .select({ id: agentShareRunReservations.id })
      .from(agentShareRunReservations)
      .where(eq(agentShareRunReservations.id, operationId));
    expect(beforeRevoke).toBeDefined();

    const { revocationGeneration } = await agentShareModel.deleteByAgentId(agentId);
    const revoked = await agentShareModel.revokeReservations(agentId, revocationGeneration!);
    expect(revoked).toEqual([{ operationId, topicId: topic.id }]);

    // The row must be GONE, not merely stamped with `revoked_at` — this is
    // what actually bounds table growth instead of leaving a permanent
    // tombstone.
    const [afterRevoke] = await serverDB
      .select({ id: agentShareRunReservations.id })
      .from(agentShareRunReservations)
      .where(eq(agentShareRunReservations.id, operationId));
    expect(afterRevoke).toBeUndefined();

    // `confirmReservation` must still fail closed against the now-missing row.
    const confirmed = await agentShareModel.confirmReservation({
      operationId,
      runningOperation: {
        assistantMessageId: 'msg',
        operationId,
        startedAt: new Date().toISOString(),
      },
      topicId: topic.id,
    });
    expect(confirmed).toBe(false);
  });

  it('sweepAbandonedReservations deletes a pending reservation nobody ever revoked, once it is old enough', async () => {
    const agentId = 'reservation-cleanup-abandoned-pending';
    await serverDB
      .insert(agents)
      .values({ id: agentId, model: 'gpt-4o', title: 'Abandoned Pending', userId: ownerId });
    await agentShareModel.create(agentId, 'link');
    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId, senderId: visitorId, userId: ownerId })
      .returning();

    const operationId = 'op-abandoned-pending';
    await agentShareModel.assertRunnableForVisitor({
      agentId,
      expectedGeneration: 1,
      operationId,
      topicId: topic.id,
      visitorUserId: visitorId,
    });

    // Simulate the process dying right after the reservation was staked: no
    // confirm, no release, and — the case `revokeReservations` alone cannot
    // reach — the owner never touches this share's config/visibility again,
    // so nothing ever revokes it either. Backdate `created_at` past the sweep
    // threshold instead of waiting for real time to pass.
    await serverDB
      .update(agentShareRunReservations)
      .set({ createdAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(agentShareRunReservations.id, operationId));

    // A row that is NOT old enough must survive an aggressive sweep.
    const tooRecentAgentId = 'reservation-cleanup-not-abandoned-yet';
    await serverDB.insert(agents).values({
      id: tooRecentAgentId,
      model: 'gpt-4o',
      title: 'Not Abandoned Yet',
      userId: ownerId,
    });
    await agentShareModel.create(tooRecentAgentId, 'link');
    const [recentTopic] = await serverDB
      .insert(topics)
      .values({ agentId: tooRecentAgentId, senderId: visitorId, userId: ownerId })
      .returning();
    const recentOperationId = 'op-not-abandoned-yet';
    await agentShareModel.assertRunnableForVisitor({
      agentId: tooRecentAgentId,
      expectedGeneration: 1,
      operationId: recentOperationId,
      topicId: recentTopic.id,
      visitorUserId: visitorId,
    });

    const swept = await AgentShareModel.sweepAbandonedReservations(serverDB, 30 * 60 * 1000);

    // `agentId` rides along so `sweep.ts`'s handler can resolve each row's
    // creator (`agents.userId`) and interrupt the orphaned run — see
    // `sweepAbandonedReservations`'s JSDoc.
    expect(swept).toEqual([{ agentId, operationId, topicId: topic.id }]);

    const [stillPending] = await serverDB
      .select({ id: agentShareRunReservations.id })
      .from(agentShareRunReservations)
      .where(eq(agentShareRunReservations.id, recentOperationId));
    expect(stillPending).toBeDefined();

    // The swept reservation's `confirmReservation` must fail closed, exactly
    // like a revoked one — deleting an abandoned row is safe precisely
    // because a belated confirm attempt (if the process somehow weren't
    // actually dead) degrades to the same "interrupted, never billed"
    // outcome as a live revocation.
    const confirmed = await agentShareModel.confirmReservation({
      operationId,
      runningOperation: {
        assistantMessageId: 'msg',
        operationId,
        startedAt: new Date().toISOString(),
      },
      topicId: topic.id,
    });
    expect(confirmed).toBe(false);
  });
});
