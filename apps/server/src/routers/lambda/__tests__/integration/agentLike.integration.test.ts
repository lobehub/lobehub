// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { agents, workspaceMembers, workspaces } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentLikeRouter } from '../../agentLike';
import { cleanupTestUser, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

const context = (userId: string, workspaceId?: string) => ({
  jwtPayload: { userId },
  userId,
  workspaceId,
});

describe('agentLikeRouter integration', () => {
  let db: LobeChatDatabase;
  let agentId: string;
  let privateAgentId: string;
  let memberId: string;
  let outsiderId: string;
  let ownerId: string;
  let workspaceId: string;

  beforeEach(async () => {
    db = await getTestDB();
    testDB = db;
    [ownerId, memberId, outsiderId] = await Promise.all([
      createTestUser(db),
      createTestUser(db),
      createTestUser(db),
    ]);
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Agent likes', primaryOwnerId: ownerId, slug: `al-${ownerId}` })
      .returning();
    workspaceId = workspace.id;
    await db.insert(workspaceMembers).values([
      { role: 'owner', userId: ownerId, workspaceId },
      { role: 'member', userId: memberId, workspaceId },
    ]);
    const [shared, privateAgent] = await db
      .insert(agents)
      .values([
        { title: 'Neko', userId: ownerId, workspaceId },
        { title: 'Secret', userId: ownerId, visibility: 'private', workspaceId },
      ])
      .returning();
    agentId = shared.id;
    privateAgentId = privateAgent.id;
  });

  afterEach(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await Promise.all([ownerId, memberId, outsiderId].map((id) => cleanupTestUser(db, id)));
  });

  it('lets members like and unlike a shared agent and reports the summaries', async () => {
    const member = agentLikeRouter.createCaller(context(memberId, workspaceId));
    const owner = agentLikeRouter.createCaller(context(ownerId, workspaceId));

    await expect(member.like({ agentId })).resolves.toEqual({ liked: true, total: 1 });
    await expect(owner.like({ agentId })).resolves.toEqual({ liked: true, total: 2 });
    await expect(member.summaries()).resolves.toEqual({ [agentId]: { liked: true, total: 2 } });

    await expect(member.unlike({ agentId })).resolves.toEqual({ liked: false, total: 1 });
    await expect(member.summaries()).resolves.toEqual({ [agentId]: { liked: false, total: 1 } });
  });

  it('rejects non-members, personal scope and agents the caller cannot view', async () => {
    const outsider = agentLikeRouter.createCaller(context(outsiderId, workspaceId));
    const member = agentLikeRouter.createCaller(context(memberId, workspaceId));
    const personal = agentLikeRouter.createCaller(context(memberId));

    await expect(outsider.like({ agentId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(outsider.summaries()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(personal.summaries()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(member.like({ agentId: privateAgentId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(member.like({ agentId: 'missing-agent' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
