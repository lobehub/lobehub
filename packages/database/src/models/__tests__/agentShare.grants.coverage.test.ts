// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, agentShareGrants, agentShares, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentShareModel } from '../agentShare';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'asgrant-owner';
const visitorId = 'asgrant-visitor';
const secondVisitorId = 'asgrant-second-visitor';
const agentId = 'asgrant-agent';
const unsharedAgentId = 'asgrant-unshared-agent';

const cleanup = async () => {
  // agents / agent_shares / agent_share_grants all cascade from the owning user.
  await serverDB.delete(users).where(inArray(users.id, [ownerId, visitorId, secondVisitorId]));
};

describe('AgentShareModel grant lifecycle', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([
      { id: ownerId, username: 'asgrant-owner' },
      { fullName: 'Visitor One', id: visitorId, username: 'asgrant-visitor' },
      { id: secondVisitorId, username: 'asgrant-second-visitor' },
    ]);
    await serverDB.insert(agents).values([
      { id: agentId, slug: 'asgrant-agent-slug', title: 'asgrant agent', userId: ownerId },
      { id: unsharedAgentId, slug: 'asgrant-unshared-slug', userId: ownerId },
    ]);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('admitsVisitor', () => {
    it('admits any visitor to a link share without a grant lookup', async () => {
      const model = new AgentShareModel(serverDB, ownerId);
      const share = await model.create(agentId, 'link');

      await expect(
        AgentShareModel.admitsVisitor(
          serverDB,
          { shareId: share!.id, visibility: 'link' },
          visitorId,
        ),
      ).resolves.toBe(true);
      expect(await serverDB.select().from(agentShareGrants)).toHaveLength(0);
    });

    it('refuses a visibility that is neither link nor card', async () => {
      const model = new AgentShareModel(serverDB, ownerId);
      const share = await model.create(agentId, 'card');

      await expect(
        AgentShareModel.admitsVisitor(
          serverDB,
          { shareId: share!.id, visibility: 'private' },
          visitorId,
        ),
      ).resolves.toBe(false);
    });

    it('refuses a card share before any grant exists', async () => {
      const model = new AgentShareModel(serverDB, ownerId);
      const share = await model.create(agentId, 'card');

      await expect(
        AgentShareModel.admitsVisitor(
          serverDB,
          { shareId: share!.id, visibility: 'card' },
          visitorId,
        ),
      ).resolves.toBe(false);
    });

    it('admits a card share while the grant is live and refuses it once revoked', async () => {
      const model = new AgentShareModel(serverDB, ownerId);
      const share = await model.create(agentId, 'card');

      await AgentShareModel.grant(serverDB, {
        issuedAt: new Date(Date.now() - 1000),
        shareId: share!.id,
        source: { channelId: 'channel', messageId: 'message', type: 'card' },
        userId: visitorId,
      });

      await expect(
        AgentShareModel.admitsVisitor(
          serverDB,
          { shareId: share!.id, visibility: 'card' },
          visitorId,
        ),
      ).resolves.toBe(true);

      await expect(model.revokeGrant(agentId, visitorId)).resolves.toBe(true);

      await expect(
        AgentShareModel.admitsVisitor(
          serverDB,
          { shareId: share!.id, visibility: 'card' },
          visitorId,
        ),
      ).resolves.toBe(false);
    });
  });

  describe('grant', () => {
    it('inserts a grant and keeps the first source when a live grant is offered again', async () => {
      const model = new AgentShareModel(serverDB, ownerId);
      const share = await model.create(agentId, 'card');
      const issuedAt = new Date();

      await expect(
        AgentShareModel.grant(serverDB, {
          issuedAt,
          shareId: share!.id,
          source: { channelId: 'channel-a', messageId: 'message-a', type: 'card' },
          userId: visitorId,
        }),
      ).resolves.toBe(true);

      // The conflicting insert updates nothing (the grant is live), so the
      // follow-up read decides the outcome and the original source survives.
      await expect(
        AgentShareModel.grant(serverDB, {
          issuedAt,
          shareId: share!.id,
          source: { channelId: 'channel-b', messageId: 'message-b', type: 'card' },
          userId: visitorId,
        }),
      ).resolves.toBe(true);

      const [row] = await serverDB
        .select()
        .from(agentShareGrants)
        .where(eq(agentShareGrants.shareId, share!.id));
      expect(row).toMatchObject({
        revokedAt: null,
        source: { channelId: 'channel-a', messageId: 'message-a', type: 'card' },
        userId: visitorId,
      });
    });

    it('does not restore a grant with a card issued before the revoke', async () => {
      const model = new AgentShareModel(serverDB, ownerId);
      const share = await model.create(agentId, 'card');

      await AgentShareModel.grant(serverDB, {
        issuedAt: new Date(Date.now() - 60_000),
        shareId: share!.id,
        source: { channelId: 'channel', messageId: 'message', type: 'card' },
        userId: visitorId,
      });
      await expect(model.revokeGrant(agentId, visitorId)).resolves.toBe(true);

      const [revoked] = await serverDB
        .select()
        .from(agentShareGrants)
        .where(eq(agentShareGrants.shareId, share!.id));

      // A card that predates the withdrawal must not silently undo it.
      await expect(
        AgentShareModel.grant(serverDB, {
          issuedAt: new Date(revoked.revokedAt!.getTime() - 1000),
          shareId: share!.id,
          source: { channelId: 'channel', messageId: 'older-message', type: 'card' },
          userId: visitorId,
        }),
      ).resolves.toBe(false);

      const [stillRevoked] = await serverDB
        .select()
        .from(agentShareGrants)
        .where(eq(agentShareGrants.shareId, share!.id));
      expect(stillRevoked.revokedAt).not.toBeNull();
    });

    it('restores a revoked grant when the owner sends a newer card', async () => {
      const model = new AgentShareModel(serverDB, ownerId);
      const share = await model.create(agentId, 'card');

      await AgentShareModel.grant(serverDB, {
        issuedAt: new Date(Date.now() - 60_000),
        shareId: share!.id,
        source: { channelId: 'channel', messageId: 'message', type: 'card' },
        userId: visitorId,
      });
      await model.revokeGrant(agentId, visitorId);

      // `issuedAt` must be strictly after `revokedAt`, otherwise the restore is
      // rejected as an older card — do not depend on the two timestamps landing
      // in different milliseconds.
      const [beforeRestore] = await serverDB
        .select()
        .from(agentShareGrants)
        .where(eq(agentShareGrants.shareId, share!.id));

      await expect(
        AgentShareModel.grant(serverDB, {
          issuedAt: new Date(beforeRestore.revokedAt!.getTime() + 1000),
          shareId: share!.id,
          source: { channelId: 'channel', messageId: 'newer-message', type: 'card' },
          userId: visitorId,
        }),
      ).resolves.toBe(true);

      const [row] = await serverDB
        .select()
        .from(agentShareGrants)
        .where(eq(agentShareGrants.shareId, share!.id));
      expect(row).toMatchObject({
        revokedAt: null,
        source: { channelId: 'channel', messageId: 'newer-message', type: 'card' },
      });
    });
  });

  describe('listGrants', () => {
    it('returns an empty list for an agent that has no share', async () => {
      const model = new AgentShareModel(serverDB, ownerId);

      await expect(model.listGrants(unsharedAgentId)).resolves.toEqual([]);
    });

    it('lists live grants newest first with the admitted person attached', async () => {
      const model = new AgentShareModel(serverDB, ownerId);
      const share = await model.create(agentId, 'card');

      await serverDB.insert(agentShareGrants).values([
        {
          createdAt: new Date('2026-11-20T10:00:00Z'),
          shareId: share!.id,
          source: { channelId: 'channel', messageId: 'first', type: 'card' },
          userId: visitorId,
        },
        {
          createdAt: new Date('2026-11-21T10:00:00Z'),
          shareId: share!.id,
          source: { channelId: 'channel', messageId: 'second', type: 'card' },
          userId: secondVisitorId,
        },
        {
          createdAt: new Date('2026-11-22T10:00:00Z'),
          revokedAt: new Date('2026-11-22T11:00:00Z'),
          shareId: share!.id,
          source: { channelId: 'channel', messageId: 'revoked', type: 'card' },
          userId: ownerId,
        },
      ]);

      const grants = await model.listGrants(agentId);

      expect(grants).toHaveLength(2);
      expect(grants.map((grant) => grant.user.id)).toEqual([secondVisitorId, visitorId]);
      expect(grants[1].user).toMatchObject({
        fullName: 'Visitor One',
        username: 'asgrant-visitor',
      });
    });
  });

  describe('revokeGrant', () => {
    it('returns false for an agent that has no share', async () => {
      const model = new AgentShareModel(serverDB, ownerId);

      await expect(model.revokeGrant(unsharedAgentId, visitorId)).resolves.toBe(false);
    });

    it('returns false when the person holds no live grant', async () => {
      const model = new AgentShareModel(serverDB, ownerId);
      await model.create(agentId, 'card');

      await expect(model.revokeGrant(agentId, visitorId)).resolves.toBe(false);
    });

    it('marks a live grant revoked and reports the second revoke as a no-op', async () => {
      const model = new AgentShareModel(serverDB, ownerId);
      const share = await model.create(agentId, 'card');
      await AgentShareModel.grant(serverDB, {
        issuedAt: new Date(),
        shareId: share!.id,
        source: { channelId: 'channel', messageId: 'message', type: 'card' },
        userId: visitorId,
      });

      await expect(model.revokeGrant(agentId, visitorId)).resolves.toBe(true);
      await expect(model.revokeGrant(agentId, visitorId)).resolves.toBe(false);

      const [row] = await serverDB
        .select()
        .from(agentShares)
        .where(eq(agentShares.agentId, agentId));
      expect(row.id).toBe(share!.id);
    });
  });

  describe('request grants', () => {
    const requestSource = (grantId: string) => ({
      channelId: 'channel',
      grantId,
      type: 'request' as const,
    });

    it('admits the approved person through a request grant', async () => {
      const model = new AgentShareModel(serverDB, ownerId);
      const share = await model.create(agentId, 'card');

      await AgentShareModel.grantByRequest(serverDB, {
        channelId: 'channel',
        grantId: 'grant-approved',
        shareId: share!.id,
        userId: visitorId,
      });

      const [row] = await serverDB
        .select()
        .from(agentShareGrants)
        .where(eq(agentShareGrants.shareId, share!.id));
      expect(row).toMatchObject({
        revokedAt: null,
        source: { channelId: 'channel', grantId: 'grant-approved', type: 'request' },
        userId: visitorId,
      });
      await expect(
        AgentShareModel.admitsVisitor(
          serverDB,
          { shareId: share!.id, visibility: 'card' },
          visitorId,
        ),
      ).resolves.toBe(true);
    });

    it('restores a revoked card grant and takes over its source', async () => {
      const model = new AgentShareModel(serverDB, ownerId);
      const share = await model.create(agentId, 'card');

      await AgentShareModel.grant(serverDB, {
        issuedAt: new Date(Date.now() - 60_000),
        shareId: share!.id,
        source: { channelId: 'channel', messageId: 'message', type: 'card' },
        userId: visitorId,
      });
      await expect(model.revokeGrant(agentId, visitorId)).resolves.toBe(true);

      await AgentShareModel.grantByRequest(serverDB, {
        channelId: 'channel',
        grantId: 'grant-after-revoke',
        shareId: share!.id,
        userId: visitorId,
      });

      const [row] = await serverDB
        .select()
        .from(agentShareGrants)
        .where(eq(agentShareGrants.shareId, share!.id));
      expect(row).toMatchObject({ revokedAt: null, source: requestSource('grant-after-revoke') });
      await expect(
        AgentShareModel.admitsVisitor(
          serverDB,
          { shareId: share!.id, visibility: 'card' },
          visitorId,
        ),
      ).resolves.toBe(true);
    });

    it('reports only the live request grants among the asked people', async () => {
      const model = new AgentShareModel(serverDB, ownerId);
      const share = await model.create(agentId, 'card');

      await expect(AgentShareModel.requestGrantedUserIds(serverDB, share!.id, [])).resolves.toEqual(
        [],
      );

      // A card grant is not a request grant.
      await AgentShareModel.grant(serverDB, {
        issuedAt: new Date(),
        shareId: share!.id,
        source: { channelId: 'channel', messageId: 'message', type: 'card' },
        userId: secondVisitorId,
      });
      await AgentShareModel.grantByRequest(serverDB, {
        channelId: 'channel',
        grantId: 'grant-live',
        shareId: share!.id,
        userId: visitorId,
      });

      await expect(
        AgentShareModel.requestGrantedUserIds(serverDB, share!.id, [visitorId, secondVisitorId]),
      ).resolves.toEqual([visitorId]);

      // A withdrawn request grant stops counting.
      await expect(model.revokeGrant(agentId, visitorId)).resolves.toBe(true);
      await expect(
        AgentShareModel.requestGrantedUserIds(serverDB, share!.id, [visitorId]),
      ).resolves.toEqual([]);
    });
  });
});
