// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../core/getTestDB';
import { agents, users, workspaces } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { assertAgentUsableBy } from './agent-access';

const serverDB: LobeChatDatabase = await getTestDB();

const userA = 'agent-access-user-a';
const userB = 'agent-access-user-b';

let workspaceA = '';
let workspaceB = '';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userA }, { id: userB }]);

  const [wsA] = await serverDB
    .insert(workspaces)
    .values({ name: 'wsA', primaryOwnerId: userA, slug: 'agent-access-ws-a' })
    .returning();
  const [wsB] = await serverDB
    .insert(workspaces)
    .values({ name: 'wsB', primaryOwnerId: userB, slug: 'agent-access-ws-b' })
    .returning();
  workspaceA = wsA.id;
  workspaceB = wsB.id;
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('assertAgentUsableBy', () => {
  describe('workspace mode', () => {
    it('passes for a public agent for any workspace member', async () => {
      const agentId = 'agt-public';
      await serverDB.insert(agents).values({
        id: agentId,
        userId: userA,
        workspaceId: workspaceA,
        visibility: 'public',
      });

      await expect(
        assertAgentUsableBy(serverDB, agentId, { userId: userB, workspaceId: workspaceA }),
      ).resolves.toBeUndefined();
    });

    it('passes for a private agent when the caller is the owner', async () => {
      const agentId = 'agt-private-owner';
      await serverDB.insert(agents).values({
        id: agentId,
        userId: userA,
        workspaceId: workspaceA,
        visibility: 'private',
      });

      await expect(
        assertAgentUsableBy(serverDB, agentId, { userId: userA, workspaceId: workspaceA }),
      ).resolves.toBeUndefined();
    });

    it("throws NOT_FOUND when a non-owner reaches another user's private agent", async () => {
      const agentId = 'agt-private-other';
      await serverDB.insert(agents).values({
        id: agentId,
        userId: userA,
        workspaceId: workspaceA,
        visibility: 'private',
      });

      await expect(
        assertAgentUsableBy(serverDB, agentId, { userId: userB, workspaceId: workspaceA }),
      ).rejects.toBeInstanceOf(TRPCError);
      await expect(
        assertAgentUsableBy(serverDB, agentId, { userId: userB, workspaceId: workspaceA }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('throws NOT_FOUND when the caller is in a different workspace from the agent', async () => {
      const agentId = 'agt-cross-ws';
      await serverDB.insert(agents).values({
        id: agentId,
        userId: userA,
        workspaceId: workspaceA,
        visibility: 'public',
      });

      await expect(
        assertAgentUsableBy(serverDB, agentId, { userId: userA, workspaceId: workspaceB }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('throws NOT_FOUND when the agent does not exist', async () => {
      await expect(
        assertAgentUsableBy(serverDB, 'missing-id', {
          userId: userA,
          workspaceId: workspaceA,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('personal mode', () => {
    it('passes for the owner of a personal-mode agent', async () => {
      const agentId = 'agt-personal-owner';
      await serverDB.insert(agents).values({ id: agentId, userId: userA });

      await expect(
        assertAgentUsableBy(serverDB, agentId, { userId: userA }),
      ).resolves.toBeUndefined();
    });

    it('throws NOT_FOUND for non-owner access to a personal-mode agent', async () => {
      const agentId = 'agt-personal-other';
      await serverDB.insert(agents).values({ id: agentId, userId: userA });

      await expect(assertAgentUsableBy(serverDB, agentId, { userId: userB })).rejects.toMatchObject(
        { code: 'NOT_FOUND' },
      );
    });

    it('throws NOT_FOUND when caller is personal mode but agent lives in a workspace', async () => {
      const agentId = 'agt-personal-vs-ws';
      await serverDB.insert(agents).values({
        id: agentId,
        userId: userA,
        workspaceId: workspaceA,
        visibility: 'public',
      });

      await expect(assertAgentUsableBy(serverDB, agentId, { userId: userA })).rejects.toMatchObject(
        { code: 'NOT_FOUND' },
      );
    });
  });
});
