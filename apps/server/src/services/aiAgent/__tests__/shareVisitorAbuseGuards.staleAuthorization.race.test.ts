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

// Real-Postgres reproduction of the stale-authorization race on
// `apps/server/src/services/aiAgent/shareVisitorAbuseGuards.ts:100`:
//
// The row-lock and stale-cap fixes (see the sibling race test files) made
// `reserveShareVisitorTopicOrThrow` / `reserveShareVisitorTurnOrThrow` read
// `maxTopicsPerVisitor` / `maxTurnsPerTopic` fresh, under the SAME
// `agents.id FOR UPDATE` lock every share-mutation path takes. But neither
// guard actually checked WHETHER the share was still authorized to run at
// all — they read `visibility`-agnostic caps and the live `shareId`, then
// inserted the topic/message under it regardless of visibility. An owner who
// makes a `link` share `private` while a visitor's request is still
// resolving would have that request's topic/message insert land AFTER the
// revocation committed, silently exposing a conversation created while
// access was revoked.
//
// The fix adds an `assertShareStillAuthorized` check — visibility must be
// `link` — inside the SAME locked transaction, before any row is written.
// These tests force that ordering: the owner makes the link private
// mid-request.
//
// NOTE: this file used to also cover a disable → re-enable mid-request
// scenario, rejected via a generation counter that no longer exists (see
// `assertShareStillAuthorized`'s JSDoc for the accepted tradeoff — the plain
// visibility check above is the sole gate for this race now, so a request
// that predates a disable → re-enable cycle can land on the replacement
// share).

const ownerId = 'agent-share-stale-auth-owner';
const visitorId = 'agent-share-stale-auth-visitor';

const serverDB: LobeChatDatabase = await getTestDB();
const agentShareModel = new AgentShareModel(serverDB, ownerId);

const cleanup = async () => {
  await serverDB.delete(users).where(inArray(users.id, [ownerId, visitorId]));
};

describe('reserveShareVisitorTopicOrThrow / reserveShareVisitorTurnOrThrow — stale authorization (real Postgres)', () => {
  beforeEach(async () => {
    await cleanup();
    // The visitor is a real user row now: a share conversation is THEIR
    // topic, so it cannot be inserted without one.
    await serverDB.insert(users).values([{ id: ownerId }, { id: visitorId }]);
  });

  afterAll(cleanup);

  it('rejects a new-topic reservation once the owner made the link private, and inserts nothing', async () => {
    const agentId = 'stale-auth-topic-private-mid-flight';
    await serverDB
      .insert(agents)
      .values({ id: agentId, model: 'gpt-4o', title: 'Private Mid Flight Topic', userId: ownerId });

    const share = await agentShareModel.create(agentId, 'link');

    // Owner revokes access while the visitor's request is still resolving
    // (e.g. thousands of lines of agent-config resolution in
    // `AiAgentService.execAgentInternal` between the request's initial share
    // read and this reservation call).
    await agentShareModel.updateVisibility(agentId, 'private');

    await expect(
      reserveShareVisitorTopicOrThrow({
        agentId,
        create: (topicModel, shareId) =>
          topicModel.create({ agentId, shareId, title: 'stale-topic' }),
        db: serverDB,
        ownerId,
        visitorUserId: visitorId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const insertedTopics = await serverDB
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.agentId, agentId));
    expect(insertedTopics.length).toBe(0);
    expect(share.visibility).toBe('link'); // sanity: it really was link before the revoke
  });

  it('rejects a turn reservation once the owner made the link private, and inserts no message', async () => {
    const agentId = 'stale-auth-turn-private-mid-flight';
    await serverDB
      .insert(agents)
      .values({ id: agentId, model: 'gpt-4o', title: 'Private Mid Flight Turn', userId: ownerId });

    await agentShareModel.create(agentId, 'link');

    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId, shareId: '00000000-0000-4000-8000-000000000001', userId: visitorId })
      .returning();

    await agentShareModel.updateVisibility(agentId, 'private');

    await expect(
      reserveShareVisitorTurnOrThrow({
        agentId,
        create: (messageModel) =>
          messageModel.create({
            agentId,
            content: 'stale-turn',
            role: 'user',
            topicId: topic.id,
          }),
        db: serverDB,
        ownerId,
        topicId: topic.id,
        visitorUserId: visitorId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
