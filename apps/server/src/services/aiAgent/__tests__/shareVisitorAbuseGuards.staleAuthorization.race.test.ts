// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, topics, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { AgentShareModel } from '@/database/models/agentShare';
import { readAgentShareGeneration } from '@/database/utils/agentShareGeneration';

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
// inserted the topic/message under it regardless of visibility or
// generation. An owner who makes a `link` share `private` (or disables and
// republishes it) while a visitor's request is still resolving would have
// that request's topic/message insert land AFTER the revocation committed,
// silently exposing (or re-filing under the REPLACEMENT share) a
// conversation created while access was revoked.
//
// The fix adds an `assertShareStillAuthorized` check — visibility must be
// `link` AND the current `agentShareGenerations` value must match the
// caller's `expectedGeneration` — inside the SAME locked transaction, before
// any row is written. These tests force both orderings described above:
// (1) owner makes the link private mid-request, and (2) owner disables then
// re-enables mid-request (the stale request must not stamp onto the
// replacement share).

const ownerId = 'agent-share-stale-auth-owner';
const visitorId = 'agent-share-stale-auth-visitor';

const serverDB: LobeChatDatabase = await getTestDB();
const agentShareModel = new AgentShareModel(serverDB, ownerId);

const cleanup = async () => {
  await serverDB.delete(users).where(eq(users.id, ownerId));
};

describe('reserveShareVisitorTopicOrThrow / reserveShareVisitorTurnOrThrow — stale authorization (real Postgres)', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([{ id: ownerId }]);
  });

  afterAll(cleanup);

  it('rejects a new-topic reservation once the owner made the link private, and inserts nothing', async () => {
    const agentId = 'stale-auth-topic-private-mid-flight';
    await serverDB
      .insert(agents)
      .values({ id: agentId, model: 'gpt-4o', title: 'Private Mid Flight Topic', userId: ownerId });

    const share = await agentShareModel.create(agentId, 'link');
    const generationObservedByVisitor = await readAgentShareGeneration(serverDB, agentId);

    // Owner revokes access while the visitor's request is still resolving
    // (e.g. thousands of lines of agent-config resolution in
    // `AiAgentService.execAgentWithReservation` between the request's initial
    // share read and this reservation call).
    await agentShareModel.updateVisibility(agentId, 'private');

    await expect(
      reserveShareVisitorTopicOrThrow({
        agentId,
        create: (topicModel, shareId) =>
          topicModel.create({ agentId, senderId: visitorId, shareId, title: 'stale-topic' }),
        db: serverDB,
        expectedGeneration: generationObservedByVisitor,
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
    const generationObservedByVisitor = await readAgentShareGeneration(serverDB, agentId);

    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId, senderId: visitorId, userId: ownerId })
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
        expectedGeneration: generationObservedByVisitor,
        ownerId,
        topicId: topic.id,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects a new-topic reservation from a request that predates a disable → re-enable cycle instead of stamping it onto the replacement share', async () => {
    const agentId = 'stale-auth-topic-disable-reenable';
    await serverDB.insert(agents).values({
      id: agentId,
      model: 'gpt-4o',
      title: 'Disable Reenable Topic',
      userId: ownerId,
    });

    const originalShare = await agentShareModel.create(agentId, 'link');
    const generationObservedByVisitor = await readAgentShareGeneration(serverDB, agentId);

    // Owner disables (bumps the generation) and republishes (mints a brand
    // new `agentShares.id`) while the stale request is still resolving.
    await agentShareModel.deleteByAgentId(agentId);
    const replacementShare = await agentShareModel.create(agentId, 'link');

    expect(replacementShare.id).not.toBe(originalShare.id);

    const currentGeneration = await readAgentShareGeneration(serverDB, agentId);
    expect(currentGeneration).not.toBe(generationObservedByVisitor);

    // The stale request still carries the generation it observed BEFORE the
    // disable → re-enable cycle — it must be rejected, not silently
    // re-authorized against the replacement share just because visibility is
    // `link` again.
    await expect(
      reserveShareVisitorTopicOrThrow({
        agentId,
        create: (topicModel, shareId) =>
          topicModel.create({ agentId, senderId: visitorId, shareId, title: 'stale-topic' }),
        db: serverDB,
        expectedGeneration: generationObservedByVisitor,
        ownerId,
        visitorUserId: visitorId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const insertedTopics = await serverDB
      .select({ id: topics.id, shareId: topics.shareId })
      .from(topics)
      .where(eq(topics.agentId, agentId));
    expect(insertedTopics.length).toBe(0);

    // A FRESH request that observes the CURRENT generation succeeds and is
    // correctly stamped onto the replacement share.
    const freshTopic = await reserveShareVisitorTopicOrThrow({
      agentId,
      create: (topicModel, shareId) =>
        topicModel.create({ agentId, senderId: visitorId, shareId, title: 'fresh-topic' }),
      db: serverDB,
      expectedGeneration: currentGeneration,
      ownerId,
      visitorUserId: visitorId,
    });
    expect(freshTopic.shareId).toBe(replacementShare.id);
  });

  it('rejects a turn reservation from a request that predates a disable → re-enable cycle', async () => {
    const agentId = 'stale-auth-turn-disable-reenable';
    await serverDB.insert(agents).values({
      id: agentId,
      model: 'gpt-4o',
      title: 'Disable Reenable Turn',
      userId: ownerId,
    });

    await agentShareModel.create(agentId, 'link');
    const generationObservedByVisitor = await readAgentShareGeneration(serverDB, agentId);

    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId, senderId: visitorId, userId: ownerId })
      .returning();

    await agentShareModel.deleteByAgentId(agentId);
    await agentShareModel.create(agentId, 'link');

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
        expectedGeneration: generationObservedByVisitor,
        ownerId,
        topicId: topic.id,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
