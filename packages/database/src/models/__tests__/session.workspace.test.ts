// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, agentsToSessions, sessions, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { SessionModel } from '../session';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'session-workspace-user';
const workspaceId = 'session-workspace';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Workspace',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('SessionModel workspace scope', () => {
  it('isolates personal and workspace sessions for the same user', async () => {
    await serverDB.insert(sessions).values([
      { id: 'personal-session', updatedAt: new Date('2023-01-01'), userId, workspaceId: null },
      {
        id: 'workspace-session',
        updatedAt: new Date('2023-02-01'),
        userId,
        workspaceId,
      },
    ]);

    await expect(new SessionModel(serverDB, userId).query()).resolves.toEqual([
      expect.objectContaining({ id: 'personal-session' }),
    ]);
    await expect(new SessionModel(serverDB, userId, workspaceId).query()).resolves.toEqual([
      expect.objectContaining({ id: 'workspace-session' }),
    ]);
  });

  it('deleteAll on personal scope does not delete workspace sessions or links', async () => {
    await serverDB.transaction(async (trx) => {
      await trx.insert(sessions).values([
        { id: 'personal-session', updatedAt: new Date('2023-01-01'), userId, workspaceId: null },
        {
          id: 'workspace-session',
          updatedAt: new Date('2023-02-01'),
          userId,
          workspaceId,
        },
      ]);
      await trx.insert(agents).values([
        { id: 'personal-agent', userId, title: 'Personal Agent', workspaceId: null },
        { id: 'workspace-agent', userId, title: 'Workspace Agent', workspaceId },
      ]);
      await trx.insert(agentsToSessions).values([
        { agentId: 'personal-agent', sessionId: 'personal-session', userId, workspaceId: null },
        { agentId: 'workspace-agent', sessionId: 'workspace-session', userId, workspaceId },
      ]);
    });

    await new SessionModel(serverDB, userId).deleteAll();

    await expect(serverDB.select().from(sessions)).resolves.toEqual([
      expect.objectContaining({ id: 'workspace-session', workspaceId }),
    ]);
    await expect(serverDB.select().from(agentsToSessions)).resolves.toEqual([
      expect.objectContaining({ agentId: 'workspace-agent', sessionId: 'workspace-session' }),
    ]);
  });
});
