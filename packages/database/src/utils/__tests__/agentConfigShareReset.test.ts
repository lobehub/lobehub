// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { AgentShareModel } from '../../models/agentShare';
import { agents, agentShares, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { writeAgentConfigWithShareReset } from '../agentConfigShareReset';

// `packages/openapi/src/services/agent.service.ts`'s `updateAgent` (backing
// `PATCH /api/v1/agents/:id`) used to write `agents.model` /
// `agents.agencyConfig` directly with `tx.update(agents)`, bypassing
// `AgentModel.updateConfig` — and with it, the invariant that a `link` share
// must be reset to `private` when a config write turns the agent
// heterogeneous (Codex / Claude Code). That let the OpenAPI PATCH flip a
// published homogeneous agent to a heterogeneous model while its share
// stayed `link`: the owner's Share tab silently disappeared, and every
// visitor send kept failing as `ShareHeterogeneousAgentUnsupported`.
//
// The fix routes both `AgentModel.updateConfig` and the OpenAPI
// `AgentService.updateAgent` through this single `writeAgentConfigWithShareReset`
// choke point. This test drives the helper the same way the OpenAPI service
// calls it — a direct column write plus a `resultingConfig` snapshot, not a
// deep-merged `AgentItem` — against a real Postgres database, mirroring
// `agentShare.publish.race.test.ts` and the "publish gate" block in
// `agentShare.test.ts`.
const userId = 'agent-config-share-reset-user';
const agentId = 'agent-config-share-reset-agent';

const serverDB: LobeChatDatabase = await getTestDB();
const agentShareModel = new AgentShareModel(serverDB, userId);

const cleanup = async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
};

describe('writeAgentConfigWithShareReset (real Postgres)', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([{ id: userId }]);
    await serverDB
      .insert(agents)
      .values({ id: agentId, model: 'gpt-4o', title: 'Homogeneous Agent', userId });
  });

  afterAll(cleanup);

  it('resets a link share to private when an OpenAPI-style direct write turns the agent heterogeneous', async () => {
    await agentShareModel.create(agentId, 'link');

    // Mirrors `AgentService.updateAgent`: a plain column patch (not a
    // deep-merged `AgentItem`) computed from the request, with the same
    // `resultingConfig` / `touchesHeterogeneityFields` contract.
    await writeAgentConfigWithShareReset(serverDB, {
      agentId,
      resultingConfig: { agencyConfig: null, model: 'codex' },
      touchesHeterogeneityFields: true,
      updateData: { model: 'codex', updatedAt: new Date() },
      where: eq(agents.id, agentId),
    });

    const [persistedAgent] = await serverDB
      .select({ model: agents.model })
      .from(agents)
      .where(eq(agents.id, agentId));
    expect(persistedAgent.model).toBe('codex');

    const [persistedShare] = await serverDB
      .select({ visibility: agentShares.visibility })
      .from(agentShares)
      .where(eq(agentShares.agentId, agentId));
    expect(persistedShare.visibility).toBe('private');
  });

  it('leaves a link share untouched when the write does not touch model/agencyConfig', async () => {
    await agentShareModel.create(agentId, 'link');

    await writeAgentConfigWithShareReset(serverDB, {
      agentId,
      resultingConfig: { agencyConfig: null, model: 'gpt-4o' },
      touchesHeterogeneityFields: false,
      updateData: { title: 'Renamed Agent', updatedAt: new Date() },
      where: eq(agents.id, agentId),
    });

    const [persistedShare] = await serverDB
      .select({ visibility: agentShares.visibility })
      .from(agentShares)
      .where(eq(agentShares.agentId, agentId));
    expect(persistedShare.visibility).toBe('link');
  });

  it('invokes onShareReset with the agentId only when a link share actually flips to private', async () => {
    await agentShareModel.create(agentId, 'link');

    const onShareReset = vi.fn();

    // Regression test: this callback is the ONLY signal
    // `writeAgentConfigWithShareReset`'s callers (AgentModel, SessionModel,
    // the OpenAPI AgentService) have to schedule
    // `AiAgentService.interruptActiveShareRuns` for a visitor run that is
    // ALREADY IN FLIGHT when an owner's config edit (UI / Agent Builder /
    // OpenAPI) turns the agent heterogeneous mid-run. It must fire exactly
    // once, synchronously after the transaction commits, with the agentId —
    // never before commit (a rollback must not trigger it) and never for a
    // write that didn't actually change anything.
    await writeAgentConfigWithShareReset(serverDB, {
      agentId,
      onShareReset,
      resultingConfig: { agencyConfig: null, model: 'codex' },
      touchesHeterogeneityFields: true,
      updateData: { model: 'codex', updatedAt: new Date() },
      where: eq(agents.id, agentId),
    });

    expect(onShareReset).toHaveBeenCalledTimes(1);
    // Second argument is the post-bump generation counter (see
    // `bumpAgentShareGeneration`) — asserted loosely here since its exact
    // value depends on this agent's share history, not this test's intent.
    expect(onShareReset).toHaveBeenCalledWith(agentId, expect.any(Number));
  });

  it('does not invoke onShareReset when the write does not touch model/agencyConfig', async () => {
    await agentShareModel.create(agentId, 'link');

    const onShareReset = vi.fn();

    await writeAgentConfigWithShareReset(serverDB, {
      agentId,
      onShareReset,
      resultingConfig: { agencyConfig: null, model: 'gpt-4o' },
      touchesHeterogeneityFields: false,
      updateData: { title: 'Renamed Agent', updatedAt: new Date() },
      where: eq(agents.id, agentId),
    });

    expect(onShareReset).not.toHaveBeenCalled();
  });

  it('does not invoke onShareReset when the share was already private (no actual transition)', async () => {
    await agentShareModel.create(agentId, 'private');

    const onShareReset = vi.fn();

    // `mayNeedShareReset` (the write is heterogeneous) is only a possibility
    // check — it does not imply a row changed. Firing the callback here would
    // make a caller schedule a needless (though harmless) interrupt query for
    // every heterogeneous edit on a never-shared agent.
    await writeAgentConfigWithShareReset(serverDB, {
      agentId,
      onShareReset,
      resultingConfig: { agencyConfig: null, model: 'codex' },
      touchesHeterogeneityFields: true,
      updateData: { model: 'codex', updatedAt: new Date() },
      where: eq(agents.id, agentId),
    });

    expect(onShareReset).not.toHaveBeenCalled();
  });

  it('leaves a private share private when the write turns the agent heterogeneous', async () => {
    await agentShareModel.create(agentId, 'private');

    await writeAgentConfigWithShareReset(serverDB, {
      agentId,
      resultingConfig: { agencyConfig: null, model: 'codex' },
      touchesHeterogeneityFields: true,
      updateData: { model: 'codex', updatedAt: new Date() },
      where: eq(agents.id, agentId),
    });

    const [persistedShare] = await serverDB
      .select({ updatedAt: agentShares.updatedAt, visibility: agentShares.visibility })
      .from(agentShares)
      .where(eq(agentShares.agentId, agentId));
    expect(persistedShare.visibility).toBe('private');
  });
});

// Regression test for the "in-flight" scenario: a config write
// (web UI, Agent Builder, or the OpenAPI PATCH) turns an agent heterogeneous
// WHILE a visitor's operation is already running against the OLD config
// snapshot, under the creator's credentials. Before the fix,
// `writeAgentConfigWithShareReset` reset `agentShares.visibility` (blocking
// NEW visitor requests) but had no way to signal the transition to a caller,
// so the ALREADY-RUNNING operation kept going untouched — the visitor could
// no longer stop it either, since `shareChat.interruptTask` re-checks
// visibility and gets `FORBIDDEN` the instant the share flips.
//
// This test wires `onShareReset` the way a real caller (e.g.
// `scheduleShareRunInterruptOnReset`) would — synchronously clearing the
// topic's `runningOperation` marker — and asserts an in-flight run is
// actually cleaned up by the same config write that revokes it.
describe('writeAgentConfigWithShareReset — in-flight visitor run during a config transition (real Postgres)', () => {
  const inFlightAgentId = 'agent-config-share-reset-in-flight-agent';
  const visitorId = 'agent-config-share-reset-in-flight-visitor';

  const cleanupWithVisitor = async () => {
    await serverDB.delete(users).where(inArray(users.id, [userId, visitorId]));
  };

  beforeEach(async () => {
    await cleanupWithVisitor();
    // The visitor is a real user row: a share conversation belongs to THEM,
    // so the topic below cannot be inserted without one.
    await serverDB.insert(users).values([{ id: userId }, { id: visitorId }]);
    await serverDB
      .insert(agents)
      .values({ id: inFlightAgentId, model: 'gpt-4o', title: 'In-Flight Agent', userId });
  });

  afterAll(cleanupWithVisitor);

  it('clears the in-flight operation marker via onShareReset when the config write revokes the share', async () => {
    const share = await agentShareModel.create(inFlightAgentId, 'link');

    // The visitor's own topic, linked back to the share only by `shareId` —
    // the reset sweep has to reach it across ownership, keying on `agentId`.
    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId: inFlightAgentId, shareId: share.id, userId: visitorId })
      .returning();

    // Simulate a visitor run already in flight, mirroring what
    // `execAgentWithReservation` writes once an operation is created.
    await serverDB
      .update(topics)
      .set({
        metadata: {
          runningOperation: {
            assistantMessageId: 'in-flight-message',
            operationId: 'in-flight-operation',
            startedAt: new Date().toISOString(),
          },
        } as any,
      })
      .where(eq(topics.id, topic.id));

    // Mirrors `scheduleShareRunInterruptOnReset`: it is called SYNCHRONOUSLY
    // (matching `onShareReset`'s contract — `writeAgentConfigWithShareReset`
    // does not await it, mirroring how `after()` only schedules work rather
    // than blocking the write) but itself only schedules async work. The
    // test captures that work's promise and awaits it explicitly, since
    // there is no real `after()`/response lifecycle to wait on here.
    let interruptedOperationId: string | undefined;
    let scheduledWork: Promise<void> | undefined;
    const onShareReset = vi.fn(() => {
      scheduledWork = (async () => {
        const [row] = await serverDB
          .select({ metadata: topics.metadata })
          .from(topics)
          .where(eq(topics.id, topic.id));
        interruptedOperationId = (row?.metadata as any)?.runningOperation?.operationId;

        await serverDB
          .update(topics)
          .set({ metadata: { runningOperation: null } as any })
          .where(eq(topics.id, topic.id));
      })();
    });

    await writeAgentConfigWithShareReset(serverDB, {
      agentId: inFlightAgentId,
      onShareReset,
      resultingConfig: { agencyConfig: null, model: 'codex' },
      touchesHeterogeneityFields: true,
      updateData: { model: 'codex', updatedAt: new Date() },
      where: eq(agents.id, inFlightAgentId),
    });
    await scheduledWork;

    expect(onShareReset).toHaveBeenCalledTimes(1);
    expect(interruptedOperationId).toBe('in-flight-operation');

    const [persistedTopic] = await serverDB
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(eq(topics.id, topic.id));
    expect((persistedTopic.metadata as any)?.runningOperation).toBeNull();
  });
});
