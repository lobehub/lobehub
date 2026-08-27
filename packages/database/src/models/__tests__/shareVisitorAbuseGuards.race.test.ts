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

// Real-Postgres reproduction of the agent-share visitor abuse-cap race
// described in LOBE-11930 (Codex P1 on `shareChat.ts:129`).
//
// Before the fix, `shareChat.execAgent` counted a visitor's existing topics
// (or turns) and compared against the cap BEFORE dispatching to
// `AiAgentService.execAgent`, which performs the real INSERT much later —
// two unrelated, unlocked statements with nothing serializing them. A burst
// of concurrent requests from the same visitor could all read the same
// pre-insert count and all insert, exceeding `maxTopicsPerVisitor` /
// `maxTurnsPerTopic` by an arbitrary amount.
//
// `reserveShareVisitorTopicOrThrow` / `reserveShareVisitorTurnOrThrow`
// (`apps/server/src/services/aiAgent/shareVisitorAbuseGuards.ts`) close this
// by taking a `pg_advisory_xact_lock` and re-checking the exact same counter
// INSIDE the same transaction as the INSERT, immediately before it runs.
//
// Under the client-db PGlite engine, concurrent transactions serialize on the
// single session, so this passes trivially there; against a REAL
// node-postgres pool (`TEST_SERVER_DB=1`, separate connections → genuine
// interleave — see `packages/database/package.json`'s `test:server-db`
// script) it guards the advisory lock: every trial must cap the successful
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
    const TRIALS = 10;
    const CONCURRENCY = 6;
    const CAP = 3;
    let overCapTrials = 0;

    for (let i = 0; i < TRIALS; i++) {
      const agentId = `share-topic-race-agent-${i}`;
      await serverDB.insert(agents).values({ id: agentId, model: 'gpt-4o', userId: ownerId });
      // The cap is read fresh from the real `agentShares.shareConfig` inside
      // the guard's own locked transaction (`AgentShareModel
      // .readCurrentVisitorCaps`) — no longer a caller-supplied parameter.
      await new AgentShareModel(serverDB, ownerId).create(agentId, 'link');
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
              expectedGeneration: 1,
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

      // The reservation's own return value and the real row count must agree
      // — a lost race would show up as more rows than reservations reported,
      // or vice versa.
      if (fulfilled !== CAP || actualTopicCount !== CAP) overCapTrials++;
    }

    console.log(`[share topic cap race] cap violated in ${overCapTrials}/${TRIALS} trials`);

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
    const TRIALS = 10;
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
        shareId: share.id,
        userId: ownerId,
      });

      // Simulate CONCURRENCY sends to the SAME existing topic at the same time.
      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENCY }, (_, n) =>
          reserveShareVisitorTurn(
            { agentId, db: serverDB, expectedGeneration: 1, ownerId, topicId },
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

    console.log(`[share turn cap race] cap violated in ${overCapTrials}/${TRIALS} trials`);

    expect(overCapTrials).toBe(0);
  });
});
