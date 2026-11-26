import { ChatErrorType } from '@lobechat/types';
import { and, count, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  reserveShareVisitorTopic,
  reserveShareVisitorTurn,
} from '@/server/services/aiAgent/shareVisitorAbuseGuards';

import { getTestDB } from '../../core/getTestDB';
import { agents, agentShares, messages, topics, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentShareModel } from '../agentShare';

// Real-Postgres reproduction of the agent-share visitor message-cap race.
//
// `shareChat.execAgent` counts a visitor's user messages and compares against
// `maxMessagesPerVisitor` BEFORE dispatching to `AiAgentService.execAgent`,
// which performs the real INSERT much later — two unrelated, unlocked
// statements with nothing serializing them. A burst of concurrent requests from
// the same visitor could all read the same pre-insert count and all insert,
// exceeding the cap by an arbitrary amount.
//
// `reserveShareVisitorTurnOrThrow`
// (`apps/server/src/services/aiAgent/shareVisitorAbuseGuards.ts`) closes this by
// taking the SAME `agents.id FOR UPDATE` row lock every share-mutation path
// takes and re-counting INSIDE the same transaction as the INSERT, immediately
// before it runs.
//
// Under the client-db PGlite engine, concurrent transactions serialize on the
// single session, so the cap assertions pass trivially there; against a REAL
// node-postgres pool (`TEST_SERVER_DB=1`, separate connections → genuine
// interleave) they guard the row lock: every trial must cap the successful
// count at exactly the configured limit, never more.

const ownerId = 'share-abuse-guard-race-owner';
const visitorUserId = 'share-abuse-guard-race-visitor';
const workspaceId = 'share-abuse-guard-race-workspace';
const otherWorkspaceId = 'share-abuse-guard-race-other-workspace';
const serverDB: LobeChatDatabase = await getTestDB();

const cleanup = async () => {
  await serverDB.delete(messages).where(eq(messages.userId, ownerId));
  await serverDB.delete(topics).where(eq(topics.userId, ownerId));
  await serverDB.delete(agents).where(eq(agents.userId, ownerId));
  await serverDB.delete(users).where(eq(users.id, ownerId));
};

describe('reserveShareVisitorTurnOrThrow — visitor message cap (real Postgres)', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([{ id: ownerId }]);
  });

  afterAll(cleanup);

  it('never lets concurrent sends across topics exceed maxMessagesPerVisitor', async () => {
    const TRIALS = 5;
    const CONCURRENCY = 6;
    const CAP = 4;
    let overCapTrials = 0;

    for (let i = 0; i < TRIALS; i++) {
      const agentId = `share-message-race-agent-${i}`;
      const topicIds = [`share-message-race-topic-${i}-a`, `share-message-race-topic-${i}-b`];
      await serverDB.insert(agents).values({ id: agentId, model: 'gpt-4o', userId: ownerId });
      // The cap is read fresh from the real `agentShares.shareConfig` inside
      // the guard's own locked transaction (`AgentShareModel
      // .readCurrentVisitorCaps`) — never a caller-supplied parameter.
      const share = await new AgentShareModel(serverDB, ownerId).create(agentId, 'link');
      await new AgentShareModel(serverDB, ownerId).updateConfig(agentId, {
        maxMessagesPerVisitor: CAP,
      });
      await serverDB
        .insert(topics)
        .values(topicIds.map((id) => ({ agentId, id, senderId: visitorUserId, userId: ownerId })));
      // One earlier message and the Agent's reply: only the user message counts.
      await serverDB.insert(messages).values([
        {
          content: 'earlier',
          id: `earlier-${i}`,
          role: 'user',
          topicId: topicIds[0],
          userId: ownerId,
        },
        {
          content: 'reply',
          id: `reply-${i}`,
          role: 'assistant',
          topicId: topicIds[0],
          userId: ownerId,
        },
      ]);

      // Simulate CONCURRENCY sends from the same visitor, spread over two topics.
      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENCY }, (_, n) => {
          const topicId = topicIds[n % 2];
          return reserveShareVisitorTurn(
            { agentId, db: serverDB, expectedShareId: share.id, ownerId, visitorUserId },
            { content: `message ${n}`, role: 'user', topicId },
          );
        }),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled + rejected.length).toBe(CONCURRENCY);
      for (const r of rejected) {
        expect((r as PromiseRejectedResult).reason).toMatchObject({
          code: 'TOO_MANY_REQUESTS',
          message: ChatErrorType.ShareMessageLimitExceeded,
        });
      }

      const [{ value: actualUserMessages }] = await serverDB
        .select({ value: count(messages.id) })
        .from(messages)
        .where(and(inArray(messages.topicId, topicIds), eq(messages.role, 'user')));

      // The earlier message uses one slot, so CAP - 1 sends fit.
      if (fulfilled !== CAP - 1 || actualUserMessages !== CAP) overCapTrials++;
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

  it('derives workspace scope from the Agent when the share row has no workspaceId', async () => {
    const agentId = 'workspace-share-guard-scope';
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Workspace share guard scope',
      primaryOwnerId: ownerId,
      slug: 'workspace-share-guard-scope',
    });
    await serverDB.insert(agents).values({
      id: agentId,
      model: 'gpt-4o',
      userId: ownerId,
      workspaceId,
    });
    const [share] = await serverDB
      .insert(agentShares)
      .values({ agentId, visibility: 'link' })
      .returning();

    await expect(
      reserveShareVisitorTopic(
        {
          agentId,
          db: serverDB,
          expectedShareId: share.id,
          ownerId,
          workspaceId,
        },
        { agentId, senderId: visitorUserId, title: 'workspace-scoped topic' },
      ),
    ).resolves.toMatchObject({ agentId, workspaceId });

    await expect(
      reserveShareVisitorTopic(
        {
          agentId,
          db: serverDB,
          expectedShareId: share.id,
          ownerId,
          workspaceId: otherWorkspaceId,
        },
        { agentId, senderId: visitorUserId, title: 'wrong-workspace topic' },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const inserted = await serverDB
      .select({ title: topics.title })
      .from(topics)
      .where(eq(topics.agentId, agentId));
    expect(inserted).toEqual([{ title: 'workspace-scoped topic' }]);
  });

  it('rejects a new-topic reservation once the owner made the link private, and inserts nothing', async () => {
    const agentId = 'revoked-share-topic-private';
    await serverDB.insert(agents).values({ id: agentId, model: 'gpt-4o', userId: ownerId });
    const shareModel = new AgentShareModel(serverDB, ownerId);
    const share = await shareModel.create(agentId, 'link');

    // Owner revokes access while the visitor's request is still resolving.
    await shareModel.updateVisibility(agentId, 'private');

    await expect(
      reserveShareVisitorTopic(
        { agentId, db: serverDB, expectedShareId: share.id, ownerId },
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
        { agentId, db: serverDB, expectedShareId: staleShare.id, ownerId },
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
        { agentId, db: serverDB, expectedShareId: share.id, ownerId, visitorUserId },
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
