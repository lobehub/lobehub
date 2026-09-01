import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  reserveShareVisitorTopic,
  reserveShareVisitorTurn,
} from '@/server/services/aiAgent/shareVisitorAbuseGuards';

import { getTestDB } from '../../core/getTestDB';
import { agents, messages, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentShareModel } from '../agentShare';

// Real-Postgres reproduction of the agent-share visitor abuse-cap race.
//
// `shareChat.execAgent` counts a visitor's existing topics (or turns) and
// compares against the cap BEFORE dispatching to `AiAgentService.execAgent`,
// which performs the real INSERT much later — two unrelated, unlocked
// statements with nothing serializing them. A burst of concurrent requests
// from the same visitor could all read the same pre-insert count and all
// insert, exceeding `maxTopicsPerVisitor` / `maxTurnsPerTopic` by an arbitrary
// amount.
//
// `reserveShareVisitorTopicOrThrow` / `reserveShareVisitorTurnOrThrow`
// (`apps/server/src/services/aiAgent/shareVisitorAbuseGuards.ts`) close this by
// taking the SAME `agents.id FOR UPDATE` row lock every share-mutation path
// takes and re-checking the exact same counter INSIDE the same transaction as
// the INSERT, immediately before it runs.
//
// Under the client-db PGlite engine, concurrent transactions serialize on the
// single session, so the cap assertions pass trivially there; against a REAL
// node-postgres pool (`TEST_SERVER_DB=1`, separate connections → genuine
// interleave) they guard the row lock: every trial must cap the successful
// count at exactly the configured limit, never more.

const ownerId = 'share-abuse-guard-race-owner';
const visitorUserId = 'share-abuse-guard-race-visitor';
const serverDB: LobeChatDatabase = await getTestDB();

const cleanup = async () => {
  await serverDB.delete(messages).where(eq(messages.userId, ownerId));
  await serverDB.delete(topics).where(eq(topics.userId, ownerId));
  await serverDB.delete(agents).where(eq(agents.userId, ownerId));
  await serverDB.delete(users).where(eq(users.id, ownerId));
};

describe('reserveShareVisitorTopicOrThrow — visitor topic cap race (real Postgres)', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([{ id: ownerId }]);
  });

  afterAll(cleanup);

  it('never lets concurrent new-topic requests exceed maxTopicsPerVisitor', async () => {
    const TRIALS = 5;
    const CONCURRENCY = 6;
    const CAP = 3;
    let overCapTrials = 0;

    for (let i = 0; i < TRIALS; i++) {
      const agentId = `share-topic-race-agent-${i}`;
      await serverDB.insert(agents).values({ id: agentId, model: 'gpt-4o', userId: ownerId });
      // The cap is read fresh from the real `agentShares.shareConfig` inside
      // the guard's own locked transaction (`AgentShareModel
      // .readCurrentVisitorCaps`) — never a caller-supplied parameter.
      const share = await new AgentShareModel(serverDB, ownerId).create(agentId, 'link');
      await new AgentShareModel(serverDB, ownerId).updateConfig(agentId, {
        maxTopicsPerVisitor: CAP,
      });

      // Simulate CONCURRENCY visitor tabs/scripts all sending a first message
      // to a brand-new topic at the same time.
      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENCY }, (_, n) =>
          reserveShareVisitorTopic(
            {
              agentId,
              db: serverDB,
              expectedShareId: share.id,
              ownerId,
              visitorUserId,
            },
            { agentId, senderId: visitorUserId, title: `visitor topic ${n}`, trigger: 'chat' },
          ),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
      const rejected = results.filter((r) => r.status === 'rejected').length;
      expect(fulfilled + rejected).toBe(CONCURRENCY);

      const [{ value: actualTopicCount }] = await serverDB
        .select({ value: count(topics.id) })
        .from(topics)
        .where(and(eq(topics.agentId, agentId), eq(topics.senderId, visitorUserId)));

      // The reservation's own return value and the real row count must agree —
      // a lost race would show up as more rows than reservations reported, or
      // vice versa.
      if (fulfilled !== CAP || actualTopicCount !== CAP) overCapTrials++;
    }

    expect(overCapTrials).toBe(0);
  });
});

describe('reserveShareVisitorTurnOrThrow — visitor turn cap race (real Postgres)', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([{ id: ownerId }]);
  });

  afterAll(cleanup);

  it('never lets concurrent sends to the same topic exceed maxTurnsPerTopic', async () => {
    const TRIALS = 5;
    const CONCURRENCY = 6;
    const CAP = 3;
    let overCapTrials = 0;

    for (let i = 0; i < TRIALS; i++) {
      const agentId = `share-turn-race-agent-${i}`;
      const topicId = `share-turn-race-topic-${i}`;
      await serverDB.insert(agents).values({ id: agentId, model: 'gpt-4o', userId: ownerId });
      const share = await new AgentShareModel(serverDB, ownerId).create(agentId, 'link');
      await new AgentShareModel(serverDB, ownerId).updateConfig(agentId, {
        maxTurnsPerTopic: CAP,
      });
      await serverDB.insert(topics).values({
        agentId,
        id: topicId,
        senderId: visitorUserId,
        userId: ownerId,
      });

      // Simulate CONCURRENCY sends to the SAME existing topic at the same time.
      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENCY }, (_, n) =>
          reserveShareVisitorTurn(
            { agentId, db: serverDB, expectedShareId: share.id, ownerId, topicId },
            { content: `turn ${n}`, role: 'user', topicId },
          ),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
      const rejected = results.filter((r) => r.status === 'rejected').length;
      expect(fulfilled + rejected).toBe(CONCURRENCY);

      const [{ value: actualTurnCount }] = await serverDB
        .select({ value: count(messages.id) })
        .from(messages)
        .where(and(eq(messages.topicId, topicId), eq(messages.role, 'user')));

      if (fulfilled !== CAP || actualTurnCount !== CAP) overCapTrials++;
    }

    expect(overCapTrials).toBe(0);
  });
});

// Adapted from the old design's `staleAuthorization` race: the revocation
// token is the `agentShares.id` itself rather than a separate generation
// counter. Turning sharing off only flips the row to `private` (the visibility
// check covers that), while a hard delete replaces the instance outright (the
// id check covers that). `assertShareStillAuthorized` fails closed on a
// missing row, a non-`link` visibility, OR an id mismatch — all three checked
// inside the guard's own locked transaction, BEFORE any row is written.
describe('shareVisitorAbuseGuards — revoked share authorization', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([{ id: ownerId }]);
  });

  afterAll(cleanup);

  it('rejects a new-topic reservation once the owner made the link private, and inserts nothing', async () => {
    const agentId = 'revoked-share-topic-private';
    await serverDB.insert(agents).values({ id: agentId, model: 'gpt-4o', userId: ownerId });
    const shareModel = new AgentShareModel(serverDB, ownerId);
    const share = await shareModel.create(agentId, 'link');

    // Owner revokes access while the visitor's request is still resolving.
    await shareModel.updateVisibility(agentId, 'private');

    await expect(
      reserveShareVisitorTopic(
        { agentId, db: serverDB, expectedShareId: share.id, ownerId, visitorUserId },
        { agentId, senderId: visitorUserId, title: 'stale-topic' },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const inserted = await serverDB
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.agentId, agentId));
    expect(inserted.length).toBe(0);
  });

  it('rejects a reservation stamped with a superseded share instance', async () => {
    const agentId = 'revoked-share-topic-replaced';
    await serverDB.insert(agents).values({ id: agentId, model: 'gpt-4o', userId: ownerId });
    const shareModel = new AgentShareModel(serverDB, ownerId);
    const staleShare = await shareModel.create(agentId, 'link');

    // Turning sharing off only pauses it (visibility flip), so the id survives
    // that cycle. A HARD delete is what replaces the instance: the new row is
    // ALSO `link`, so a bare visibility check would pass here — only the id
    // comparison catches it.
    await shareModel.deleteByAgentId(agentId);
    const freshShare = await shareModel.create(agentId, 'link');
    expect(freshShare.id).not.toBe(staleShare.id);

    await expect(
      reserveShareVisitorTopic(
        { agentId, db: serverDB, expectedShareId: staleShare.id, ownerId, visitorUserId },
        { agentId, senderId: visitorUserId, title: 'stale-instance-topic' },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const inserted = await serverDB
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.agentId, agentId));
    expect(inserted.length).toBe(0);
  });

  it('rejects a turn reservation once the owner made the link private, and inserts no message', async () => {
    const agentId = 'revoked-share-turn-private';
    await serverDB.insert(agents).values({ id: agentId, model: 'gpt-4o', userId: ownerId });
    const shareModel = new AgentShareModel(serverDB, ownerId);
    const share = await shareModel.create(agentId, 'link');

    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId, senderId: visitorUserId, userId: ownerId })
      .returning();

    await shareModel.updateVisibility(agentId, 'private');

    await expect(
      reserveShareVisitorTurn(
        { agentId, db: serverDB, expectedShareId: share.id, ownerId, topicId: topic.id },
        { content: 'stale-turn', role: 'user', topicId: topic.id },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const inserted = await serverDB
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.topicId, topic.id));
    expect(inserted.length).toBe(0);
  });
});
