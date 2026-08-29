// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, topics, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { AgentShareModel } from '@/database/models/agentShare';

import {
  reserveShareVisitorTopicOrThrow,
  reserveShareVisitorTurnOrThrow,
} from '../shareVisitorAbuseGuards';

// Real-Postgres reproduction of the stale-cap-snapshot race on
// `packages/database/src/models/agentShare.ts:113`:
//
// `shareChat.ts`'s `execAgent` resolves `shareConfig` (and therefore
// `maxTopicsPerVisitor` / `maxTurnsPerTopic`) exactly ONCE, at
// `findByShareIdWithAccessCheck`, long before `AiAgentService` reaches
// `reserveShareVisitorTopicOrThrow` / `reserveShareVisitorTurnOrThrow` — real
// agent-config/tool/knowledge-base resolution happens in between. The OLD
// implementation threaded that snapshot straight into these guard functions
// as their authoritative cap, so a concurrent flood of requests that already
// read the OLD (higher) cap would keep inserting against it even after the
// owner lowered the cap: the advisory-locked recount only ever enforced
// whatever number it was TOLD, not the number currently configured.
//
// The fix makes these guard functions read `maxTopicsPerVisitor` /
// `maxTurnsPerTopic` fresh, from inside their own locked transaction
// (`AgentShareModel.readCurrentVisitorCaps`), instead of accepting them as a
// parameter at all. These tests fire concurrent reservation attempts AFTER
// lowering the cap and assert the NEW cap wins, never the higher one that was
// true when the share was first read.

const ownerId = 'agent-share-stale-cap-owner';
const visitorId = 'agent-share-stale-cap-visitor';

const serverDB: LobeChatDatabase = await getTestDB();
const agentShareModel = new AgentShareModel(serverDB, ownerId);

const cleanup = async () => {
  await serverDB.delete(users).where(inArray(users.id, [ownerId, visitorId]));
};

describe('reserveShareVisitorTopicOrThrow / reserveShareVisitorTurnOrThrow — stale cap snapshot (real Postgres)', () => {
  beforeEach(async () => {
    await cleanup();
    // The visitor is a real user row now: a share conversation is THEIR
    // topic, so it cannot be inserted without one.
    await serverDB.insert(users).values([{ id: ownerId }, { id: visitorId }]);
  });

  afterAll(cleanup);

  it('enforces a LOWERED maxTopicsPerVisitor against a flood that started under the old, higher cap', async () => {
    const agentId = 'stale-cap-topic-flood';
    await serverDB
      .insert(agents)
      .values({ id: agentId, model: 'gpt-4o', title: 'Stale Cap Topic Flood', userId: ownerId });

    // Owner starts generous: 50 topics per visitor.
    await agentShareModel.create(agentId, 'link');
    await agentShareModel.updateConfig(agentId, { maxTopicsPerVisitor: 50 });

    // A batch of visitor requests would have read this generous config at
    // `findByShareIdWithAccessCheck` time — simulated here by simply NOT
    // passing any cap to the guard function (its signature no longer accepts
    // one), matching the fixed call sites in `AiAgentService.execAgent`.

    // Owner reacts to abuse mid-flood, dropping the cap to 1.
    await agentShareModel.updateConfig(agentId, { maxTopicsPerVisitor: 1 });

    // Fire a burst of concurrent "new topic" requests, as if they were all
    // already past the stale config read and only now reaching the locked
    // reservation.
    const CONCURRENT_REQUESTS = 5;
    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENT_REQUESTS }, (_, i) =>
        reserveShareVisitorTopicOrThrow({
          agentId,
          create: (topicModel, shareId) =>
            topicModel.create({ agentId, shareId, title: `topic-${i}` }),
          db: serverDB,
          ownerId,
          visitorUserId: visitorId,
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // The CURRENT cap (1) must win, not the 50 that was true when the share
    // was first resolved.
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(CONCURRENT_REQUESTS - 1);

    // Cross-check against the actual row count, not just the promise outcomes.
    const insertedTopics = await serverDB
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.agentId, agentId));
    expect(insertedTopics.length).toBe(1);
  });

  it('enforces a LOWERED maxTurnsPerTopic against a flood that started under the old, higher cap', async () => {
    const agentId = 'stale-cap-turn-flood';
    await serverDB
      .insert(agents)
      .values({ id: agentId, model: 'gpt-4o', title: 'Stale Cap Turn Flood', userId: ownerId });

    await agentShareModel.create(agentId, 'link');
    await agentShareModel.updateConfig(agentId, { maxTurnsPerTopic: 50 });

    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId, shareId: '00000000-0000-4000-8000-000000000001', userId: visitorId })
      .returning();

    // Owner reacts to abuse mid-flood, dropping the per-topic turn cap to 1.
    await agentShareModel.updateConfig(agentId, { maxTurnsPerTopic: 1 });

    const CONCURRENT_REQUESTS = 5;
    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENT_REQUESTS }, (_, i) =>
        reserveShareVisitorTurnOrThrow({
          agentId,
          create: (messageModel) =>
            messageModel.create({
              agentId,
              content: `turn-${i}`,
              role: 'user',
              topicId: topic.id,
            }),
          db: serverDB,
          ownerId,
          topicId: topic.id,
          visitorUserId: visitorId,
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(CONCURRENT_REQUESTS - 1);
  });

  it('readCurrentVisitorCaps reflects a config update immediately, never an earlier read', async () => {
    const agentId = 'stale-cap-fresh-read';
    await serverDB
      .insert(agents)
      .values({ id: agentId, model: 'gpt-4o', title: 'Stale Cap Fresh Read', userId: ownerId });
    await agentShareModel.create(agentId, 'link');

    const initial = await AgentShareModel.readCurrentVisitorCaps(serverDB, agentId);
    expect(initial).toEqual({
      maxTopicsPerVisitor: 5,
      maxTurnsPerTopic: 20,
      shareId: expect.any(String),
    });

    await agentShareModel.updateConfig(agentId, { maxTopicsPerVisitor: 1, maxTurnsPerTopic: 2 });

    const afterLowering = await AgentShareModel.readCurrentVisitorCaps(serverDB, agentId);
    expect(afterLowering).toEqual({
      maxTopicsPerVisitor: 1,
      maxTurnsPerTopic: 2,
      shareId: initial.shareId,
    });

    // Raising is symmetric — no special handling needed, just reflected.
    await agentShareModel.updateConfig(agentId, { maxTopicsPerVisitor: 99 });
    const afterRaising = await AgentShareModel.readCurrentVisitorCaps(serverDB, agentId);
    expect(afterRaising.maxTopicsPerVisitor).toBe(99);
  });
});
