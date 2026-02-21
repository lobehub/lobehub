import { DEFAULT_AGENT_CONFIG } from '@lobechat/const';
import { and, eq, inArray } from 'drizzle-orm';
import type { LLMParams } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { NewSession, SessionItem } from '../../schemas';
import {
  agents,
  agentsToSessions,
  messages,
  sessionGroups,
  sessions,
  topics,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { idGenerator } from '../../utils/idGenerator';
import { SessionModel } from '../session';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'session-user';
const sessionModel = new SessionModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  // 并创建初始用户
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  // 在每个测试用例之后, 清空用户表 (应该会自动级联删除所有数据)
  await serverDB.delete(users);
});

describe('SessionModel', () => {
  describe('query', () => {
    it('should query sessions by user ID', async () => {
      // 创建一些测试数据
      await serverDB.insert(users).values([{ id: '456' }]);

      await serverDB.insert(sessions).values([
        { id: '1', userId, updatedAt: new Date('2023-01-01') },
        { id: '2', userId, updatedAt: new Date('2023-02-01') },
        { id: '3', userId: '456', updatedAt: new Date('2023-03-01') },
      ]);

      // 调用 query 方法
      const result = await sessionModel.query();

      // 断言结果
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('2');
      expect(result[1].id).toBe('1');
    });

    it('should query sessions with pagination', async () => {
      // create test data
      await serverDB.insert(sessions).values([
        { id: '1', userId, updatedAt: new Date('2023-01-01') },
        { id: '2', userId, updatedAt: new Date('2023-02-01') },
        { id: '3', userId, updatedAt: new Date('2023-03-01') },
      ]);

      // should return 2 sessions
      const result1 = await sessionModel.query({ current: 0, pageSize: 2 });
      expect(result1).toHaveLength(2);

      // should return only 1 session and it's the 2nd one
      const result2 = await sessionModel.query({ current: 1, pageSize: 1 });
      expect(result2).toHaveLength(1);
      expect(result2[0].id).toBe('2');
    });
  });

  describe('queryWithGroups', () => {
    it('should return sessions grouped by group', async () => {
      // 创建测试数据
      await serverDB.transaction(async (trx) => {
        await trx.insert(users).values([{ id: '456' }]);
        await trx.insert(sessionGroups).values([
          { userId, name: 'Group 1', id: 'group1' },
          { userId, name: 'Group 2', id: 'group2' },
        ]);
        await trx.insert(sessions).values([
          { id: '1', userId, groupId: 'group1' },
          { id: '2', userId, groupId: 'group1' },
          { id: '23', userId, groupId: 'group1', pinned: true },
          { id: '3', userId, groupId: 'group2' },
          { id: '4', userId },
          { id: '5', userId, pinned: true },
          { id: '7', userId: '456' },
        ]);
      });

      // 调用 queryWithGroups 方法
      const result = await sessionModel.queryWithGroups();

      // 断言结果
      expect(result.sessions).toHaveLength(6);
      expect(result.sessionGroups).toHaveLength(2);
      expect(result.sessionGroups[0].id).toBe('group1');
      expect(result.sessionGroups[0].name).toBe('Group 1');

      expect(result.sessionGroups[1].id).toBe('group2');
    });

    it('should return empty groups if no sessions', async () => {
      // 调用 queryWithGroups 方法
      const result = await sessionModel.queryWithGroups();

      // 断言结果
      expect(result.sessions).toHaveLength(0);
      expect(result.sessionGroups).toHaveLength(0);
    });

    it('should map group sessions with members correctly', async () => {
      // Create a group session with multiple agents
      await serverDB.transaction(async (trx) => {
        // Create a group session
        await trx.insert(sessions).values({
          id: 'group-session-1',
          userId,
          type: 'group',
          title: 'Test Group',
          description: 'A test group session',
          avatar: 'group-avatar',
          backgroundColor: 'blue',
        });

        // Create agents
        await trx.insert(agents).values([
          { id: 'agent-1', userId, title: 'Agent 1', model: 'gpt-4' },
          { id: 'agent-2', userId, title: 'Agent 2', model: 'gpt-3.5-turbo' },
          { id: 'agent-3', userId, title: 'Agent 3', model: 'claude-2' },
        ]);

        // Link agents to the group session
        await trx.insert(agentsToSessions).values([
          { sessionId: 'group-session-1', agentId: 'agent-1', userId },
          { sessionId: 'group-session-1', agentId: 'agent-2', userId },
          { sessionId: 'group-session-1', agentId: 'agent-3', userId },
        ]);
      });

      const result = await sessionModel.queryWithGroups();

      // Verify group session mapping
      expect(result.sessions).toHaveLength(1);
      const groupSession = result.sessions[0] as any;

      expect(groupSession.type).toBe('group');
      expect(groupSession.meta).toEqual({
        avatar: 'group-avatar',
        backgroundColor: 'blue',
        description: 'A test group session',
        tags: undefined,
        title: 'Test Group',
      });

      // Verify members are mapped correctly
      expect(groupSession.members).toHaveLength(3);
      expect(groupSession.members[0]).toMatchObject({
        agentId: 'agent-1',
        chatGroupId: 'group-session-1',
        enabled: true,
        order: 0,
        role: 'participant',
        title: 'Agent 1',
        model: 'gpt-4',
      });
      expect(groupSession.members[1]).toMatchObject({
        agentId: 'agent-2',
        chatGroupId: 'group-session-1',
        enabled: true,
        order: 1,
        role: 'participant',
        title: 'Agent 2',
        model: 'gpt-3.5-turbo',
      });
      expect(groupSession.members[2]).toMatchObject({
        agentId: 'agent-3',
        chatGroupId: 'group-session-1',
        enabled: true,
        order: 2,
        role: 'participant',
        title: 'Agent 3',
        model: 'claude-2',
      });
    });
  });

  describe('findById', () => {
    it('should find session by ID', async () => {
      await serverDB.insert(sessions).values([
        { id: '1', userId },
        { id: '2', userId },
      ]);

      const result = await sessionModel.findByIdOrSlug('1');
      expect(result?.id).toBe('1');
    });

    it('should return undefined if session not found', async () => {
      await serverDB.insert(sessions).values([{ id: '1', userId }]);

      const result = await sessionModel.findByIdOrSlug('2');
      expect(result).toBeUndefined();
    });

    it('should find with agents', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([
          { id: '1', userId },
          { id: '2', userId },
        ]);
        await trx.insert(agents).values([
          { id: 'a1', title: 'Agent1', userId },
          { id: 'a2', title: 'Agent2', userId },
        ]);

        // @ts-ignore
        await trx.insert(agentsToSessions).values([
          { sessionId: '1', agentId: 'a1', userId },
          { sessionId: '2', agentId: 'a2', userId },
        ]);
      });

      const result = await sessionModel.findByIdOrSlug('2');

      expect(result?.agent).toBeDefined();
      expect(result?.agent.id).toEqual('a2');
    });
  });

  describe('count', () => {
    it('should return the count of sessions for the user', async () => {
      // 创建测试数据
      await serverDB.insert(users).values([{ id: '456' }]);
      await serverDB.insert(sessions).values([
        { id: '1', userId },
        { id: '2', userId },
        { id: '3', userId: '456' },
      ]);

      // 调用 count 方法
      const result = await sessionModel.count();

      // 断言结果
      expect(result).toBe(2);
    });

    it('should return 0 if no sessions exist for the user', async () => {
      // 创建测试数据
      await serverDB.insert(users).values([{ id: '456' }]);
      await serverDB.insert(sessions).values([{ id: '3', userId: '456' }]);

      // 调用 count 方法
      const result = await sessionModel.count();

      // 断言结果
      expect(result).toBe(0);
    });
  });

  describe('queryByKeyword', () => {
    it('should return an empty array if keyword is empty', async () => {
      const result = await sessionModel.queryByKeyword('');
      expect(result).toEqual([]);
    });

    it('should return sessions with matching title', async () => {
      await serverDB.insert(sessions).values([
        { id: '1', userId },
        { id: '2', userId },
      ]);

      await serverDB.insert(agents).values([
        { id: 'agent-1', userId, model: 'gpt-3.5-turbo', title: 'Hello, Agent 1' },
        { id: 'agent-2', userId, model: 'gpt-4', title: 'Agent 2' },
      ]);

      await serverDB.insert(agentsToSessions).values([
        { agentId: 'agent-1', sessionId: '1', userId },
        { agentId: 'agent-2', sessionId: '2', userId },
      ]);

      const result = await sessionModel.queryByKeyword('hello');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('should return sessions with matching description', async () => {
      // The sessions has no title and desc,
      // see: https://github.com/lobehub/lobe-chat/pull/4725
      await serverDB.insert(sessions).values([
        { id: '1', userId },
        { id: '2', userId },
      ]);

      await serverDB.insert(agents).values([
        {
          id: 'agent-1',
          userId,
          model: 'gpt-3.5-turbo',
          title: 'Agent 1',
          description: 'Description with Keyword',
        },
        { id: 'agent-2', userId, model: 'gpt-4', title: 'Agent 2' },
      ]);

      await serverDB.insert(agentsToSessions).values([
        { agentId: 'agent-1', sessionId: '1', userId },
        { agentId: 'agent-2', sessionId: '2', userId },
      ]);

      const result = await sessionModel.queryByKeyword('keyword');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('should return sessions with matching title or description', async () => {
      await serverDB.insert(sessions).values([
        { id: '1', userId },
        { id: '2', userId },
        { id: '3', userId },
      ]);

      await serverDB.insert(agents).values([
        { id: '1', userId, title: 'Title with keyword', description: 'Some description' },
        { id: '2', userId, title: 'Another Session', description: 'Description with keyword' },
        { id: '3', userId, title: 'Third Session', description: 'Third description' },
      ]);

      await serverDB.insert(agentsToSessions).values([
        { agentId: '1', sessionId: '1', userId },
        { agentId: '2', sessionId: '2', userId },
        { agentId: '3', sessionId: '3', userId },
      ]);

      const result = await sessionModel.queryByKeyword('keyword');
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual(['1', '2']);
    });
  });

  describe('create', () => {
    it('should create a new session', async () => {
      // 调用 create 方法
      const result = await sessionModel.create({
        type: 'agent',
        session: {
          title: 'New Session',
        },
        config: { model: 'gpt-3.5-turbo' },
      });

      // 断言结果
      const sessionId = result.id;
      expect(sessionId).toBeDefined();
      expect(sessionId.startsWith('ssn_')).toBeTruthy();
      expect(result.userId).toBe(userId);
      expect(result.type).toBe('agent');

      const session = await sessionModel.findByIdOrSlug(sessionId);
      expect(session).toBeDefined();
      expect(session?.title).toEqual('New Session');
      expect(session?.pinned).toBe(false);
      expect(session?.agent?.model).toEqual('gpt-3.5-turbo');
    });

    it('should create a new session with custom ID', async () => {
      // 调用 create 方法,传入自定义 ID
      const customId = 'custom-id';
      const result = await sessionModel.create({
        type: 'agent',
        config: { model: 'gpt-3.5-turbo' },
        session: { title: 'New Session' },
        id: customId,
      });

      // 断言结果
      expect(result.id).toBe(customId);
    });

    it('should create a session associated with a group', async () => {
      await serverDB.insert(sessionGroups).values({
        id: 'session-group-1',
        name: 'Session Group',
        userId,
      });

      const result = await sessionModel.create({
        type: 'agent',
        config: { model: 'gpt-3.5-turbo' },
        session: { title: 'Grouped Session', groupId: 'session-group-1' },
      });

      expect(result.groupId).toBe('session-group-1');

      const fetched = await sessionModel.findByIdOrSlug(result.id);
      const fetchedWithGroup = fetched as typeof fetched & {
        group?: { id: string | null } | null;
      };
      expect(fetchedWithGroup?.group?.id).toBe('session-group-1');
    });

    it('should create a group-type session', async () => {
      const result = await sessionModel.create({
        type: 'group',
        session: {
          title: 'Group Chat Session',
          description: 'Multi-agent group chat',
        },
      });

      expect(result.id).toBeDefined();
      expect(result.userId).toBe(userId);
      expect(result.type).toBe('group');
      expect(result.title).toBe('Group Chat Session');
      expect(result.description).toBe('Multi-agent group chat');

      // Verify group session was created
      const fetched = await sessionModel.findByIdOrSlug(result.id);
      expect(fetched).toBeDefined();
      expect(fetched?.type).toBe('group');
    });

    it('should return existing session if slug already exists', async () => {
      // Create a session with a slug
      const first = await sessionModel.create({
        type: 'agent',
        config: { model: 'gpt-4' },
        session: { title: 'First Session' },
        slug: 'test-slug',
      });

      // Try to create another session with the same slug
      const second = await sessionModel.create({
        type: 'agent',
        config: { model: 'gpt-3.5-turbo' },
        session: { title: 'Second Session' },
        slug: 'test-slug',
      });

      // Should return the existing session
      expect(second.id).toBe(first.id);
      expect(second.title).toBe('First Session');
    });
  });

  describe('batchCreate', () => {
    it('should batch create sessions', async () => {
      // 调用 batchCreate 方法
      const sessions: NewSession[] = [
        {
          id: '1',
          userId,
          type: 'agent',
          // config: { model: 'gpt-3.5-turbo' },
          title: 'Session 1',
        },
        {
          id: '2',
          userId,
          type: 'agent',
          // config: { model: 'gpt-4' },
          title: 'Session 2',
        },
      ];
      const result = await sessionModel.batchCreate(sessions);

      // 断言结果
      // pglite return affectedRows while postgres return rowCount
      expect((result as any).affectedRows || result.rowCount).toEqual(2);
    });

    it.skip('should set group to default if group does not exist', async () => {
      // 调用 batchCreate 方法,传入不存在的 group
      const sessions: NewSession[] = [
        {
          id: '1',
          userId,
          type: 'agent',
          // config: { model: 'gpt-3.5-turbo' },
          title: 'Session 1',
          groupId: 'non-existent-group',
        },
      ];
      const result = await sessionModel.batchCreate(sessions);

      // 断言结果
      // expect(result[0].group).toBe('default');
    });
  });

  describe('duplicate', () => {
    it('should duplicate a session', async () => {
      // 创建一个用户和一个 session
      await serverDB.transaction(async (trx) => {
        await trx
          .insert(sessions)
          .values({ id: '1', userId, type: 'agent', title: 'Original Session', pinned: true });
        await trx.insert(agents).values({ id: 'agent-1', userId, model: 'gpt-3.5-turbo' });
        await trx.insert(agentsToSessions).values({ agentId: 'agent-1', sessionId: '1', userId });
      });

      // 调用 duplicate 方法
      const result = (await sessionModel.duplicate('1', 'Duplicated Session')) as SessionItem;

      // 断言结果
      expect(result.id).not.toBe('1');
      expect(result.userId).toBe(userId);
      expect(result.type).toBe('agent');

      const session = await sessionModel.findByIdOrSlug(result.id);

      expect(session).toBeDefined();
      expect(session?.title).toEqual('Duplicated Session');
      expect(session?.pinned).toBe(true);
      expect(session?.agent?.model).toEqual('gpt-3.5-turbo');
    });

    it('should return undefined if session does not exist', async () => {
      // 调用 duplicate 方法,传入不存在的 session ID
      const result = await sessionModel.duplicate('non-existent-id');

      // 断言结果
      expect(result).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update a session', async () => {
      // 创建一个测试 session
      const sessionId = '123';
      await serverDB.insert(sessions).values({ userId, id: sessionId, title: 'Test Session' });

      // 调用 update 方法更新 session
      const updatedSessions = await sessionModel.update(sessionId, {
        title: 'Updated Test Session',
        description: 'This is an updated test session',
      });

      // 断言更新后的结果
      expect(updatedSessions).toHaveLength(1);
      expect(updatedSessions[0].title).toBe('Updated Test Session');
      expect(updatedSessions[0].description).toBe('This is an updated test session');
    });

    it('should not update a session if user ID does not match', async () => {
      // 创建一个测试 session,但使用不同的 user ID
      await serverDB.insert(users).values([{ id: '777' }]);

      const sessionId = '123';

      await serverDB
        .insert(sessions)
        .values({ userId: '777', id: sessionId, title: 'Test Session' });

      // 尝试更新这个 session,应该不会有任何更新
      const updatedSessions = await sessionModel.update(sessionId, {
        title: 'Updated Test Session',
      });

      expect(updatedSessions).toHaveLength(0);
    });
  });

  describe('delete', () => {
    it('should handle deleting a session with no associated messages or topics', async () => {
      // 创建测试数据
      await serverDB.insert(sessions).values({ id: '1', userId });

      // 调用 delete 方法
      await sessionModel.delete('1');

      // 断言删除结果
      const result = await serverDB.select({ id: sessions.id }).from(sessions);

      expect(result).toHaveLength(0);
    });

    it('should handle concurrent deletions gracefully', async () => {
      // 创建测试数据
      await serverDB.insert(sessions).values({ id: '1', userId });

      // 并发调用 delete 方法
      await Promise.all([sessionModel.delete('1'), sessionModel.delete('1')]);

      // 断言删除结果
      const result = await serverDB.select({ id: sessions.id }).from(sessions);

      expect(result).toHaveLength(0);
    });

    it('should delete a session and its associated topics and messages', async () => {
      // Create a session
      const sessionId = '1';
      await serverDB.insert(users).values([{ id: '456' }]);
      await serverDB.insert(sessions).values({ id: sessionId, userId });

      // Create some topics and messages associated with the session
      await serverDB.insert(topics).values([
        { id: '1', sessionId, userId },
        { id: '2', sessionId, userId },
      ]);
      await serverDB.insert(messages).values([
        { id: '1', sessionId, userId, role: 'user' },
        { id: '2', sessionId, userId, role: 'assistant' },
      ]);
      await serverDB.insert(agents).values([
        { id: 'a1', userId },
        { id: 'a2', userId: '456' },
      ]);
      await serverDB.insert(agentsToSessions).values([{ agentId: 'a1', userId, sessionId: '1' }]);

      // Delete the session
      await sessionModel.delete(sessionId);

      // Check that the session, topics, and messages are deleted
      expect(await serverDB.select().from(sessions).where(eq(sessions.id, sessionId))).toHaveLength(
        0,
      );
      expect(
        await serverDB.select().from(topics).where(eq(topics.sessionId, sessionId)),
      ).toHaveLength(0);
      expect(
        await serverDB.select().from(messages).where(eq(messages.sessionId, sessionId)),
      ).toHaveLength(0);
      expect(await serverDB.select().from(agents).where(eq(agents.userId, userId))).toHaveLength(0);
    });

    it('should not delete sessions belonging to other users', async () => {
      // Create two users
      const anotherUserId = idGenerator('user');
      await serverDB.insert(users).values({ id: anotherUserId });

      // Create a session for each user
      await serverDB.insert(sessions).values([
        { id: '1', userId },
        { id: '2', userId: anotherUserId },
      ]);

      // Delete the session belonging to the current user
      await sessionModel.delete('1');

      // Check that only the session belonging to the current user is deleted
      expect(await serverDB.select().from(sessions).where(eq(sessions.id, '1'))).toHaveLength(0);
      expect(await serverDB.select().from(sessions).where(eq(sessions.id, '2'))).toHaveLength(1);
    });
  });

  describe('batchDelete', () => {
    it('should handle deleting sessions with no associated messages or topics', async () => {
      // 创建测试数据
      await serverDB.insert(sessions).values([
        { id: '1', userId },
        { id: '2', userId },
      ]);

      // 调用 batchDelete 方法
      await sessionModel.batchDelete(['1', '2']);

      // 断言删除结果
      const result = await serverDB.select({ id: sessions.id }).from(sessions);

      expect(result).toHaveLength(0);
    });

    it('should handle concurrent batch deletions gracefully', async () => {
      // 创建测试数据
      await serverDB.insert(sessions).values([
        { id: '1', userId },
        { id: '2', userId },
      ]);

      // 并发调用 batchDelete 方法
      await Promise.all([
        sessionModel.batchDelete(['1', '2']),
        sessionModel.batchDelete(['1', '2']),
      ]);

      // 断言删除结果
      const result = await serverDB.select({ id: sessions.id }).from(sessions);

      expect(result).toHaveLength(0);
    });

    it('should delete multiple sessions and their associated topics and messages', async () => {
      // Create some sessions
      const sessionIds = ['1', '2', '3'];
      await serverDB.insert(sessions).values(sessionIds.map((id) => ({ id, userId })));
      await serverDB.insert(agents).values([{ id: '1', userId }]);
      await serverDB.insert(agentsToSessions).values([{ sessionId: '1', agentId: '1', userId }]);

      // Create some topics and messages associated with the sessions
      await serverDB.insert(topics).values([
        { id: '1', sessionId: '1', userId },
        { id: '2', sessionId: '2', userId },
        { id: '3', sessionId: '3', userId },
      ]);
      await serverDB.insert(messages).values([
        { id: '1', sessionId: '1', userId, role: 'user' },
        { id: '2', sessionId: '2', userId, role: 'assistant' },
        { id: '3', sessionId: '3', userId, role: 'user' },
      ]);

      // Delete the sessions
      await sessionModel.batchDelete(sessionIds);

      // Check that the sessions, topics, and messages are deleted
      expect(
        await serverDB.select().from(sessions).where(inArray(sessions.id, sessionIds)),
      ).toHaveLength(0);
      expect(
        await serverDB.select().from(topics).where(inArray(topics.sessionId, sessionIds)),
      ).toHaveLength(0);
      expect(
        await serverDB.select().from(messages).where(inArray(messages.sessionId, sessionIds)),
      ).toHaveLength(0);
      expect(await serverDB.select().from(agents)).toHaveLength(0);
    });

    it('should not delete sessions belonging to other users', async () => {
      // Create two users
      await serverDB.insert(users).values([{ id: '456' }]);

      // Create some sessions for each user
      await serverDB.insert(sessions).values([
        { id: '1', userId },
        { id: '2', userId },
        { id: '3', userId: '456' },
      ]);

      // Delete the sessions belonging to the current user
      await sessionModel.batchDelete(['1', '2']);

      // Check that only the sessions belonging to the current user are deleted
      expect(
        await serverDB
          .select()
          .from(sessions)
          .where(inArray(sessions.id, ['1', '2'])),
      ).toHaveLength(0);
      expect(await serverDB.select().from(sessions).where(eq(sessions.id, '3'))).toHaveLength(1);
    });
  });

  describe('createInbox', () => {
    it('should create inbox session if not exists', async () => {
      const inbox = await sessionModel.createInbox({});

      expect(inbox).toBeDefined();
      expect(inbox?.slug).toBe('inbox');

      // verify agent config
      const session = await sessionModel.findByIdOrSlug('inbox');
      expect(session?.agent).toBeDefined();
      expect(session?.agent.model).toBe(DEFAULT_AGENT_CONFIG.model);
    });

    it('should not create duplicate inbox session', async () => {
      // Create first inbox
      await sessionModel.createInbox({});

      // Try to create another inbox
      const duplicateInbox = await sessionModel.createInbox({});

      // Should return undefined as inbox already exists
      expect(duplicateInbox).toBeUndefined();

      // Verify only one inbox exists
      const sessions = await serverDB.query.sessions.findMany();

      const inboxSessions = sessions.filter((s) => s.slug === 'inbox');
      expect(inboxSessions).toHaveLength(1);
    });
  });

  describe('deleteAll', () => {
    it('should delete all sessions for current user', async () => {
      // Create test data
      await serverDB.insert(sessions).values([
        { id: '1', userId },
        { id: '2', userId },
        { id: '3', userId },
      ]);

      // Create sessions for another user that should not be deleted
      await serverDB.insert(users).values([{ id: 'other-user' }]);
      await serverDB.insert(sessions).values([
        { id: '4', userId: 'other-user' },
        { id: '5', userId: 'other-user' },
      ]);

      await sessionModel.deleteAll();

      // Verify all sessions for current user are deleted
      const remainingSessions = await serverDB
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId));
      expect(remainingSessions).toHaveLength(0);

      // Verify other user's sessions are not deleted
      const otherUserSessions = await serverDB
        .select()
        .from(sessions)
        .where(eq(sessions.userId, 'other-user'));
      expect(otherUserSessions).toHaveLength(2);
    });

    it('should delete associated data when deleting all sessions', async () => {
      // Create test data with associated records
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([
          { id: '1', userId },
          { id: '2', userId },
        ]);

        await trx.insert(topics).values([
          { id: 't1', sessionId: '1', userId },
          { id: 't2', sessionId: '2', userId },
        ]);

        await trx.insert(messages).values([
          { id: 'm1', sessionId: '1', userId, role: 'user' },
          { id: 'm2', sessionId: '2', userId, role: 'assistant' },
        ]);
        await trx.insert(agents).values([
          { id: 'a1', userId },
          { id: 'a2', userId },
        ]);
        await trx.insert(agentsToSessions).values([
          { agentId: 'a1', sessionId: '1', userId },
          { agentId: 'a2', sessionId: '2', userId },
        ]);
      });

      await sessionModel.deleteAll();

      // Verify all associated data is deleted
      const remainingTopics = await serverDB.select().from(topics).where(eq(topics.userId, userId));
      expect(remainingTopics).toHaveLength(0);

      const remainingMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.userId, userId));
      expect(remainingMessages).toHaveLength(0);

      const agentsTopics = await serverDB.select().from(agents).where(eq(agents.userId, userId));
      expect(agentsTopics).toHaveLength(0);
    });
  });

  describe('updateConfig', () => {
    it('should update agent config via sessionId', async () => {
      // Create test session with agent
      const sessionId = 'test-session';
      const agentId = 'test-agent';

      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values({
          id: sessionId,
          userId,
          type: 'agent',
        });

        await trx.insert(agents).values({
          id: agentId,
          userId,
          model: 'gpt-3.5-turbo',
          title: 'Original Title',
          description: 'Original description',
        });

        await trx.insert(agentsToSessions).values({
          sessionId,
          agentId,
          userId,
        });
      });

      // Update config using sessionId
      await sessionModel.updateConfig(sessionId, {
        model: 'gpt-4',
        title: 'Updated Title',
        description: 'New description',
      });

      // Verify update
      const updatedAgent = await serverDB
        .select()
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.userId, userId)));

      expect(updatedAgent[0]).toMatchObject({
        model: 'gpt-4',
        title: 'Updated Title',
        description: 'New description',
      });
    });

    it('should merge config with existing agent config', async () => {
      // Create test session with agent having existing config
      const sessionId = 'test-session-merge';
      const agentId = 'test-agent-merge';

      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values({
          id: sessionId,
          userId,
          type: 'agent',
        });

        await trx.insert(agents).values({
          id: agentId,
          userId,
          model: 'gpt-3.5-turbo',
          title: 'Original Title',
          description: 'Original description',
          systemRole: 'Original role',
        });

        await trx.insert(agentsToSessions).values({
          sessionId,
          agentId,
          userId,
        });
      });

      // Update only some fields
      await sessionModel.updateConfig(sessionId, {
        model: 'gpt-4',
        title: 'Updated Title',
        // Don't update description and systemRole
      });

      // Verify merge behavior - updated fields changed, others preserved
      const updatedAgent = await serverDB
        .select()
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.userId, userId)));

      expect(updatedAgent[0]).toMatchObject({
        model: 'gpt-4',
        title: 'Updated Title',
        description: 'Original description', // Should be preserved
        systemRole: 'Original role', // Should be preserved
      });
    });

    it('should return early if session does not exist', async () => {
      // Try to update config for non-existent session
      const result = await sessionModel.updateConfig('non-existent-session', {
        model: 'gpt-4',
        title: 'Updated Title',
      });

      // Should return undefined/early without throwing
      expect(result).toBeUndefined();
    });

    it('should properly delete params when value is undefined', async () => {
      // Create test session with agent having params
      const sessionId = 'test-session-delete-params';
      const agentId = 'test-agent-delete-params';

      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values({
          id: sessionId,
          userId,
          type: 'agent',
        });

        await trx.insert(agents).values({
          id: agentId,
          userId,
          model: 'gpt-3.5-turbo',
          title: 'Test Agent',
          params: {
            temperature: 0.7,
            top_p: 1,
            presence_penalty: 0,
            frequency_penalty: 0,
          },
        });

        await trx.insert(agentsToSessions).values({
          sessionId,
          agentId,
          userId,
        });
      });

      // Update config with temperature set to undefined (delete it)
      await sessionModel.updateConfig(sessionId, {
        params: {
          temperature: undefined,
        },
      });

      // Verify temperature was deleted while other params remain
      const updatedAgent = await serverDB
        .select()
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.userId, userId)));

      expect(updatedAgent[0].params).toMatchObject({
        top_p: 1,
        presence_penalty: 0,
        frequency_penalty: 0,
      });
      expect(updatedAgent[0].params).not.toHaveProperty('temperature');
    });

    it('should mark params as null when value is null', async () => {
      // Create test session with agent having params
      const sessionId = 'test-session-delete-params-null';
      const agentId = 'test-agent-delete-params-null';

      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values({
          id: sessionId,
          userId,
          type: 'agent',
        });

        await trx.insert(agents).values({
          id: agentId,
          userId,
          model: 'gpt-3.5-turbo',
          title: 'Test Agent',
          params: {
            temperature: 0.7,
            top_p: 1,
            presence_penalty: 0,
            frequency_penalty: 0,
          },
        });

        await trx.insert(agentsToSessions).values({
          sessionId,
          agentId,
          userId,
        });
      });

      // Update config with temperature set to null (mark it as disabled)
      await sessionModel.updateConfig(sessionId, {
        params: {
          temperature: null,
        } as any,
      });

      // Verify temperature is marked as null while other params remain untouched
      const updatedAgent = await serverDB
        .select()
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.userId, userId)));

      expect(updatedAgent[0].params).toMatchObject({
        top_p: 1,
        presence_penalty: 0,
        frequency_penalty: 0,
        temperature: null,
      });
      expect((updatedAgent[0].params as LLMParams)?.temperature).toBeNull();
    });

    it('should throw error if session has no associated agent', async () => {
      // Create session without agent
      const sessionId = 'session-no-agent';

      await serverDB.insert(sessions).values({
        id: sessionId,
        userId,
        type: 'agent',
      });

      // Try to update config - should throw error
      await expect(
        sessionModel.updateConfig(sessionId, {
          model: 'gpt-4',
          title: 'Updated Title',
        }),
      ).rejects.toThrow(
        'this session is not assign with agent, please contact with admin to fix this issue.',
      );
    });

    it('should return early if data is null or undefined', async () => {
      // Create test session with agent
      const sessionId = 'test-session-null';
      const agentId = 'test-agent-null';

      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values({
          id: sessionId,
          userId,
          type: 'agent',
        });

        await trx.insert(agents).values({
          id: agentId,
          userId,
          model: 'gpt-3.5-turbo',
          title: 'Original Title',
        });

        await trx.insert(agentsToSessions).values({
          sessionId,
          agentId,
          userId,
        });
      });

      // Test with null data
      const result1 = await sessionModel.updateConfig(sessionId, null);
      expect(result1).toBeUndefined();

      // Test with undefined data
      const result2 = await sessionModel.updateConfig(sessionId, undefined);
      expect(result2).toBeUndefined();

      // Test with empty object
      const result3 = await sessionModel.updateConfig(sessionId, {});
      expect(result3).toBeUndefined();
    });

    it('should not update config for other users sessions', async () => {
      // Create agent for another user
      const sessionId = 'other-session';
      const agentId = 'other-agent';
      await serverDB.insert(users).values([{ id: 'other-user' }]);

      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values({
          id: sessionId,
          userId: 'other-user',
          type: 'agent',
        });

        await trx.insert(agents).values({
          id: agentId,
          userId: 'other-user',
          model: 'gpt-3.5-turbo',
          title: 'Original Title',
        });

        await trx.insert(agentsToSessions).values({
          sessionId,
          agentId,
          userId: 'other-user',
        });
      });

      // Try to update other user's session - should return early
      const result = await sessionModel.updateConfig(sessionId, {
        model: 'gpt-4',
        title: 'Updated Title',
      });

      // Should return undefined as session doesn't belong to current user
      expect(result).toBeUndefined();

      // Verify no changes were made
      const agent = await serverDB.select().from(agents).where(eq(agents.id, agentId));

      expect(agent[0]).toMatchObject({
        model: 'gpt-3.5-turbo',
        title: 'Original Title',
      });
    });
  });

  describe('rank', () => {
    it('should return ranked sessions based on topic count', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        // Create sessions
        await trx.insert(sessions).values([
          { id: '1', userId },
          { id: '2', userId },
          { id: '3', userId },
        ]);

        // Create agents
        await trx.insert(agents).values([
          { id: 'a1', userId, title: 'Agent 1', avatar: 'avatar1', backgroundColor: 'bg1' },
          { id: 'a2', userId, title: 'Agent 2', avatar: 'avatar2', backgroundColor: 'bg2' },
          { id: 'a3', userId, title: 'Agent 3', avatar: 'avatar3', backgroundColor: 'bg3' },
        ]);

        // Link agents to sessions
        await trx.insert(agentsToSessions).values([
          { sessionId: '1', agentId: 'a1', userId },
          { sessionId: '2', agentId: 'a2', userId },
          { sessionId: '3', agentId: 'a3', userId },
        ]);

        // Create topics (different counts for ranking)
        await trx.insert(topics).values([
          { id: 't1', sessionId: '1', userId },
          { id: 't2', sessionId: '1', userId },
          { id: 't3', sessionId: '1', userId }, // Session 1 has 3 topics
          { id: 't4', sessionId: '2', userId },
          { id: 't5', sessionId: '2', userId }, // Session 2 has 2 topics
          { id: 't6', sessionId: '3', userId }, // Session 3 has 1 topic
        ]);
      });

      // Get ranked sessions with default limit
      const result = await sessionModel.rank();

      // Verify results
      expect(result).toHaveLength(3);
      // Should be ordered by topic count (descending)
      expect(result[0]).toMatchObject({
        id: '1',
        count: 3,
        title: 'Agent 1',
        avatar: 'avatar1',
        backgroundColor: 'bg1',
      });
      expect(result[1]).toMatchObject({
        id: '2',
        count: 2,
        title: 'Agent 2',
        avatar: 'avatar2',
        backgroundColor: 'bg2',
      });
      expect(result[2]).toMatchObject({
        id: '3',
        count: 1,
        title: 'Agent 3',
        avatar: 'avatar3',
        backgroundColor: 'bg3',
      });
    });

    it('should respect the limit parameter', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        // Create sessions and related data
        await trx.insert(sessions).values([
          { id: '1', userId },
          { id: '2', userId },
          { id: '3', userId },
        ]);

        await trx.insert(agents).values([
          { id: 'a1', userId, title: 'Agent 1' },
          { id: 'a2', userId, title: 'Agent 2' },
          { id: 'a3', userId, title: 'Agent 3' },
        ]);

        await trx.insert(agentsToSessions).values([
          { sessionId: '1', agentId: 'a1', userId },
          { sessionId: '2', agentId: 'a2', userId },
          { sessionId: '3', agentId: 'a3', userId },
        ]);

        await trx.insert(topics).values([
          { id: 't1', sessionId: '1', userId },
          { id: 't2', sessionId: '1', userId },
          { id: 't6', sessionId: '1', userId },
          { id: 't3', sessionId: '2', userId },
          { id: 't8', sessionId: '2', userId },
          { id: 't4', sessionId: '3', userId },
        ]);
      });

      // Get ranked sessions with limit of 2
      const result = await sessionModel.rank(2);

      // Verify results
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('1'); // Most topics (2)
      expect(result[1].id).toBe('2'); // Second most topics (1)
    });

    it('should handle sessions with no topics', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([
          { id: '1', userId },
          { id: '2', userId },
        ]);

        await trx.insert(agents).values([
          { id: 'a1', userId, title: 'Agent 1' },
          { id: 'a2', userId, title: 'Agent 2' },
        ]);

        await trx.insert(agentsToSessions).values([
          { sessionId: '1', agentId: 'a1', userId },
          { sessionId: '2', agentId: 'a2', userId },
        ]);

        // No topics created
      });

      const result = await sessionModel.rank();

      expect(result).toHaveLength(0);
    });
  });

  describe('hasMoreThanN', () => {
    it('should return true when session count is more than N', async () => {
      // Create test data
      await serverDB.insert(sessions).values([
        { id: '1', userId },
        { id: '2', userId },
        { id: '3', userId },
      ]);

      const result = await sessionModel.hasMoreThanN(2);
      expect(result).toBe(true);
    });

    it('should return false when session count is equal to N', async () => {
      // Create test data
      await serverDB.insert(sessions).values([
        { id: '1', userId },
        { id: '2', userId },
      ]);

      const result = await sessionModel.hasMoreThanN(2);
      expect(result).toBe(false);
    });

    it('should return false when session count is less than N', async () => {
      // Create test data
      await serverDB.insert(sessions).values([{ id: '1', userId }]);

      const result = await sessionModel.hasMoreThanN(2);
      expect(result).toBe(false);
    });

    it('should only count sessions for the current user', async () => {
      // Create sessions for current user and another user
      await serverDB.transaction(async (trx) => {
        await trx.insert(users).values([{ id: 'other-user' }]);
        await trx.insert(sessions).values([
          { id: '1', userId }, // Current user
          { id: '2', userId: 'other-user' }, // Other user
          { id: '3', userId: 'other-user' }, // Other user
        ]);
      });

      const result = await sessionModel.hasMoreThanN(1);
      // Should return false as current user only has 1 session
      expect(result).toBe(false);
    });

    it('should return false when no sessions exist', async () => {
      const result = await sessionModel.hasMoreThanN(0);
      expect(result).toBe(false);
    });
  });

  describe('findSessionsByKeywords', () => {
    it('should handle errors gracefully and return empty array', async () => {
      // 这个测试旨在覆盖 findSessionsByKeywords 中的错误处理逻辑
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Mock the database query to throw an error
      const originalFindMany = serverDB.query.agents.findMany;
      serverDB.query.agents.findMany = vi.fn().mockRejectedValue(new Error('Database error'));

      const result = await sessionModel.findSessionsByKeywords({ keyword: 'test' });

      // 即使发生错误，方法也应该返回一个空数组
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith('findSessionsByKeywords error:', expect.any(Error), {
        keyword: 'test',
      });

      // Restore original method
      serverDB.query.agents.findMany = originalFindMany;
      consoleSpy.mockRestore();
    });

    it('should return empty array for empty keyword', async () => {
      const result = await sessionModel.queryByKeyword('');
      expect(result).toEqual([]);
    });
  });
});
