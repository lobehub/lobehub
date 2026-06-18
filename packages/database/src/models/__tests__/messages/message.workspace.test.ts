// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messages, sessions, topics, users, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-workspace-user';
const workspaceId = 'message-workspace';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Workspace',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
  await serverDB.insert(sessions).values([
    { id: 'personal-session', userId, workspaceId: null },
    { id: 'workspace-session', userId, workspaceId },
  ]);
  await serverDB.insert(topics).values([
    { id: 'personal-topic', sessionId: 'personal-session', userId, workspaceId: null },
    { id: 'workspace-topic', sessionId: 'workspace-session', userId, workspaceId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('MessageModel workspace scope', () => {
  it('isolates personal and workspace messages for the same user', async () => {
    await serverDB.insert(messages).values([
      {
        content: 'personal',
        id: 'personal-message',
        role: 'user',
        sessionId: 'personal-session',
        topicId: 'personal-topic',
        userId,
        workspaceId: null,
      },
      {
        content: 'workspace',
        id: 'workspace-message',
        role: 'user',
        sessionId: 'workspace-session',
        topicId: 'workspace-topic',
        userId,
        workspaceId,
      },
    ]);

    await expect(
      new MessageModel(serverDB, userId).query({
        sessionId: 'personal-session',
        topicId: 'personal-topic',
      }),
    ).resolves.toEqual([expect.objectContaining({ id: 'personal-message' })]);
    await expect(
      new MessageModel(serverDB, userId, workspaceId).query({
        sessionId: 'workspace-session',
        topicId: 'workspace-topic',
      }),
    ).resolves.toEqual([expect.objectContaining({ id: 'workspace-message' })]);
  });
});
