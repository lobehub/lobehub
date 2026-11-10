// @vitest-environment node
import { BUILTIN_AGENT_SLUGS, getAgentPersistConfig } from '@lobechat/builtin-agents';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  agentsFiles,
  documents,
  files,
  sessionGroups,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agg-user';
const teammateId = 'agg-teammate';
const wsId = 'agg-ws';

const cleanup = async () => {
  // Agents, files, documents, folders and the workspace all cascade from their users.
  await serverDB.delete(users).where(inArray(users.id, [userId, teammateId]));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: userId }, { id: teammateId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: wsId, name: 'agg ws', primaryOwnerId: userId, slug: 'agg-ws' });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanup();
});

/**
 * Runs `effect` right after the model's first `agents` lookup resolves, standing in
 * for a concurrent request that commits between the read and the write that follows
 * it. The lookup itself always returns the real row.
 */
const commitAfterFirstAgentLookup = (effect: () => Promise<unknown>) => {
  const relational = serverDB.query.agents;
  const original = relational.findFirst.bind(relational);
  let committed = false;

  vi.spyOn(relational, 'findFirst').mockImplementation(((config: any) => {
    const query = original(config);
    if (committed) return query;
    committed = true;
    return query.then(async (row) => {
      await effect();
      return row;
    });
  }) as unknown as typeof relational.findFirst);
};

const readAgent = async (id: string) => {
  const [row] = await serverDB.select().from(agents).where(eq(agents.id, id));
  return row;
};

describe('AgentModel guards', () => {
  describe('create (fixed execution target)', () => {
    it('rejects a fixed device target without a bound device', async () => {
      const model = new AgentModel(serverDB, userId, wsId);

      await expect(
        model.create({
          agencyConfig: { executionTarget: 'device', executionTargetSelectionPolicy: 'fixed' },
          title: 'fixed without device',
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'A fixed device target requires a bound device.',
      });

      const rows = await serverDB.select().from(agents).where(eq(agents.workspaceId, wsId));
      expect(rows).toEqual([]);
    });
  });

  describe('getBuiltinAgent', () => {
    const slug = BUILTIN_AGENT_SLUGS.verifyAgent;
    const persistedChatConfig = getAgentPersistConfig(slug)!.chatConfig;

    it('has a persisted chat config to refresh (fixture precondition)', () => {
      expect(persistedChatConfig).toBeDefined();
    });

    it('refreshes the chat config of an existing builtin row', async () => {
      await serverDB
        .insert(agents)
        .values({ chatConfig: { searchMode: 'auto' } as any, id: 'agg-verify', slug, userId });

      const result = await new AgentModel(serverDB, userId).getBuiltinAgent(slug);

      expect(result?.id).toBe('agg-verify');
      expect(result?.chatConfig).toEqual(persistedChatConfig);
      expect((await readAgent('agg-verify')).chatConfig).toEqual(persistedChatConfig);
    });

    it('falls back to the row it read when it is deleted before the refresh', async () => {
      const staleChatConfig = { searchMode: 'auto' } as any;
      await serverDB
        .insert(agents)
        .values({ chatConfig: staleChatConfig, id: 'agg-verify', slug, userId });
      commitAfterFirstAgentLookup(() => serverDB.delete(agents).where(eq(agents.id, 'agg-verify')));

      const result = await new AgentModel(serverDB, userId).getBuiltinAgent(slug);

      expect(result?.id).toBe('agg-verify');
      expect(result?.chatConfig).toEqual(staleChatConfig);
      expect(await readAgent('agg-verify')).toBeUndefined();
    });

    it('re-reads the winning row when a concurrent provision takes the slug first', async () => {
      commitAfterFirstAgentLookup(() =>
        serverDB.insert(agents).values({ id: 'agg-verify-winner', slug, title: 'winner', userId }),
      );

      const result = await new AgentModel(serverDB, userId).getBuiltinAgent(slug);

      expect(result?.id).toBe('agg-verify-winner');
      const rows = await serverDB
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.userId, userId));
      expect(rows).toEqual([{ id: 'agg-verify-winner' }]);
    });

    it("returns null when a teammate's private row the caller cannot see holds the slug", async () => {
      await serverDB.insert(agents).values({
        id: 'agg-verify-hidden',
        slug,
        userId: teammateId,
        visibility: 'private',
        workspaceId: wsId,
      });

      const result = await new AgentModel(serverDB, userId, wsId).getBuiltinAgent(slug);

      expect(result).toBeNull();
      const rows = await serverDB
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.workspaceId, wsId));
      expect(rows).toEqual([{ id: 'agg-verify-hidden' }]);
    });
  });

  describe('getAgentSnapshotForTaskCreate', () => {
    it('returns no model snapshot when the agent has no model/provider pair', async () => {
      await serverDB.insert(agents).values({ id: 'agg-no-model', model: null, userId });

      const result = await new AgentModel(serverDB, userId).getAgentSnapshotForTaskCreate(
        'agg-no-model',
      );

      expect(result).toEqual({ snapshot: null, visibility: 'public' });
    });
  });

  describe('getGroupMembershipImpact', () => {
    it('returns empty buckets for an empty id list', async () => {
      const result = await new AgentModel(serverDB, userId, wsId).getGroupMembershipImpact([]);

      expect(result).toEqual({ blocked: [], leaving: [] });
    });
  });

  describe('getAgentConfigById (file contents)', () => {
    it('attaches document content only to enabled files', async () => {
      const file = { fileType: 'application/pdf', size: 10, userId };
      await serverDB.insert(files).values([
        { ...file, id: 'agg-file-on', name: 'on.pdf', url: 'https://a.com/on.pdf' },
        { ...file, id: 'agg-file-off', name: 'off.pdf', url: 'https://a.com/off.pdf' },
      ]);
      await serverDB.insert(agents).values({ id: 'agg-files-agent', userId });
      await serverDB.insert(agentsFiles).values([
        { agentId: 'agg-files-agent', enabled: true, fileId: 'agg-file-on', userId },
        { agentId: 'agg-files-agent', enabled: false, fileId: 'agg-file-off', userId },
      ]);
      const doc = {
        fileType: 'application/pdf',
        source: 'doc.pdf',
        sourceType: 'file' as const,
        totalCharCount: 4,
        totalLineCount: 1,
        userId,
      };
      await serverDB.insert(documents).values([
        { ...doc, content: 'on content', fileId: 'agg-file-on', id: 'agg-doc-on' },
        { ...doc, content: 'off content', fileId: 'agg-file-off', id: 'agg-doc-off' },
      ]);

      const result = await new AgentModel(serverDB, userId).getAgentConfigById('agg-files-agent');
      const byId = new Map(result!.files.map((f) => [f.id, f]));

      expect(byId.get('agg-file-on')).toMatchObject({ content: 'on content', enabled: true });
      expect(byId.get('agg-file-off')?.enabled).toBe(false);
      expect(byId.get('agg-file-off')?.content).toBeUndefined();
    });
  });

  describe('publishToWorkspace', () => {
    const model = () => new AgentModel(serverDB, userId, wsId);

    it('releases a private folder when publishing out of it', async () => {
      await serverDB.insert(sessionGroups).values({
        id: 'agg-private-group',
        name: 'Mine',
        userId,
        visibility: 'private',
        workspaceId: wsId,
      });
      await serverDB.insert(agents).values({
        id: 'agg-pub',
        sessionGroupId: 'agg-private-group',
        userId,
        visibility: 'private',
        workspaceId: wsId,
      });

      const result = await model().publishToWorkspace('agg-pub');

      expect(result).toMatchObject({ sessionGroupId: null, visibility: 'public' });
    });

    it('releases a folder the caller can no longer resolve', async () => {
      await serverDB.insert(sessionGroups).values({
        id: 'agg-teammate-group',
        name: 'Theirs',
        userId: teammateId,
        visibility: 'private',
        workspaceId: wsId,
      });
      await serverDB.insert(agents).values({
        id: 'agg-pub',
        sessionGroupId: 'agg-teammate-group',
        userId,
        visibility: 'private',
        workspaceId: wsId,
      });

      const result = await model().publishToWorkspace('agg-pub');

      expect(result).toMatchObject({ sessionGroupId: null, visibility: 'public' });
    });

    it('rejects when a concurrent publish wins between the read and the write', async () => {
      await serverDB
        .insert(agents)
        .values({ id: 'agg-pub', userId, visibility: 'private', workspaceId: wsId });
      commitAfterFirstAgentLookup(() =>
        serverDB.update(agents).set({ visibility: 'public' }).where(eq(agents.id, 'agg-pub')),
      );

      await expect(model().publishToWorkspace('agg-pub')).rejects.toThrow(
        'Agent not found, already published, or access denied',
      );
      expect((await readAgent('agg-pub')).visibility).toBe('public');
    });
  });

  describe('updateSessionGroupId', () => {
    it('refuses to move a private agent into a public folder', async () => {
      await serverDB.insert(sessionGroups).values({
        id: 'agg-public-group',
        name: 'Shared',
        userId,
        visibility: 'public',
        workspaceId: wsId,
      });
      await serverDB
        .insert(agents)
        .values({ id: 'agg-move', userId, visibility: 'private', workspaceId: wsId });

      await expect(
        new AgentModel(serverDB, userId, wsId).updateSessionGroupId('agg-move', 'agg-public-group'),
      ).rejects.toThrow('A private agent cannot be moved into a public folder');
      expect((await readAgent('agg-move')).sessionGroupId).toBeNull();
    });

    it('moves a private agent into a private folder', async () => {
      await serverDB.insert(sessionGroups).values({
        id: 'agg-private-group',
        name: 'Mine',
        userId,
        visibility: 'private',
        workspaceId: wsId,
      });
      await serverDB
        .insert(agents)
        .values({ id: 'agg-move', userId, visibility: 'private', workspaceId: wsId });

      const result = await new AgentModel(serverDB, userId, wsId).updateSessionGroupId(
        'agg-move',
        'agg-private-group',
      );

      expect(result?.sessionGroupId).toBe('agg-private-group');
    });
  });

  describe('setVisibility', () => {
    it('returns null for an agent outside the caller scope', async () => {
      const result = await new AgentModel(serverDB, userId).setVisibility('agg-missing', 'private');

      expect(result).toBeNull();
    });
  });

  describe('updateConfig (params)', () => {
    it('starts from an empty params object when the stored params are null', async () => {
      await serverDB.insert(agents).values({ id: 'agg-params', params: null, userId });

      await new AgentModel(serverDB, userId).updateConfig('agg-params', {
        params: { temperature: 0.4 },
      });

      expect((await readAgent('agg-params')).params).toEqual({ temperature: 0.4 });
    });
  });

  describe('updateSlug', () => {
    it("reports a slug taken by a teammate's private agent the caller cannot see", async () => {
      await serverDB.insert(agents).values([
        { id: 'agg-mine', slug: 'agg-mine', userId, workspaceId: wsId },
        {
          id: 'agg-hidden',
          slug: 'agg-hidden-slug',
          userId: teammateId,
          visibility: 'private',
          workspaceId: wsId,
        },
      ]);

      const result = await new AgentModel(serverDB, userId, wsId).updateSlug(
        'agg-mine',
        'agg-hidden-slug',
      );

      expect(result).toEqual({ reason: 'taken', success: false });
      expect((await readAgent('agg-mine')).slug).toBe('agg-mine');
    });
  });
});
