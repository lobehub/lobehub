// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentShareRunReservations, agentShares, topics, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';
import { AgentShareModel } from '../agentShare';
import { TopicModel } from '../topic';

// Real-Postgres reproduction of the missing revocation bump at
// `packages/database/src/models/agent.ts:2221`: `AgentModel.transferAgents`
// used to flip a link-shared personal agent's `agentShares.visibility` to
// `private` with a bare `UPDATE`, WITHOUT bumping `agentShareGenerations` or
// scheduling `AiAgentService.interruptActiveShareRuns` — the same
// generation-bump + post-commit-notify contract every other revocation path
// (`AgentShareModel.updateVisibility` / `deleteByAgentId`,
// `writeAgentConfigWithShareReset`) already uses.
//
// Without that bump, a reservation staked (`assertRunnableForVisitor`) just
// before the transfer, or an operation that already confirmed and is
// standing up, would survive the move: `revokeReservations` /
// `findActiveVisitorRunTopics` only sweep generations strictly older than the
// one a revocation bumps TO, so a bare visibility flip with no bump leaves
// them nothing to match against — the reservation could confirm (or the
// operation keep running) AFTER the agent has already left personal scope,
// with the visitor unable to stop it (the share is unresolvable in the new
// scope).
//
// Both tests below drive REAL "visitor start" and REAL "owner transfer" flows
// against real Postgres on separate connections, mirroring
// `agentShare.visitorReservation.race.test.ts`.

const ownerId = 'agent-share-transfer-race-owner';
const visitorId = 'agent-share-transfer-race-visitor';
const targetWsId = 'agent-share-transfer-race-ws';

const serverDB: LobeChatDatabase = await getTestDB();
// Scoped to the TARGET workspace, mirroring what
// `scheduleShareRunInterruptOnReset`'s `targetWorkspaceId` param makes
// production do post-transfer: `AiAgentService`'s own `TopicModel` gets
// constructed with the workspace the transfer just moved the topic into,
// not the source personal scope.
const targetScopedTopicModel = new TopicModel(serverDB, ownerId, targetWsId);

const cleanup = async () => {
  await serverDB.delete(users).where(eq(users.id, ownerId));
  await serverDB.delete(users).where(eq(users.id, visitorId));
};

/** Mirrors `execAgentWithReservation`'s ordering: recheck+reserve, then (only if that passed) confirm+mark-running. */
const startVisitorRun = async (
  agentShareModel: AgentShareModel,
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

/**
 * Mirrors what the router wires up for `AgentModel.transferAgent`
 * (`scheduleShareRunInterruptOnReset` -> `AiAgentService.interruptActiveShareRuns`):
 * capture the generation `onShareReset` fires with, then perform the same
 * single-query revoke + active-run sweep, no retry — except the active-run
 * sweep runs against `targetScopedTopicModel` (the TARGET workspace), not a
 * personal-scoped model, exactly like `scheduleShareRunInterruptOnReset`'s
 * `targetWorkspaceId` param makes `AiAgentService` do post-transfer. A
 * personal-scoped re-query would silently miss an already-running
 * operation's topic, which the transfer has by now moved into that
 * workspace.
 */
const transferAndCollectSurvivors = async (
  agentShareModel: AgentShareModel,
  agentId: string,
  topicId: string,
): Promise<{ operationId: string; topicId: string }[]> => {
  let revocationGeneration: number | undefined;
  const transferringModel = new AgentModel(serverDB, ownerId, undefined, {
    onShareReset: (_agentId, generation) => {
      revocationGeneration = generation;
    },
  });

  await transferringModel.transferAgent(agentId, targetWsId, ownerId);

  if (revocationGeneration === undefined) return [];

  const revoked = await agentShareModel.revokeReservations(agentId, revocationGeneration);
  const active = await targetScopedTopicModel.findActiveVisitorRunTopics(
    agentId,
    revocationGeneration,
  );

  const seen = new Set(revoked.map((r) => r.operationId));
  return active.filter((run) => run.topicId === topicId || seen.has(run.operationId));
};

describe('AgentModel.transferAgents share reset x visitor run reservation (real Postgres)', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([{ id: ownerId }, { id: visitorId }]);
    await serverDB.insert(workspaces).values([
      {
        id: targetWsId,
        name: 'Transfer Race WS',
        primaryOwnerId: ownerId,
        slug: 'agent-share-transfer-race-ws',
      },
    ]);
  });

  afterAll(cleanup);

  it('never leaves an unstoppable operation after a concurrent transfer into a workspace', async () => {
    const TRIALS = 8;
    let rejectedUpfront = 0;
    let rejectedOnConfirm = 0;
    let startedAndCaught = 0;
    let unsafeLeak = 0;

    for (let i = 0; i < TRIALS; i += 1) {
      const agentId = `transfer-race-${i}`;
      const operationId = `op-transfer-race-${i}`;
      const agentModel = new AgentModel(serverDB, ownerId);
      const agentShareModel = new AgentShareModel(serverDB, ownerId);
      const agent = await agentModel.create({ id: agentId, title: 'Transfer Race Agent' });
      const share = await agentShareModel.create(agent.id, 'link');
      // The conversation belongs to the VISITOR — `userId` is the visitor's
      // own id, `shareId` is the sole provenance marker.
      const [topic] = await serverDB
        .insert(topics)
        .values({ agentId: agent.id, shareId: share!.id, userId: visitorId })
        .returning();

      const [startResult, survivors] = await Promise.all([
        // Baseline generation: this agent's share was just `create()`d and
        // never tightened/revoked, so the counter has never been bumped.
        startVisitorRun(agentShareModel, agent.id, operationId, topic.id, 1),
        transferAndCollectSurvivors(agentShareModel, agent.id, topic.id),
      ]);

      if (startResult === 'rejected-upfront') {
        rejectedUpfront += 1;
      } else if (startResult === 'rejected-on-confirm') {
        rejectedOnConfirm += 1;
      } else if (survivors.length > 0) {
        startedAndCaught += 1;
      } else {
        unsafeLeak += 1;
      }

      const [leftoverReservation] = await serverDB
        .select({ id: agentShareRunReservations.id })
        .from(agentShareRunReservations)
        .where(eq(agentShareRunReservations.id, operationId));
      expect(leftoverReservation).toBeUndefined();
    }

    console.log(
      `[transfer race] rejected-upfront=${rejectedUpfront} rejected-on-confirm=${rejectedOnConfirm} started-and-caught=${startedAndCaught} leaked=${unsafeLeak} / ${TRIALS}`,
    );

    expect(unsafeLeak).toBe(0);
  }, 60_000);

  // The exact case this fix targets: a reservation staked while the agent is
  // still personal-scoped, then the transfer landing mid-startup — well
  // before `createOperation` would normally finish. The reservation must not
  // be confirmable afterwards, and the agent's share row must actually be
  // unresolvable (flipped private) in its new scope.
  it('fails closed when a transfer lands while a reservation is still standing up', async () => {
    const agentId = 'transfer-race-delayed-startup';
    const operationId = 'op-transfer-delayed-startup';
    const agentModel = new AgentModel(serverDB, ownerId);
    const agentShareModel = new AgentShareModel(serverDB, ownerId);
    const agent = await agentModel.create({ id: agentId, title: 'Delayed Start Agent' });
    const share = await agentShareModel.create(agent.id, 'link');
    // The conversation belongs to the VISITOR — see the previous test's note.
    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId: agent.id, shareId: share!.id, userId: visitorId })
      .returning();

    // 1. Visitor's recheck passes and stakes the reservation while the agent
    // is still personal-scoped — mirrors `assertRunnableForVisitor` running
    // before `createOperation`'s I/O.
    await agentShareModel.assertRunnableForVisitor({
      agentId: agent.id,
      expectedGeneration: 1,
      operationId,
      topicId: topic.id,
      visitorUserId: visitorId,
    });

    // 2. Simulate `createOperation` taking a while (gateway registration +
    // state persistence + queue scheduling), with the transfer landing in the
    // middle of that delay.
    const STARTUP_DELAY_MS = 2000;
    const standingUp = new Promise((resolve) => setTimeout(resolve, STARTUP_DELAY_MS));

    await new Promise((resolve) => setTimeout(resolve, 300));

    let revocationGeneration: number | undefined;
    const transferringModel = new AgentModel(serverDB, ownerId, undefined, {
      onShareReset: (_agentId, generation) => {
        revocationGeneration = generation;
      },
    });
    await transferringModel.transferAgent(agent.id, targetWsId, ownerId);
    expect(revocationGeneration).toBe(2);

    const revoked = await agentShareModel.revokeReservations(agent.id, revocationGeneration!);
    expect(revoked).toEqual([{ operationId, topicId: topic.id }]);

    await standingUp;

    // 3. The run finally finishes "standing up" and tries to confirm — it
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

    // 4. The share itself is unresolvable in the new (workspace) scope — the
    // whole point of the transfer's reset.
    const [movedShare] = await serverDB
      .select()
      .from(agentShares)
      .where(eq(agentShares.agentId, agent.id));
    expect(movedShare.visibility).toBe('private');
  }, 15_000);

  // The bug this fix targets: personal -> workspace A -> workspace B,
  // with the deferred `interruptActiveShareRuns` callback (scheduled by the
  // FIRST transfer, still carrying ITS `revocationGeneration`) firing only
  // AFTER the second move. The second transfer flips no `agentShares` row
  // (already `private` after the first) and so schedules no callback of its
  // own — the ONE callback that will ever exist for this revocation must
  // still find the run wherever the SECOND transfer left it (workspace B),
  // not the workspace the callback was originally scoped to (A). See
  // `TopicModel.findActiveVisitorRunTopics`'s JSDoc and
  // `shareResetInterrupt.ts`'s JSDoc for the full rationale.
  it('finds an already-running visitor operation after a SECOND transfer moves it again before the deferred sweep runs', async () => {
    const secondWsId = 'agent-share-transfer-race-ws-2';
    await serverDB.insert(workspaces).values([
      {
        id: secondWsId,
        name: 'Transfer Race WS 2',
        primaryOwnerId: ownerId,
        slug: 'agent-share-transfer-race-ws-2',
      },
    ]);

    const agentId = 'double-transfer-race';
    const operationId = 'op-double-transfer-race';
    const agentModel = new AgentModel(serverDB, ownerId);
    const agentShareModel = new AgentShareModel(serverDB, ownerId);
    const agent = await agentModel.create({ id: agentId, title: 'Double Transfer Agent' });
    const share = await agentShareModel.create(agent.id, 'link');
    // The share conversation belongs to the VISITOR; `shareId` links it back
    // to the share instance it came from (see `schemas/topic.ts`).
    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId: agent.id, shareId: share.id, userId: visitorId })
      .returning();

    // The run confirms (starts) while the agent is still personal-scoped.
    await agentShareModel.assertRunnableForVisitor({
      agentId: agent.id,
      expectedGeneration: 1,
      operationId,
      topicId: topic.id,
      visitorUserId: visitorId,
    });
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

    // Transfer #1: personal -> workspace A. Only transfer that ever flips
    // `agentShares.visibility`, so only transfer whose `onShareReset` fires.
    let revocationGeneration: number | undefined;
    let onShareResetCallCount = 0;
    const firstTransferringModel = new AgentModel(serverDB, ownerId, undefined, {
      onShareReset: (_agentId, generation) => {
        onShareResetCallCount += 1;
        revocationGeneration = generation;
      },
    });
    await firstTransferringModel.transferAgent(agent.id, targetWsId, ownerId);
    expect(revocationGeneration).toBe(2);

    // Transfer #2: workspace A -> workspace B, BEFORE the deferred callback
    // from transfer #1 has run — this test drives that sweep manually below,
    // simulating the delay `after()` introduces in production. Scoped to
    // workspace A, mirroring an owner/admin acting from within it.
    const secondTransferringModel = new AgentModel(serverDB, ownerId, targetWsId, {
      onShareReset: () => {
        onShareResetCallCount += 1;
      },
    });
    await secondTransferringModel.transferAgent(agent.id, secondWsId, ownerId);

    // The second transfer must not have scheduled a callback of its own.
    expect(onShareResetCallCount).toBe(1);

    const [movedTopic] = await serverDB
      .select({ workspaceId: topics.workspaceId })
      .from(topics)
      .where(eq(topics.id, topic.id));
    expect(movedTopic?.workspaceId).toBe(secondWsId);

    // Simulate the deferred callback finally running, still carrying
    // transfer #1's `revocationGeneration` — exactly like
    // `scheduleShareRunInterruptOnReset` -> `interruptActiveShareRuns`.
    const revoked = await agentShareModel.revokeReservations(agent.id, revocationGeneration!);
    expect(revoked).toEqual([]); // already confirmed, nothing left to revoke

    const unscopedTopicModel = new TopicModel(serverDB, ownerId);
    const active = await unscopedTopicModel.findActiveVisitorRunTopics(
      agent.id,
      revocationGeneration!,
    );
    // Found by `agentId` alone, in its ACTUAL current workspace (B).
    // `findActiveVisitorRunTopics` is deliberately unscoped by workspace AND
    // by user (see its JSDoc): a workspace-scoped variant would miss the topic
    // after a second transfer, and a user-scoped one could not see it at all
    // now that a share conversation belongs to the visitor rather than the
    // creator running this sweep.
    expect(active).toEqual([
      {
        metadata: expect.objectContaining({ runningOperation: expect.anything() }),
        operationId,
        topicId: topic.id,
      },
    ]);
  }, 15_000);
});
