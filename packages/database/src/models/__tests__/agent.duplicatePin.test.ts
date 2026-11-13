// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { AgentGroupRepository } from '../../repositories/agentGroup';
import { agents, chatGroups, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'duplicate-pin-user';
const workspaceId = 'duplicate-pin-ws';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'ws', primaryOwnerId: userId, slug: workspaceId });
});

afterEach(async () => {
  await serverDB.delete(chatGroups);
  await serverDB.delete(agents);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

// In a workspace, `pinned` on a public row is the team pin only owners/admins
// may set, so duplicating a team-pinned row must not mint another one.
describe('duplicating a pinned row', () => {
  it('keeps the pin on a personal agent copy', async () => {
    await serverDB.insert(agents).values({ id: 'src', pinned: true, title: 'A', userId });

    const result = await new AgentModel(serverDB, userId).duplicate('src');
    const copy = await serverDB.query.agents.findFirst({ where: eq(agents.id, result!.agentId) });

    expect(copy?.pinned).toBe(true);
  });

  it('drops the team pin on a workspace agent copy', async () => {
    await serverDB.insert(agents).values({
      id: 'src',
      pinned: true,
      title: 'A',
      userId,
      visibility: 'public',
      workspaceId,
    });

    const result = await new AgentModel(serverDB, userId, workspaceId).duplicate('src');
    const copy = await serverDB.query.agents.findFirst({ where: eq(agents.id, result!.agentId) });

    expect(copy?.workspaceId).toBe(workspaceId);
    expect(copy?.pinned).toBe(false);
  });

  it('drops the team pin on a workspace chat group copy', async () => {
    await serverDB.insert(chatGroups).values({
      id: 'grp',
      pinned: true,
      title: 'G',
      userId,
      visibility: 'public',
      workspaceId,
    });

    const copy = await new AgentGroupRepository(serverDB, userId, workspaceId).duplicate('grp');
    const row = await serverDB.query.chatGroups.findFirst({
      where: eq(chatGroups.id, copy!.groupId),
    });

    expect(row?.pinned).toBe(false);
  });
});
