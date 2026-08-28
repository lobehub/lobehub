// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { AgentShareModel } from '../../../models/agentShare';
import { TopicModel } from '../../../models/topic';
import {
  agents,
  agentShareRunReservations,
  agentShares,
  chatGroups,
  chatGroupsAgents,
  topics,
  users,
  workspaces,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { AgentGroupRepository } from '../index';

// Real-Postgres reproduction of the missing revocation bump's group-transfer equivalent at
// `packages/database/src/repositories/agentGroup/index.ts` (`transferToWorkspace`):
// a group-owned agent's `agentShares` reset had the exact same bypass as
// `AgentModel.transferAgents` — a bare visibility flip with no
// `agentShareGenerations` bump and no scheduled
// `AiAgentService.interruptActiveShareRuns`. See
// `agentShare.transferRace.test.ts` (`packages/database/src/models/__tests__/`)
// for the single-agent version of this test and its full rationale.

const ownerId = 'agent-share-group-transfer-race-owner';
const visitorId = 'agent-share-group-transfer-race-visitor';
const targetWsId = 'agent-share-group-transfer-race-ws';
const groupId = 'agent-share-group-transfer-race-group';
const supervisorId = 'agent-share-group-transfer-race-supervisor';

const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  await serverDB.delete(users);
  // The visitor is a real user row: a share conversation is THEIR topic.
  await serverDB.insert(users).values([{ id: ownerId }, { id: visitorId }]);
  await serverDB.insert(workspaces).values([
    {
      id: targetWsId,
      name: 'Group Transfer Race WS',
      primaryOwnerId: ownerId,
      slug: 'agent-share-group-transfer-race-ws',
    },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AgentGroupRepository.transferToWorkspace share reset x visitor run reservation (real Postgres)', () => {
  it('bumps the share generation and revokes a reservation staked just before the group transfer', async () => {
    await serverDB
      .insert(agents)
      .values([{ id: supervisorId, title: 'Supervisor', userId: ownerId, virtual: true }]);
    await serverDB.insert(chatGroups).values([{ id: groupId, title: 'Team', userId: ownerId }]);
    await serverDB.insert(chatGroupsAgents).values([
      {
        agentId: supervisorId,
        chatGroupId: groupId,
        order: -1,
        role: 'supervisor',
        userId: ownerId,
      },
    ]);

    const agentShareModel = new AgentShareModel(serverDB, ownerId);
    // The supervisor is `owned` by the group but is still an ordinary
    // personal agent as far as Agent Share is concerned — it can carry its
    // own `link` share the same as any other personal agent.
    const share = await agentShareModel.create(supervisorId, 'link');

    // The share conversation belongs to the VISITOR; `shareId` links it back
    // to the share instance it came from (see `schemas/topic.ts`).
    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId: supervisorId, shareId: share.id, userId: visitorId })
      .returning();

    const operationId = 'op-group-transfer-race';
    // Visitor's recheck+reserve lands first, while the share is still `link`
    // at generation 1 — mirrors a run whose `createOperation` I/O hasn't
    // finished yet.
    await agentShareModel.assertRunnableForVisitor({
      agentId: supervisorId,
      expectedGeneration: 1,
      operationId,
      topicId: topic.id,
      visitorUserId: visitorId,
    });

    let revocationGeneration: number | undefined;
    const transferringRepo = new AgentGroupRepository(serverDB, ownerId, undefined, {
      onShareReset: (_agentId, generation) => {
        revocationGeneration = generation;
      },
    });

    await transferringRepo.transferToWorkspace(groupId, targetWsId, ownerId);

    expect(revocationGeneration).toBe(2);

    const revoked = await agentShareModel.revokeReservations(supervisorId, revocationGeneration!);
    expect(revoked).toEqual([{ operationId, topicId: topic.id }]);

    // The run's belated `confirmReservation` must fail closed.
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

    // `revokeReservations` claims the row by deleting it, so nothing is left
    // for a late `confirmReservation` (whose own `DELETE ... WHERE revoked_at
    // IS NULL` targets the same row) to find — which is exactly why the
    // `confirmReservation` above fails closed.
    const remaining = await serverDB
      .select({ id: agentShareRunReservations.id })
      .from(agentShareRunReservations)
      .where(eq(agentShareRunReservations.id, operationId));
    expect(remaining).toEqual([]);

    // The share itself is unresolvable in the new (workspace) scope — the
    // whole point of the transfer's reset.
    const [movedShare] = await serverDB
      .select()
      .from(agentShares)
      .where(eq(agentShares.agentId, supervisorId));
    expect(movedShare.visibility).toBe('private');
  });

  it('snapshots an already-running visitor operation before the topic moves into the target workspace', async () => {
    await serverDB
      .insert(agents)
      .values([{ id: supervisorId, title: 'Supervisor', userId: ownerId, virtual: true }]);
    await serverDB.insert(chatGroups).values([{ id: groupId, title: 'Team', userId: ownerId }]);
    await serverDB.insert(chatGroupsAgents).values([
      {
        agentId: supervisorId,
        chatGroupId: groupId,
        order: -1,
        role: 'supervisor',
        userId: ownerId,
      },
    ]);

    const agentShareModel = new AgentShareModel(serverDB, ownerId);
    const share = await agentShareModel.create(supervisorId, 'link');

    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId: supervisorId, groupId, shareId: share.id, userId: visitorId })
      .returning();

    const operationId = 'op-group-transfer-race-running';
    // Unlike the merely-staked case above, this run has already confirmed and
    // is standing as `running` on the topic by the time the transfer starts —
    // `onShareReset`'s own post-commit sweep cannot find it once the topic's
    // `workspaceId` has moved, so `transferToWorkspace` must snapshot it
    // itself, inside the same transaction, before that move.
    await agentShareModel.assertRunnableForVisitor({
      agentId: supervisorId,
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

    let revocationGeneration: number | undefined;
    const transferringRepo = new AgentGroupRepository(serverDB, ownerId, undefined, {
      onShareReset: (_agentId, generation) => {
        revocationGeneration = generation;
      },
    });

    await transferringRepo.transferToWorkspace(groupId, targetWsId, ownerId);

    expect(revocationGeneration).toBe(2);

    // Agent-scoped, mirroring what `scheduleShareRunInterruptOnReset`
    // actually does post-transfer: `findActiveVisitorRunTopics`
    // matches on `supervisorId` alone, independent of which workspace the
    // transfer moved the topic into. A personal-scoped (or, before this
    // fix, a stale-workspace-scoped) re-query would miss this topic now that
    // the transfer has moved it.
    const unscopedTopicModel = new TopicModel(serverDB, ownerId);
    const active = await unscopedTopicModel.findActiveVisitorRunTopics(
      supervisorId,
      revocationGeneration!,
    );
    expect(active).toEqual([
      {
        metadata: expect.objectContaining({ runningOperation: expect.anything() }),
        operationId,
        topicId: topic.id,
      },
    ]);
  });

  // The bug this fix targets: a personal→A→B double transfer before the
  // deferred `interruptActiveShareRuns` callback (scheduled by the FIRST
  // transfer) fires. The second transfer schedules no callback of its own —
  // the share is already `private` after the first move, so its own
  // `ne(visibility, 'private')` reset guard finds nothing to reset — so the
  // ONE callback that will ever run for this revocation must still find the
  // topic wherever the SECOND transfer left it (workspace B, not the FIRST
  // transfer's workspace A). See `TopicModel
  // .findActiveVisitorRunTopics`'s JSDoc and
  // `shareResetInterrupt.ts`'s JSDoc for the full rationale.
  it('finds an already-running visitor operation after a SECOND transfer moves it again before the deferred sweep runs', async () => {
    const secondWsId = 'agent-share-group-transfer-race-ws-2';
    await serverDB.insert(workspaces).values([
      {
        id: secondWsId,
        name: 'Group Transfer Race WS 2',
        primaryOwnerId: ownerId,
        slug: 'agent-share-group-transfer-race-ws-2',
      },
    ]);

    await serverDB
      .insert(agents)
      .values([{ id: supervisorId, title: 'Supervisor', userId: ownerId, virtual: true }]);
    await serverDB.insert(chatGroups).values([{ id: groupId, title: 'Team', userId: ownerId }]);
    await serverDB.insert(chatGroupsAgents).values([
      {
        agentId: supervisorId,
        chatGroupId: groupId,
        order: -1,
        role: 'supervisor',
        userId: ownerId,
      },
    ]);

    const agentShareModel = new AgentShareModel(serverDB, ownerId);
    const share = await agentShareModel.create(supervisorId, 'link');

    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId: supervisorId, groupId, shareId: share.id, userId: visitorId })
      .returning();

    const operationId = 'op-group-double-transfer-race';
    await agentShareModel.assertRunnableForVisitor({
      agentId: supervisorId,
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

    // Transfer #1: personal -> workspace A. This is the ONLY transfer whose
    // `onShareReset` fires (it's the one that actually flips visibility to
    // `private`), so it's the only revocationGeneration/callback that will
    // ever exist for this run.
    let revocationGeneration: number | undefined;
    let onShareResetCallCount = 0;
    const firstTransferRepo = new AgentGroupRepository(serverDB, ownerId, undefined, {
      onShareReset: (_agentId, generation) => {
        onShareResetCallCount += 1;
        revocationGeneration = generation;
      },
    });
    await firstTransferRepo.transferToWorkspace(groupId, targetWsId, ownerId);
    expect(revocationGeneration).toBe(2);

    // Transfer #2: workspace A -> workspace B, BEFORE the deferred callback
    // from transfer #1 has run (this test drives the sweep manually below,
    // simulating that delay). Constructed scoped to workspace A, mirroring
    // an admin/owner acting from within A.
    const secondTransferRepo = new AgentGroupRepository(serverDB, ownerId, targetWsId, {
      onShareReset: () => {
        onShareResetCallCount += 1;
      },
    });
    await secondTransferRepo.transferToWorkspace(groupId, secondWsId, ownerId);

    // The second transfer must not have scheduled a callback of its own —
    // proving the ONE deferred sweep (still carrying transfer #1's
    // `revocationGeneration=2`) is the only thing that can ever catch this
    // run.
    expect(onShareResetCallCount).toBe(1);

    // The topic is now in workspace B, not A.
    const [movedTopic] = await serverDB
      .select({ workspaceId: topics.workspaceId })
      .from(topics)
      .where(eq(topics.id, topic.id));
    expect(movedTopic?.workspaceId).toBe(secondWsId);

    // Simulate the deferred callback finally running, still carrying
    // transfer #1's `revocationGeneration` — exactly like
    // `scheduleShareRunInterruptOnReset` -> `interruptActiveShareRuns`.
    const revoked = await agentShareModel.revokeReservations(supervisorId, revocationGeneration!);
    expect(revoked).toEqual([]); // already confirmed, nothing left to revoke

    const unscopedTopicModel = new TopicModel(serverDB, ownerId);
    const active = await unscopedTopicModel.findActiveVisitorRunTopics(
      supervisorId,
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
  });
});
