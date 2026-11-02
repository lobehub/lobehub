// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, agentShares, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentShareModel } from '../agentShare';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'ascov-user';
const workspaceId = 'ascov-workspace';
const agentId = 'ascov-agent';
const unsharedAgentId = 'ascov-unshared-agent';
const workspaceAgentId = 'ascov-workspace-agent';
const nullListsAgentId = 'ascov-null-lists-agent';

const cleanup = async () => {
  // agents / workspaces / agent_shares all cascade from the owning user.
  await serverDB.delete(users).where(inArray(users.id, [userId]));
};

describe('AgentShareModel coverage edges', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values({ id: userId });
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'ascov workspace',
      primaryOwnerId: userId,
      slug: 'ascov-workspace',
    });
    await serverDB.insert(agents).values([
      { id: agentId, slug: 'ascov-agent-slug', title: 'ascov agent', userId },
      { id: unsharedAgentId, slug: 'ascov-unshared-slug', userId },
      { id: workspaceAgentId, slug: 'ascov-workspace-slug', userId, workspaceId },
      {
        id: nullListsAgentId,
        openingQuestions: null,
        slug: 'ascov-null-lists-slug',
        tags: null,
        title: 'ascov null lists',
        userId,
      },
    ]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  describe('create', () => {
    it('refuses when the conflicting share disappears before it can be re-read', async () => {
      const model = new AgentShareModel(serverDB, userId);
      const original = await model.create(agentId, 'link');

      // Simulates a concurrent hard delete that commits between the conflicting
      // INSERT ... ON CONFLICT DO NOTHING and the follow-up SELECT: the
      // re-read of the existing share comes back empty.
      const authorizeMutation = vi.fn(async (tx: LobeChatDatabase) => {
        vi.spyOn(tx, 'select').mockImplementationOnce(
          () =>
            ({
              from: () => ({ where: () => ({ limit: async () => [] }) }),
            }) as unknown as ReturnType<LobeChatDatabase['select']>,
        );
      });
      const racingModel = new AgentShareModel(serverDB, userId, undefined, { authorizeMutation });

      await expect(racingModel.create(agentId, 'link')).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'Agent sharing is not available in this scope',
      });
      expect(authorizeMutation).toHaveBeenCalledWith(expect.anything(), agentId);

      // The pre-existing share itself was not touched by the refused call.
      const rows = await serverDB
        .select()
        .from(agentShares)
        .where(eq(agentShares.agentId, agentId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: original.id, visibility: 'link' });
    });
  });

  describe('forceDisableWorkspaceShare', () => {
    it('returns null without touching the share when the workspace agent is in the recycle bin', async () => {
      const share = await new AgentShareModel(serverDB, userId, workspaceId).create(
        workspaceAgentId,
        'link',
      );
      await serverDB
        .update(agents)
        .set({ deletedAt: new Date(), isDeleted: true })
        .where(eq(agents.id, workspaceAgentId));
      const authorizeMutation = vi.fn();

      await expect(
        AgentShareModel.forceDisableWorkspaceShare(serverDB, workspaceId, share.id, {
          authorizeMutation,
        }),
      ).resolves.toBeNull();
      expect(authorizeMutation).not.toHaveBeenCalled();

      const [row] = await serverDB.select().from(agentShares).where(eq(agentShares.id, share.id));
      expect(row.visibility).toBe('link');
    });

    it('returns null when the share is deleted after the agent lock is taken', async () => {
      const share = await new AgentShareModel(serverDB, userId, workspaceId).create(
        workspaceAgentId,
        'link',
      );
      const authorizeMutation = vi.fn(async (tx: LobeChatDatabase) => {
        await tx.delete(agentShares).where(eq(agentShares.id, share.id));
      });

      await expect(
        AgentShareModel.forceDisableWorkspaceShare(serverDB, workspaceId, share.id, {
          authorizeMutation,
        }),
      ).resolves.toBeNull();
      expect(authorizeMutation).toHaveBeenCalledWith(expect.anything(), workspaceAgentId);

      const rows = await serverDB.select().from(agentShares).where(eq(agentShares.id, share.id));
      expect(rows).toHaveLength(0);
    });
  });

  describe('updateConfig', () => {
    it('keeps the stored config when the patch carries no defined field', async () => {
      const model = new AgentShareModel(serverDB, userId);
      await model.create(agentId);
      await model.updateConfig(agentId, { maxTurnsPerTopic: 7, showModelInfo: true });

      const updated = await model.updateConfig(agentId, {
        maxTurnsPerTopic: undefined,
        showModelInfo: undefined,
      });

      expect(updated?.shareConfig).toMatchObject({
        maxTurnsPerTopic: 7,
        showModelInfo: true,
        slug: 'ascov-agent-slug',
      });

      const empty = await model.updateConfig(agentId, {});
      expect(empty?.shareConfig).toMatchObject({ maxTurnsPerTopic: 7, showModelInfo: true });
    });
  });

  describe('updateSlug', () => {
    it('returns null when clearing the slug of an owned agent that has no share', async () => {
      const model = new AgentShareModel(serverDB, userId);

      await expect(model.updateSlug(unsharedAgentId, null)).resolves.toBeNull();
      const rows = await serverDB
        .select()
        .from(agentShares)
        .where(eq(agentShares.agentId, unsharedAgentId));
      expect(rows).toHaveLength(0);
    });

    it('returns null when setting a slug on an owned agent that has no share', async () => {
      const model = new AgentShareModel(serverDB, userId);

      await expect(model.updateSlug(unsharedAgentId, 'ascov-fresh-slug')).resolves.toBeNull();
      const rows = await serverDB
        .select()
        .from(agentShares)
        .where(eq(agentShares.agentId, unsharedAgentId));
      expect(rows).toHaveLength(0);
      expect(await AgentShareModel.findBySlugOrId(serverDB, 'ascov-fresh-slug')).toBeNull();
    });
  });

  describe('findByShareId', () => {
    it('falls back to empty lists when the agent stores null tags and opening questions', async () => {
      const share = await new AgentShareModel(serverDB, userId).create(nullListsAgentId, 'link');

      const found = await AgentShareModel.findByShareId(serverDB, share.id);

      expect(found).toMatchObject({
        agentId: nullListsAgentId,
        agentOpeningQuestions: [],
        agentTags: [],
        shareId: share.id,
      });
    });
  });
});
