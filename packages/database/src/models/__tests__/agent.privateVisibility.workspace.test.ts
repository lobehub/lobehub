// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, sessionGroups, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';

const serverDB: LobeChatDatabase = await getTestDB();

const userA = 'private-vis-user-a';
const userB = 'private-vis-user-b';
const userPersonal = 'private-vis-user-personal';

let workspaceId = '';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userA }, { id: userB }, { id: userPersonal }]);
  const [ws] = await serverDB
    .insert(workspaces)
    .values({ name: 'private-vis-ws', primaryOwnerId: userA, slug: 'private-vis-ws' })
    .returning();
  workspaceId = ws.id;
});

afterEach(async () => {
  await serverDB.delete(users);
});

/**
 * End-to-end cross-user isolation matrix for the private-agent rollout.
 *
 * Every other surface in this branch (task assignee gate, group composite
 * rule, signal emitter, execAgent fail-closed) routes through one of these
 * model-level entry points, so locking the matrix here also locks the
 * downstream feature behaviors that depend on them.
 */
describe('AgentModel — private/public cross-user isolation', () => {
  const insertAgent = async (params: {
    id: string;
    userId: string;
    visibility: 'private' | 'public';
    workspaceId?: string;
    title?: string;
    virtual?: boolean;
  }) => {
    await serverDB.insert(agents).values({
      avatar: 'avatar',
      backgroundColor: '#000',
      description: 'desc',
      id: params.id,
      title: params.title ?? params.id,
      userId: params.userId,
      virtual: params.virtual ?? false,
      visibility: params.visibility,
      workspaceId: params.workspaceId ?? null,
    });
  };

  describe('workspace mode', () => {
    it("hides another user's private agent from queryAgents", async () => {
      await insertAgent({ id: 'a-private', userId: userA, visibility: 'private', workspaceId });
      await insertAgent({ id: 'a-public', userId: userA, visibility: 'public', workspaceId });

      const callerB = new AgentModel(serverDB, userB, workspaceId);
      const ids = (await callerB.queryAgents()).map((row) => row.id);

      expect(ids).toContain('a-public');
      expect(ids).not.toContain('a-private');
    });

    it("returns null when another user fetches a private agent's config", async () => {
      await insertAgent({ id: 'a-private-cfg', userId: userA, visibility: 'private', workspaceId });

      const callerB = new AgentModel(serverDB, userB, workspaceId);
      const config = await callerB.getAgentConfig('a-private-cfg');

      expect(config).toBeNull();
    });

    it('reports existsById = false for cross-user private agents', async () => {
      await insertAgent({
        id: 'a-private-exists',
        userId: userA,
        visibility: 'private',
        workspaceId,
      });

      const callerB = new AgentModel(serverDB, userB, workspaceId);
      expect(await callerB.existsById('a-private-exists')).toBe(false);
    });

    it("does not surface another user's private agent in rank counts", async () => {
      await insertAgent({
        id: 'a-private-rank',
        userId: userA,
        visibility: 'private',
        workspaceId,
      });
      await insertAgent({ id: 'a-public-rank', userId: userA, visibility: 'public', workspaceId });

      const callerB = new AgentModel(serverDB, userB, workspaceId);
      const ranked = await callerB.rank(50);
      const ids = ranked.map((r) => r.id);

      expect(ids).not.toContain('a-private-rank');
    });

    it('owner still sees their own private agent across the same surfaces', async () => {
      await insertAgent({
        id: 'a-owner-private',
        userId: userA,
        visibility: 'private',
        workspaceId,
      });

      const callerA = new AgentModel(serverDB, userA, workspaceId);
      const ids = (await callerA.queryAgents()).map((row) => row.id);

      expect(ids).toContain('a-owner-private');
      expect(await callerA.getAgentConfig('a-owner-private')).not.toBeNull();
      expect(await callerA.existsById('a-owner-private')).toBe(true);
    });

    it('treats public agents from one workspace member as visible to others', async () => {
      await insertAgent({
        id: 'a-shared-public',
        userId: userA,
        visibility: 'public',
        workspaceId,
      });

      const callerB = new AgentModel(serverDB, userB, workspaceId);
      expect(await callerB.existsById('a-shared-public')).toBe(true);
      expect(await callerB.getAgentConfig('a-shared-public')).not.toBeNull();
    });
  });

  describe('setVisibility group rehoming', () => {
    // A sidebar folder cannot mix visibilities — an agent crossing scopes
    // while keyed to a group of the old scope would be emitted nowhere by
    // HomeRepository.processAgentList and vanish from the sidebar.
    const insertGroup = async (id: string, visibility: 'private' | 'public') => {
      await serverDB.insert(sessionGroups).values({
        id,
        name: id,
        userId: userA,
        visibility,
        workspaceId,
      });
    };

    it('clears sessionGroupId when demotion leaves a public group', async () => {
      await insertGroup('pub-group', 'public');
      await insertAgent({ id: 'a-grouped', userId: userA, visibility: 'public', workspaceId });
      await serverDB
        .update(agents)
        .set({ sessionGroupId: 'pub-group' })
        .where(eq(agents.id, 'a-grouped'));

      const callerA = new AgentModel(serverDB, userA, workspaceId);
      const updated = await callerA.setVisibility('a-grouped', 'private');

      expect(updated?.visibility).toBe('private');
      expect(updated?.sessionGroupId).toBeNull();
    });

    it('keeps sessionGroupId when the group already matches the new visibility', async () => {
      await insertGroup('priv-group', 'private');
      await insertAgent({ id: 'a-priv-grouped', userId: userA, visibility: 'public', workspaceId });
      await serverDB
        .update(agents)
        .set({ sessionGroupId: 'priv-group' })
        .where(eq(agents.id, 'a-priv-grouped'));

      const callerA = new AgentModel(serverDB, userA, workspaceId);
      const updated = await callerA.setVisibility('a-priv-grouped', 'private');

      expect(updated?.visibility).toBe('private');
      expect(updated?.sessionGroupId).toBe('priv-group');
    });

    it('keeps ungrouped agents ungrouped on demotion', async () => {
      await insertAgent({ id: 'a-ungrouped', userId: userA, visibility: 'public', workspaceId });

      const callerA = new AgentModel(serverDB, userA, workspaceId);
      const updated = await callerA.setVisibility('a-ungrouped', 'private');

      expect(updated?.visibility).toBe('private');
      expect(updated?.sessionGroupId).toBeNull();
    });
  });

  describe('personal mode', () => {
    it("never returns another user's personal-mode agent", async () => {
      // workspaceId omitted → personal row
      await insertAgent({ id: 'personal-a', userId: userA, visibility: 'private' });

      const callerPersonal = new AgentModel(serverDB, userPersonal);
      expect(await callerPersonal.existsById('personal-a')).toBe(false);
      expect(await callerPersonal.getAgentConfig('personal-a')).toBeNull();
    });

    it("doesn't leak workspace agents to a personal-mode caller", async () => {
      await insertAgent({
        id: 'ws-public-for-personal',
        userId: userA,
        visibility: 'public',
        workspaceId,
      });

      const callerPersonal = new AgentModel(serverDB, userA);
      // userA owns the agent, but in personal mode `workspace_id IS NULL` is
      // required — the workspace row is intentionally invisible.
      expect(await callerPersonal.existsById('ws-public-for-personal')).toBe(false);
    });
  });
});
