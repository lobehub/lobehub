// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, topics, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { AgentShareModel } from '@/database/models/agentShare';

import {
  reserveShareVisitorTopicOrThrow,
  reserveShareVisitorTurnOrThrow,
} from '../shareVisitorAbuseGuards';

// Real-Postgres reproduction of the Codex P2 on
// `apps/server/src/services/aiAgent/shareVisitorAbuseGuards.ts:71`:
//
// The EARLIER stale-cap fix (see `shareVisitorAbuseGuards.staleCapSnapshot.race.test.ts`)
// made these guards re-read `maxTopicsPerVisitor` / `maxTurnsPerTopic` fresh
// from inside their own `pg_advisory_xact_lock`-guarded transaction, instead
// of trusting a caller-supplied snapshot. That closed the "stale config
// carried across the whole request" gap, but the advisory lock it read under
// was DISJOINT from the `agents.id FOR UPDATE` lock `AgentShareModel.updateConfig`
// takes: nothing serialized "read the cap" against "the owner's cap-lowering
// write lands". A concurrent `updateConfig` reduction could still commit
// strictly BETWEEN this function's cap read and its INSERT — read-before-update,
// insert-after-update — leaving one extra topic/turn over the NEW cap even
// though the read itself was "fresh" at the instant it ran.
//
// The fix replaces that advisory lock with `AgentShareModel.lockOwnedAgentRow`,
// the SAME `agents.id FOR UPDATE` row `updateConfig` locks before writing.
// These tests force the exact interleaving Codex named: pause a guard
// transaction AFTER it has taken the lock and read the cap, but BEFORE its
// INSERT commits, then fire a concurrent `updateConfig` cap reduction and
// prove it BLOCKS until the guard's transaction commits — i.e. the reduction
// can no longer land inside that window at all, not merely "the read happens
// to already be fresh".

const ownerId = 'agent-share-row-lock-ordering-owner';
const visitorId = 'agent-share-row-lock-ordering-visitor';

const serverDB: LobeChatDatabase = await getTestDB();
const agentShareModel = new AgentShareModel(serverDB, ownerId);

const cleanup = async () => {
  await serverDB.delete(users).where(eq(users.id, ownerId));
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('reserveShareVisitorTopicOrThrow / reserveShareVisitorTurnOrThrow — row-lock ordering vs concurrent updateConfig (real Postgres)', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([{ id: ownerId }]);
  });

  afterAll(cleanup);

  it('blocks a concurrent maxTopicsPerVisitor reduction until the in-flight reservation commits, and the NEW cap applies to the very next request', async () => {
    const agentId = 'row-lock-ordering-topic';
    await serverDB
      .insert(agents)
      .values({ id: agentId, model: 'gpt-4o', title: 'Row Lock Ordering Topic', userId: ownerId });

    await agentShareModel.create(agentId, 'link');
    await agentShareModel.updateConfig(agentId, { maxTopicsPerVisitor: 50 });

    const DELAY_MS = 400;
    const timestamps: { insertCommitted?: number; updateConfigCommitted?: number } = {};

    // Guard call A: reads the (still 50) cap, then artificially holds the
    // Agent row lock open for DELAY_MS before actually inserting — the exact
    // window Codex's ordering targets. `create` is the caller-supplied hook
    // that runs INSIDE the guard's own locked transaction, so the delay here
    // genuinely happens with the row lock held, not after it is released.
    const reservationA = reserveShareVisitorTopicOrThrow({
      agentId,
      expectedGeneration: 1,
      create: async (topicModel, shareId) => {
        await sleep(DELAY_MS);
        const created = await topicModel.create({
          agentId,
          senderId: visitorId,
          shareId,
          title: 'topic-a',
        });
        timestamps.insertCommitted = Date.now();
        return created;
      },
      db: serverDB,
      ownerId,
      visitorUserId: visitorId,
    });

    // Give reservationA a head start so it has definitely taken the row lock
    // and read the cap before updateConfig is even issued.
    await sleep(50);

    const updateConfigStartedAt = Date.now();
    await agentShareModel.updateConfig(agentId, { maxTopicsPerVisitor: 1 });
    timestamps.updateConfigCommitted = Date.now();

    await reservationA;

    // The whole point of taking the SAME row lock: updateConfig cannot
    // acquire it until reservationA's transaction commits, so its own
    // duration must cover (most of) reservationA's artificial delay. A
    // generous tolerance keeps this robust against scheduler jitter while
    // still failing if updateConfig raced ahead of the insert (the bug).
    expect(timestamps.updateConfigCommitted! - updateConfigStartedAt).toBeGreaterThanOrEqual(
      DELAY_MS - 100,
    );
    // And updateConfig must never have completed BEFORE the insert it was
    // racing against — that would mean the reduction landed inside the
    // read-then-insert window instead of strictly after it.
    expect(timestamps.updateConfigCommitted!).toBeGreaterThanOrEqual(timestamps.insertCommitted!);

    // reservationA correctly inserted under the cap (50) it validly observed
    // before updateConfig's reduction could commit.
    const insertedTopics = await serverDB
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.agentId, agentId));
    expect(insertedTopics.length).toBe(1);

    // The NEW cap (1) is now in effect and immediately enforced — a fresh
    // request right after must be rejected, since one topic already exists.
    await expect(
      reserveShareVisitorTopicOrThrow({
        agentId,
        expectedGeneration: 1,
        create: (topicModel, shareId) =>
          topicModel.create({ agentId, senderId: visitorId, shareId, title: 'topic-b' }),
        db: serverDB,
        ownerId,
        visitorUserId: visitorId,
      }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  }, 15_000);

  it('blocks a concurrent maxTurnsPerTopic reduction until the in-flight reservation commits, and the NEW cap applies to the very next request', async () => {
    const agentId = 'row-lock-ordering-turn';
    await serverDB
      .insert(agents)
      .values({ id: agentId, model: 'gpt-4o', title: 'Row Lock Ordering Turn', userId: ownerId });

    await agentShareModel.create(agentId, 'link');
    await agentShareModel.updateConfig(agentId, { maxTurnsPerTopic: 50 });

    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId, senderId: visitorId, userId: ownerId })
      .returning();

    const DELAY_MS = 400;
    const timestamps: { insertCommitted?: number; updateConfigCommitted?: number } = {};

    const reservationA = reserveShareVisitorTurnOrThrow({
      agentId,
      expectedGeneration: 1,
      create: async (messageModel) => {
        await sleep(DELAY_MS);
        const created = await messageModel.create({
          agentId,
          content: 'turn-a',
          role: 'user',
          topicId: topic.id,
        });
        timestamps.insertCommitted = Date.now();
        return created;
      },
      db: serverDB,
      ownerId,
      topicId: topic.id,
    });

    await sleep(50);

    const updateConfigStartedAt = Date.now();
    await agentShareModel.updateConfig(agentId, { maxTurnsPerTopic: 1 });
    timestamps.updateConfigCommitted = Date.now();

    await reservationA;

    expect(timestamps.updateConfigCommitted! - updateConfigStartedAt).toBeGreaterThanOrEqual(
      DELAY_MS - 100,
    );
    expect(timestamps.updateConfigCommitted!).toBeGreaterThanOrEqual(timestamps.insertCommitted!);

    await expect(
      reserveShareVisitorTurnOrThrow({
        agentId,
        expectedGeneration: 1,
        create: (messageModel) =>
          messageModel.create({ agentId, content: 'turn-b', role: 'user', topicId: topic.id }),
        db: serverDB,
        ownerId,
        topicId: topic.id,
      }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  }, 15_000);
});
