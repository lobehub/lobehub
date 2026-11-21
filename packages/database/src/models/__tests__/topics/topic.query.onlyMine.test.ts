import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, chatGroups, messages, topics, users, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';

const userId = 'topic-only-mine-user';
const userId2 = 'topic-only-mine-user-2';
const workspaceId = 'topic-only-mine-workspace';
const serverDB: LobeChatDatabase = await getTestDB();
const topicModel = new TopicModel(serverDB, userId, workspaceId);
const isServerDB = process.env.TEST_SERVER_DB === '1';

describe('TopicModel - query onlyMine', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.transaction(async (tx) => {
      await tx.insert(users).values([{ id: userId }, { id: userId2 }]);
      await tx.insert(workspaces).values({
        id: workspaceId,
        name: 'Topic Only Mine Workspace',
        primaryOwnerId: userId,
        slug: workspaceId,
      });
      await tx.insert(agents).values({ id: 'ws-agent', userId, workspaceId });
      await tx.insert(chatGroups).values({
        id: 'ws-group',
        title: 'Workspace Group',
        userId,
        workspaceId,
      });
      await tx.insert(topics).values([
        { agentId: 'ws-agent', id: 'agent-mine', userId, workspaceId },
        { agentId: 'ws-agent', id: 'agent-other', userId: userId2, workspaceId },
        { groupId: 'ws-group', id: 'group-mine', userId, workspaceId },
        { groupId: 'ws-group', id: 'group-other', userId: userId2, workspaceId },
      ]);
    });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('lists every member topic under a workspace agent by default', async () => {
    const result = await topicModel.query({ agentId: 'ws-agent' });

    expect(result.items.map((topic) => topic.id).sort()).toEqual(['agent-mine', 'agent-other']);
    expect(result.total).toBe(2);
  });

  it('keeps only the caller topics under an agent when onlyMine is set', async () => {
    const result = await topicModel.query({ agentId: 'ws-agent', onlyMine: true });

    expect(result.items.map((topic) => topic.id)).toEqual(['agent-mine']);
    expect(result.total).toBe(1);
  });

  it('keeps only the caller topics under a group when onlyMine is set', async () => {
    const result = await topicModel.query({ groupId: 'ws-group', onlyMine: true });

    expect(result.items.map((topic) => topic.id)).toEqual(['group-mine']);
    expect(result.total).toBe(1);
  });

  // Keyword search uses pg_search (BM25), which only the server test DB has.
  describe.skipIf(!isServerDB)('queryByKeyword', () => {
    beforeEach(async () => {
      await serverDB.insert(topics).values([
        { agentId: 'ws-agent', id: 'search-mine', title: 'Release plan', userId, workspaceId },
        {
          agentId: 'ws-agent',
          id: 'search-other',
          title: 'Release retro',
          userId: userId2,
          workspaceId,
        },
      ]);
      await serverDB.insert(messages).values([
        {
          content: 'release checklist',
          id: 'msg-other',
          role: 'user',
          topicId: 'agent-other',
          userId: userId2,
          workspaceId,
        },
      ]);
    });

    it('finds every member topic by default', async () => {
      const result = await topicModel.queryByKeyword('release', { agentId: 'ws-agent' });

      expect(result.map((topic) => topic.id).sort()).toEqual([
        'agent-other',
        'search-mine',
        'search-other',
      ]);
    });

    /** @example With "only mine" on, a search must not bring back teammates' topics the list hides. */
    it('keeps only the caller topics, by title and by message, when onlyMine is set', async () => {
      const result = await topicModel.queryByKeyword(
        'release',
        { agentId: 'ws-agent' },
        { onlyMine: true },
      );

      expect(result.map((topic) => topic.id)).toEqual(['search-mine']);
    });
  });
});
