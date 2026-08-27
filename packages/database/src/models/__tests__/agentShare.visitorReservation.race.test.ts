// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, agentShareRunReservations, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentShareModel } from '../agentShare';
import { TopicModel } from '../topic';

// Real-Postgres reproduction of a visibility-recheck race, and of the
// follow-up gap found in the first fix attempt.
//
// A visitor's `shareChat.execAgent` passes `findByShareIdWithAccessCheck`
// once, at request entry, while the share is still `link`. Thousands of
// lines of agent-config/tool/knowledge-base resolution later,
// `execAgentWithReservation` actually creates the operation
// (`AgentRuntimeService.createOperation`: gateway registration, state
// persistence, queue scheduling) and writes `topics.metadata.runningOperation`.
//
// The first fix re-checked visibility immediately before that
// (`AgentShareModel.assertRunnableForVisitor`, under the SAME `agents.id FOR
// UPDATE` lock revocation takes) but closed the remaining window — between
// that recheck and the marker actually being written — with a BOUNDED RETRY
// (`interruptActiveShareRuns` polling `findActiveVisitorRunTopics` 4x/750ms).
// That is a timing heuristic, not a fix: if `createOperation` takes longer
// than ~3s (slow gateway/queue call under load), every scan misses the
// operation and it runs unstoppably on the creator's budget.
//
// The real fix replaces the retry with a durable reservation:
// `assertRunnableForVisitor` inserts an `agentShareRunReservations` row in
// the SAME locked transaction as the visibility check, BEFORE any
// gateway/queue I/O begins. `confirmReservation` (called right before the
// `runningOperation` marker write) and `revokeReservations` (called by
// revocation) both write that SAME row, so Postgres row locking — not a
// clock — decides which one wins: whichever commits first is the outcome the
// other observes, no matter how long `createOperation` actually takes.
//
// Both tests below drive REAL "visitor start" and REAL "owner revoke" flows
// against real Postgres on separate connections, so genuine interleaving is
// possible.

const ownerId = 'agent-share-visitor-reservation-owner';
const visitorId = 'agent-share-visitor-reservation-visitor';

const serverDB: LobeChatDatabase = await getTestDB();
const agentShareModel = new AgentShareModel(serverDB, ownerId);
const topicModel = new TopicModel(serverDB, ownerId);

const cleanup = async () => {
  await serverDB.delete(users).where(eq(users.id, ownerId));
};

/** Mirrors `execAgentWithReservation`'s ordering: recheck+reserve, then (only if that passed) confirm+mark-running. */
const startVisitorRun = async (
  agentId: string,
  operationId: string,
  topicId: string,
  expectedGeneration: number,
): Promise<'rejected-upfront' | 'rejected-on-confirm' | 'started'> => {
  try {
    await agentShareModel.assertRunnableForVisitor({
      agentId,
      expectedGeneration,
      operationId,
      topicId,
      visitorUserId: visitorId,
    });
  } catch {
    return 'rejected-upfront';
  }

  const confirmed = await agentShareModel.confirmReservation({
    operationId,
    runningOperation: {
      assistantMessageId: 'test-message',
      operationId,
      startedAt: new Date().toISOString(),
    },
    topicId,
  });

  if (!confirmed) {
    await agentShareModel.releaseReservation(operationId);
    return 'rejected-on-confirm';
  }

  return 'started';
};

/** Mirrors `agentShareRouter.disableShare` followed by `interruptActiveShareRuns` — single-query, no retry. */
const revokeAndCollectSurvivors = async (
  agentId: string,
  topicId: string,
): Promise<{ operationId: string; topicId: string }[]> => {
  const { revocationGeneration } = await agentShareModel.deleteByAgentId(agentId);

  const revoked = await agentShareModel.revokeReservations(agentId, revocationGeneration!);
  const active = await topicModel.findActiveVisitorRunTopics(agentId, revocationGeneration);

  // Same de-dupe `interruptActiveShareRuns` does across both sources.
  const seen = new Set(revoked.map((r) => r.operationId));
  const survivors = active.filter((run) => run.topicId === topicId || seen.has(run.operationId));
  return survivors;
};

describe('AgentShareModel visitor run reservation × revocation (real Postgres)', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([{ id: ownerId }]);
  });

  afterAll(cleanup);

  it('never leaves an unstoppable operation after a concurrent revoke', async () => {
    // Kept modest (not the 15 the previous version of this test used):
    // every trial round-trips several queries against a real remote
    // Postgres instance, and this loop runs them sequentially.
    const TRIALS = 8;
    let rejectedUpfront = 0;
    let rejectedOnConfirm = 0;
    let startedAndCaught = 0;
    let unsafeLeak = 0;

    for (let i = 0; i < TRIALS; i += 1) {
      const agentId = `visitor-reservation-race-${i}`;
      const operationId = `op-${i}`;
      await serverDB
        .insert(agents)
        .values({ id: agentId, model: 'gpt-4o', title: 'Race Agent', userId: ownerId });
      await agentShareModel.create(agentId, 'link');
      const [topic] = await serverDB
        .insert(topics)
        .values({ agentId, senderId: visitorId, userId: ownerId })
        .returning();

      const [startResult, survivors] = await Promise.all([
        // Baseline generation: this agent's share was just `create()`d and
        // never tightened/revoked, so the counter has never been bumped.
        startVisitorRun(agentId, operationId, topic.id, 1),
        revokeAndCollectSurvivors(agentId, topic.id),
      ]);

      if (startResult === 'rejected-upfront') {
        rejectedUpfront += 1;
      } else if (startResult === 'rejected-on-confirm') {
        rejectedOnConfirm += 1;
      } else if (survivors.length > 0) {
        // Started, but revocation's single query still caught it — the
        // reservation row-lock ordering guaranteed the marker was already
        // committed by the time revoke's query ran.
        startedAndCaught += 1;
      } else {
        unsafeLeak += 1;
      }

      // No reservation row should ever survive a trial, win or lose.
      const [leftoverReservation] = await serverDB
        .select({ id: agentShareRunReservations.id })
        .from(agentShareRunReservations)
        .where(eq(agentShareRunReservations.id, operationId));
      expect(leftoverReservation).toBeUndefined();
    }

    console.log(
      `[visitor reservation race] rejected-upfront=${rejectedUpfront} rejected-on-confirm=${rejectedOnConfirm} started-and-caught=${startedAndCaught} leaked=${unsafeLeak} / ${TRIALS}`,
    );

    // Regardless of which side won the row-lock race, no trial may end with
    // a live operation the visitor can no longer stop.
    expect(unsafeLeak).toBe(0);
  }, 60_000);

  // The case Codex specifically asked for: startup artificially delayed well
  // beyond the OLD bounded retry window (4 attempts x 750ms = 3s), with
  // revocation landing in the middle of that delay. A timing-based retry
  // would have missed this entirely — the row-lock-based mechanism must not.
  it('fails closed when the run is stood up far slower than any previous retry window', async () => {
    const agentId = 'visitor-reservation-delayed-startup';
    const operationId = 'op-delayed-startup';
    await serverDB
      .insert(agents)
      .values({ id: agentId, model: 'gpt-4o', title: 'Delayed Start Agent', userId: ownerId });
    await agentShareModel.create(agentId, 'link');
    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId, senderId: visitorId, userId: ownerId })
      .returning();

    // 1. Visitor's recheck passes and stakes the reservation while the share
    // is still `link` — mirrors `assertRunnableForVisitor` running before
    // `createOperation`'s I/O.
    await agentShareModel.assertRunnableForVisitor({
      agentId,
      // Baseline generation — this share was just `create()`d.
      expectedGeneration: 1,
      operationId,
      topicId: topic.id,
      visitorUserId: visitorId,
    });

    // 2. Simulate `createOperation` taking far longer than the old 3s retry
    // budget (gateway registration + state persistence + queue scheduling
    // under load) — 5s, well past 4x750ms.
    const STARTUP_DELAY_MS = 5000;
    const standingUp = new Promise((resolve) => setTimeout(resolve, STARTUP_DELAY_MS));

    // 3. Revocation lands in the middle of that delay — well within the
    // window the OLD retry loop would have already given up on.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const { revocationGeneration } = await agentShareModel.deleteByAgentId(agentId);
    const revoked = await agentShareModel.revokeReservations(agentId, revocationGeneration!);
    expect(revoked).toEqual([{ operationId, topicId: topic.id }]);

    await standingUp;

    // 4. The run finally finishes "standing up" and tries to confirm — it
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
  }, 15_000);
});
