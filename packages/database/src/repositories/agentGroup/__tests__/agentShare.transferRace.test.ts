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

// Real-Postgres reproduction of the Codex P1's group-transfer equivalent at
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
  await serverDB.insert(users).values([{ id: ownerId }]);
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
    await agentShareModel.create(supervisorId, 'link');

    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId: supervisorId, senderId: visitorId, userId: ownerId })
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

    // `revokeReservations` only flags the row (`revokedAt`), it does not
    // delete it — mirrors `startVisitorRun`'s own cleanup in the
    // single-agent version of this test (`releaseReservation` on a rejected
    // confirm), which this test skips since it drives `confirmReservation`
    // directly instead of through that helper.
    const [revokedReservation] = await serverDB
      .select({ revokedAt: agentShareRunReservations.revokedAt })
      .from(agentShareRunReservations)
      .where(eq(agentShareRunReservations.id, operationId));
    expect(revokedReservation?.revokedAt).toBeTruthy();

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
    await agentShareModel.create(supervisorId, 'link');

    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId: supervisorId, groupId, senderId: visitorId, userId: ownerId })
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

    // Scoped to the TARGET workspace, mirroring what
    // `scheduleShareRunInterruptOnReset`'s `targetWorkspaceId` param makes
    // production do post-transfer — a personal-scoped re-query would miss
    // this topic now that the transfer has moved it.
    const targetScopedTopicModel = new TopicModel(serverDB, ownerId, targetWsId);
    const active = await targetScopedTopicModel.findActiveVisitorRunTopics(
      supervisorId,
      revocationGeneration!,
    );
    expect(active).toEqual([{ operationId, topicId: topic.id }]);
  });
});
