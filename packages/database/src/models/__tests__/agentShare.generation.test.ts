// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentShareModel } from '../agentShare';
import { TopicModel } from '../topic';

// Regression tests for the two Codex findings on
// `apps/server/src/routers/lambda/agentShare.ts`:
//
// P1 (tightening must invalidate runs already snapshotted under the old
// grants) and P2 (a deferred revocation sweep must not clobber a legitimate
// republish that lands before it runs) pull in opposite directions — a fix
// for one that isn't scoped correctly reopens the other. Both are closed here
// by a single mechanism: a monotonic `agentShareGenerations` counter, bumped
// by every restrictive write and stamped onto each reservation at
// `assertRunnableForVisitor` time (see that method's JSDoc, and
// `agentShareGenerations`'s JSDoc in `packages/database/src/schemas/agentShare.ts`).
//
// Unlike `agentShare.visitorReservation.race.test.ts` (which exercises actual
// concurrent interleaving via `Promise.all`), these are deterministic,
// sequential real-Postgres tests: the generation semantics being verified
// here don't depend on which side wins a row-lock race, only on the counter
// value each write observes/produces.
const ownerId = 'agent-share-generation-owner';
const visitorId = 'agent-share-generation-visitor';

const serverDB: LobeChatDatabase = await getTestDB();
const agentShareModel = new AgentShareModel(serverDB, ownerId);
const topicModel = new TopicModel(serverDB, ownerId);

const cleanup = async () => {
  await serverDB.delete(users).where(eq(users.id, ownerId));
};

describe('AgentShareModel restrictive-change generation (real Postgres)', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([{ id: ownerId }]);
  });

  afterAll(cleanup);

  it('tighten-during-run: a reservation staked before a tightening is revoked, and its already-running operation is caught', async () => {
    const agentId = 'generation-tighten-during-run';
    await serverDB
      .insert(agents)
      .values({ id: agentId, model: 'gpt-4o', title: 'Tighten During Run', userId: ownerId });
    await agentShareModel.create(agentId, 'link');
    await agentShareModel.updateConfig(agentId, { enabledToolIds: ['web-search'] });
    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId, senderId: visitorId, userId: ownerId })
      .returning();

    // Visitor's request read the share while `enabledToolIds` still included
    // `web-search` — generation 1 (never tightened yet).
    const operationId = 'op-tighten-during-run';
    await agentShareModel.assertRunnableForVisitor({
      agentId,
      expectedGeneration: 1,
      operationId,
      topicId: topic.id,
      visitorUserId: visitorId,
    });
    const confirmed = await agentShareModel.confirmReservation({
      operationId,
      runningOperation: {
        assistantMessageId: 'msg-1',
        operationId,
        startedAt: new Date().toISOString(),
      },
      topicId: topic.id,
    });
    expect(confirmed).toBe(true);

    // Owner drops the tool mid-run — a tightening, so this bumps the
    // generation and returns it as `revocationGeneration`.
    const { revocationGeneration } = await agentShareModel.updateConfig(agentId, {
      enabledToolIds: [],
    });
    expect(revocationGeneration).toBe(2);

    // Mirrors `AiAgentService.interruptActiveShareRuns`: a single scoped
    // sweep, no polling.
    const revokedReservations = await agentShareModel.revokeReservations(
      agentId,
      revocationGeneration!,
    );
    const activeRuns = await topicModel.findActiveVisitorRunTopics(agentId, revocationGeneration);

    // The reservation row was already deleted by `confirmReservation`, so
    // `revokeReservations` finds nothing there — but the run it produced is
    // caught by the topic-metadata sweep, because `confirmReservation`
    // stamped the OLD generation (1) onto `runningOperation.shareGeneration`.
    expect(revokedReservations).toEqual([]);
    expect(activeRuns).toEqual([{ operationId, topicId: topic.id }]);
  });

  it('tighten-then-start: a request that snapshotted the config before a tightening fails closed on startup', async () => {
    const agentId = 'generation-tighten-then-start';
    await serverDB
      .insert(agents)
      .values({ id: agentId, model: 'gpt-4o', title: 'Tighten Then Start', userId: ownerId });
    await agentShareModel.create(agentId, 'link');
    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId, senderId: visitorId, userId: ownerId })
      .returning();

    // Visitor's `findByShareIdWithAccessCheck` read happens BEFORE the
    // tightening below, so it carries forward generation 1.
    const staleGeneration = 1;

    // Owner tightens (memory read -> none) before the visitor's request
    // reaches `assertRunnableForVisitor` — e.g. slow tool/knowledge-base
    // resolution in `execAgentWithReservation`. `allowReadMemory` starts
    // `false` by default, so first grant read access, then revoke it, to
    // produce a genuine true -> false transition and a real generation bump.
    await agentShareModel.updateConfig(agentId, { allowReadMemory: true });
    const { revocationGeneration: bumpedGeneration } = await agentShareModel.updateConfig(agentId, {
      allowReadMemory: false,
    });
    expect(bumpedGeneration).toBeDefined();

    await expect(
      agentShareModel.assertRunnableForVisitor({
        agentId,
        expectedGeneration: staleGeneration,
        operationId: 'op-tighten-then-start',
        topicId: topic.id,
        visitorUserId: visitorId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // Fail closed means no reservation was staked either.
    const active = await topicModel.findActiveVisitorRunTopics(agentId);
    expect(active).toEqual([]);
  });

  it('revoke -> republish -> stale callback: a run started after the republish survives a deferred sweep scoped to the earlier revocation', async () => {
    const agentId = 'generation-revoke-republish-stale-callback';
    await serverDB.insert(agents).values({
      id: agentId,
      model: 'gpt-4o',
      title: 'Revoke Republish Stale Callback',
      userId: ownerId,
    });
    await agentShareModel.create(agentId, 'link');
    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId, senderId: visitorId, userId: ownerId })
      .returning();

    // 1. Owner flips the share private — bumps the generation and is the
    // cutoff a deferred `after()` callback will (eventually) sweep with.
    const { revocationGeneration: staleRevocationGeneration } =
      await agentShareModel.updateVisibility(agentId, 'private');
    expect(staleRevocationGeneration).toBeDefined();

    // 2. Owner immediately republishes — before that deferred callback has
    // actually run (it's scheduled post-response via `after()`, so this is a
    // realistic ordering, not a contrived one).
    const { share: republished } = await agentShareModel.updateVisibility(agentId, 'link');
    expect(republished?.visibility).toBe('link');

    // 3. A new visitor request starts a run AFTER the republish, observing
    // the CURRENT generation (unchanged by republishing — only tightening
    // bumps it).
    const currentGeneration = republished
      ? (await AgentShareModel.findByShareId(serverDB, republished.id))!.generation
      : -1;
    const operationId = 'op-post-republish';
    await agentShareModel.assertRunnableForVisitor({
      agentId,
      expectedGeneration: currentGeneration,
      operationId,
      topicId: topic.id,
      visitorUserId: visitorId,
    });
    const confirmed = await agentShareModel.confirmReservation({
      operationId,
      runningOperation: {
        assistantMessageId: 'msg-post-republish',
        operationId,
        startedAt: new Date().toISOString(),
      },
      topicId: topic.id,
    });
    expect(confirmed).toBe(true);

    // 4. The step-1 revocation's deferred callback FINALLY runs now, still
    // carrying the generation it captured at write time (step 1) —
    // `interruptActiveShareRuns(agentId, staleRevocationGeneration)`.
    const staleSweepRevoked = await agentShareModel.revokeReservations(
      agentId,
      staleRevocationGeneration!,
    );
    const staleSweepActive = await topicModel.findActiveVisitorRunTopics(
      agentId,
      staleRevocationGeneration,
    );

    // The republish's run must survive: its generation is >= the stale
    // cutoff, so neither sweep touches it.
    expect(staleSweepRevoked).toEqual([]);
    expect(staleSweepActive).toEqual([]);

    const [persistedTopic] = await serverDB
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(eq(topics.id, topic.id));
    expect((persistedTopic?.metadata as any)?.runningOperation?.operationId).toBe(operationId);
  });

  it('revoke -> mid-startup run: a reservation staked just before a revocation is still caught by a same-generation sweep', async () => {
    const agentId = 'generation-revoke-mid-startup';
    await serverDB
      .insert(agents)
      .values({ id: agentId, model: 'gpt-4o', title: 'Revoke Mid Startup', userId: ownerId });
    await agentShareModel.create(agentId, 'link');
    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId, senderId: visitorId, userId: ownerId })
      .returning();

    // Visitor's recheck+reserve lands first, while the share is still `link`
    // at generation 1 — mirrors a run whose `createOperation` I/O hasn't
    // finished yet.
    const operationId = 'op-revoke-mid-startup';
    await agentShareModel.assertRunnableForVisitor({
      agentId,
      expectedGeneration: 1,
      operationId,
      topicId: topic.id,
      visitorUserId: visitorId,
    });

    // Owner disables the share before the run finishes standing up.
    const { revocationGeneration } = await agentShareModel.deleteByAgentId(agentId);
    expect(revocationGeneration).toBeDefined();

    const revoked = await agentShareModel.revokeReservations(agentId, revocationGeneration!);
    expect(revoked).toEqual([{ operationId, topicId: topic.id }]);

    // The run's belated `confirmReservation` must fail closed — the row is
    // gone (revoked, not confirmed).
    const confirmed = await agentShareModel.confirmReservation({
      operationId,
      runningOperation: {
        assistantMessageId: 'msg-revoke-mid-startup',
        operationId,
        startedAt: new Date().toISOString(),
      },
      topicId: topic.id,
    });
    expect(confirmed).toBe(false);
  });
});
