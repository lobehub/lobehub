// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { AgentShareConfig } from '../../schemas';
import { agents, agentShares, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentShareModel } from '../agentShare';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-share-test-user';
const otherUserId = 'agent-share-test-other-user';
const agentId = 'agent-share-test-agent';
const otherAgentId = 'agent-share-test-other-agent';
const workspaceAgentId = 'agent-share-test-workspace-agent';
const workspaceId = 'agent-share-test-workspace';

const agentShareModel = new AgentShareModel(serverDB, userId);
const otherAgentShareModel = new AgentShareModel(serverDB, otherUserId);

describe('AgentShareModel', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.transaction(async (tx) => {
      await tx.insert(users).values([{ id: userId }, { id: otherUserId }]);
      await tx.insert(workspaces).values({
        id: workspaceId,
        name: 'Agent Share Test Workspace',
        primaryOwnerId: userId,
        slug: 'agent-share-test-workspace',
      });
      await tx.insert(agents).values([
        {
          avatar: '🤯',
          backgroundColor: '#000000',
          description: 'Shareable agent',
          id: agentId,
          name: 'Shareable Agent',
          title: 'Shareable Agent Title',
          userId,
        },
        { id: otherAgentId, title: 'Other Agent', userId: otherUserId },
        { id: workspaceAgentId, userId, workspaceId },
      ]);
    });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  describe('create', () => {
    it('creates a UUID share with conservative defaults', async () => {
      const share = await agentShareModel.create(agentId);

      expect(share).not.toBeNull();
      expect(share).toMatchObject({
        agentId,
        shareConfig: {
          allowReadMemory: false,
          enabledToolIds: [],
          filePermissionConfig: {
            agentFiles: 'none',
            knowledgeBase: 'none',
            uploadAllowed: false,
          },
          maxTopicsPerVisitor: 5,
          maxTurnsPerTopic: 20,
        },
        userViewCount: 0,
        visibility: 'private',
      });
      expect(share!.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(share!.shareConfig).not.toHaveProperty('guestEnabled');
    });

    it('preserves the first share when creation conflicts', async () => {
      const first = await agentShareModel.create(agentId, 'private');
      const second = await agentShareModel.create(agentId, 'link');

      expect(second).toEqual(first);
      const rows = await serverDB
        .select()
        .from(agentShares)
        .where(eq(agentShares.agentId, agentId));
      expect(rows).toHaveLength(1);
      expect(rows[0].visibility).toBe('private');
    });

    it('rejects missing, foreign, and workspace agents', async () => {
      await expect(agentShareModel.create('missing-agent')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(agentShareModel.create(otherAgentId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(agentShareModel.create(workspaceAgentId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  describe('owner operations', () => {
    it('normalizes a legacy null config to conservative defaults', async () => {
      const [legacyShare] = await serverDB.insert(agentShares).values({ agentId }).returning();

      const ownerShare = await agentShareModel.getByAgentId(agentId);
      const resolvedShare = await AgentShareModel.findByShareId(serverDB, legacyShare.id);

      expect(ownerShare?.shareConfig).toEqual({
        allowReadMemory: false,
        enabledToolIds: [],
        filePermissionConfig: {
          agentFiles: 'none',
          knowledgeBase: 'none',
          uploadAllowed: false,
        },
        maxTopicsPerVisitor: 5,
        maxTurnsPerTopic: 20,
      });
      expect(resolvedShare?.shareConfig).toEqual(ownerShare?.shareConfig);
    });

    it('reads and updates the complete config', async () => {
      await agentShareModel.create(agentId);
      const config: AgentShareConfig = {
        allowReadMemory: true,
        enabledToolIds: ['search'],
        filePermissionConfig: {
          agentFiles: 'read',
          knowledgeBase: 'read',
          uploadAllowed: true,
        },
        maxTopicsPerVisitor: 10,
        maxTurnsPerTopic: 40,
      };

      const updated = await agentShareModel.updateConfig(agentId, config);
      const readBack = await agentShareModel.getByAgentId(agentId);

      expect(updated?.shareConfig).toEqual(config);
      expect(readBack?.shareConfig).toEqual(config);
    });

    it('updates visibility and deletes the share', async () => {
      const created = await agentShareModel.create(agentId);

      const updated = await agentShareModel.updateVisibility(agentId, 'link');
      expect(updated?.visibility).toBe('link');

      const deleted = await agentShareModel.deleteByAgentId(agentId);
      expect(deleted?.id).toBe(created?.id);
      expect(await AgentShareModel.findByShareId(serverDB, created!.id)).toBeNull();
    });

    it('returns null for missing shares', async () => {
      expect(await agentShareModel.getByAgentId(agentId)).toBeNull();
      expect(
        await agentShareModel.updateConfig(agentId, {
          maxTopicsPerVisitor: 5,
          maxTurnsPerTopic: 20,
        }),
      ).toBeNull();
      expect(await agentShareModel.updateVisibility(agentId, 'link')).toBeNull();
      expect(await agentShareModel.deleteByAgentId(agentId)).toBeNull();
    });

    it("does not read, update, or delete another user's share", async () => {
      const otherShare = await otherAgentShareModel.create(otherAgentId);

      expect(await agentShareModel.getByAgentId(otherAgentId)).toBeNull();
      expect(
        await agentShareModel.updateConfig(otherAgentId, {
          maxTopicsPerVisitor: 5,
          maxTurnsPerTopic: 20,
        }),
      ).toBeNull();
      expect(await agentShareModel.updateVisibility(otherAgentId, 'link')).toBeNull();
      expect(await agentShareModel.deleteByAgentId(otherAgentId)).toBeNull();
      expect(await otherAgentShareModel.getByAgentId(otherAgentId)).toEqual(otherShare);
    });

    it('generates a new UUID after sharing is disabled and re-enabled', async () => {
      const first = await agentShareModel.create(agentId);
      await agentShareModel.deleteByAgentId(agentId);
      const second = await agentShareModel.create(agentId);

      expect(second?.id).not.toBe(first?.id);
      expect(await AgentShareModel.findByShareId(serverDB, first!.id)).toBeNull();
    });
  });

  describe('public lookup', () => {
    it('returns the minimum public agent metadata', async () => {
      const created = await agentShareModel.create(agentId, 'link');

      const share = await AgentShareModel.findByShareId(serverDB, created!.id);

      expect(share).toMatchObject({
        agentBackgroundColor: '#000000',
        agentDescription: 'Shareable agent',
        agentId,
        agentName: 'Shareable Agent',
        agentTitle: 'Shareable Agent Title',
        ownerId: userId,
        shareConfig: expect.objectContaining({
          maxTopicsPerVisitor: 5,
          maxTurnsPerTopic: 20,
        }),
        shareId: created!.id,
        visibility: 'link',
      });
    });

    it('does not expose a workspace agent even if a share row exists', async () => {
      const [share] = await serverDB
        .insert(agentShares)
        .values({
          agentId: workspaceAgentId,
          shareConfig: { maxTopicsPerVisitor: 5, maxTurnsPerTopic: 20 },
          visibility: 'link',
        })
        .returning();

      expect(await AgentShareModel.findByShareId(serverDB, share.id)).toBeNull();
    });

    it('returns null for an unknown UUID', async () => {
      expect(
        await AgentShareModel.findByShareId(serverDB, '00000000-0000-0000-0000-000000000000'),
      ).toBeNull();
    });

    it('treats a malformed UUID as not found', async () => {
      expect(await AgentShareModel.findByShareId(serverDB, 'not-a-uuid')).toBeNull();
      await expect(
        AgentShareModel.findByShareIdWithAccessCheck(serverDB, 'not-a-uuid', userId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('access checks', () => {
    it('allows the owner to access a private share', async () => {
      const created = await agentShareModel.create(agentId);

      const share = await AgentShareModel.findByShareIdWithAccessCheck(
        serverDB,
        created!.id,
        userId,
      );

      expect(share.shareId).toBe(created!.id);
    });

    it('rejects non-owner access to a private share', async () => {
      const created = await agentShareModel.create(agentId);

      await expect(
        AgentShareModel.findByShareIdWithAccessCheck(serverDB, created!.id, otherUserId),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('allows authenticated access to a link share', async () => {
      const created = await agentShareModel.create(agentId, 'link');

      const share = await AgentShareModel.findByShareIdWithAccessCheck(
        serverDB,
        created!.id,
        otherUserId,
      );

      expect(share.shareId).toBe(created!.id);
    });

    it('throws NOT_FOUND for an unknown UUID', async () => {
      await expect(
        AgentShareModel.findByShareIdWithAccessCheck(
          serverDB,
          '00000000-0000-0000-0000-000000000000',
          userId,
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('incrementUserViewCount', () => {
    it('atomically records successful page views', async () => {
      const created = await agentShareModel.create(agentId);

      await Promise.all([
        AgentShareModel.incrementUserViewCount(serverDB, created!.id),
        AgentShareModel.incrementUserViewCount(serverDB, created!.id),
        AgentShareModel.incrementUserViewCount(serverDB, created!.id),
      ]);

      const [share] = await serverDB
        .select({ userViewCount: agentShares.userViewCount })
        .from(agentShares)
        .where(eq(agentShares.id, created!.id));
      expect(share.userViewCount).toBe(3);
    });
  });
});
