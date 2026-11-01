import { DEFAULT_AGENT_CONFIG } from '@lobechat/const';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
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
  // and create the initial user
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  // After each test case, clear the users table (should auto-cascade delete all data)
  await serverDB.delete(users);
});

describe('SessionModel', () => {
  describe('query', () => {
    it('should query sessions by user ID', async () => {
      // Create some test data
      await serverDB.insert(users).values([{ id: '456' }]);

      await serverDB.insert(sessions).values([
        { id: '1', userId, updatedAt: new Date('2023-01-01') },
        { id: '2', userId, updatedAt: new Date('2023-02-01') },
        { id: '3', userId: '456', updatedAt: new Date('2023-03-01') },
      ]);

      // Call the query method
      const result = await sessionModel.query();

      // Assert results
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

  describe('create', () => {
    it('should create a new session', async () => {
      // Call the create method
      const result = await sessionModel.create({
        type: 'agent',
        session: {
          title: 'New Session',
        },
        config: { model: 'gpt-3.5-turbo' },
      });

      // Assert results
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
      // Call the create method with a custom ID
      const customId = 'custom-id';
      const result = await sessionModel.create({
        type: 'agent',
        config: { model: 'gpt-3.5-turbo' },
        session: { title: 'New Session' },
        id: customId,
      });

      // Assert results
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

  describe('update', () => {
    it('should update a session', async () => {
      // Create a test session
      const sessionId = '123';
      await serverDB.insert(sessions).values({ userId, id: sessionId, title: 'Test Session' });

      // Call the update method to update the session
      const updatedSessions = await sessionModel.update(sessionId, {
        title: 'Updated Test Session',
        description: 'This is an updated test session',
      });

      // Assert the updated results
      expect(updatedSessions).toHaveLength(1);
      expect(updatedSessions[0].title).toBe('Updated Test Session');
      expect(updatedSessions[0].description).toBe('This is an updated test session');
    });

    it('should not update a session if user ID does not match', async () => {
      // Create a test session with a different user ID
      await serverDB.insert(users).values([{ id: '777' }]);

      const sessionId = '123';

      await serverDB
        .insert(sessions)
        .values({ userId: '777', id: sessionId, title: 'Test Session' });

      // Attempt to update this session — should produce no updates
      const updatedSessions = await sessionModel.update(sessionId, {
        title: 'Updated Test Session',
      });

      expect(updatedSessions).toHaveLength(0);
    });
  });

  describe('delete', () => {
    it('should handle deleting a session with no associated messages or topics', async () => {
      // Create test data
      await serverDB.insert(sessions).values({ id: '1', userId });

      // Call the delete method
      await sessionModel.delete('1');

      // Assert deletion results
      const result = await serverDB.select({ id: sessions.id }).from(sessions);

      expect(result).toHaveLength(0);
    });

    it('should handle concurrent deletions gracefully', async () => {
      // Create test data
      await serverDB.insert(sessions).values({ id: '1', userId });

      // Concurrently call the delete method
      await Promise.all([sessionModel.delete('1'), sessionModel.delete('1')]);

      // Assert deletion results
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

    it('should report orphan-deleted agent ids so callers can clean permission rows', async () => {
      await serverDB.insert(sessions).values([
        { id: '1', userId },
        { id: '2', userId },
      ]);
      await serverDB.insert(agents).values([
        { id: 'orphaned', userId },
        { id: 'still-linked', userId },
      ]);
      await serverDB.insert(agentsToSessions).values([
        { agentId: 'orphaned', sessionId: '1', userId },
        { agentId: 'still-linked', sessionId: '1', userId },
        { agentId: 'still-linked', sessionId: '2', userId },
      ]);

      const { orphanedAgentIds } = await sessionModel.delete('1');

      expect(orphanedAgentIds).toEqual(['orphaned']);
      expect(await serverDB.select().from(agents).where(eq(agents.id, 'orphaned'))).toHaveLength(0);
      expect(
        await serverDB.select().from(agents).where(eq(agents.id, 'still-linked')),
      ).toHaveLength(1);
    });
  });

  describe('recycle-bin gate (linked agent trashed)', () => {
    const seedTrashedShell = async () => {
      // A shell whose agent sits in the recycle bin: the agent is the
      // restorable unit, so the session must vanish from every legacy read
      // and write until the agent comes back.
      await serverDB.insert(sessions).values([
        { id: 'trashed-shell', slug: 'trashed-shell', userId },
        { id: 'live-shell', userId },
      ]);
      await serverDB.insert(agents).values([
        { deletedAt: new Date(), id: 'trashed-agent', isDeleted: true, userId },
        { id: 'live-agent', userId },
      ]);
      await serverDB.insert(agentsToSessions).values([
        { agentId: 'trashed-agent', sessionId: 'trashed-shell', userId },
        { agentId: 'live-agent', sessionId: 'live-shell', userId },
      ]);
      await serverDB
        .insert(topics)
        .values({ id: 'recoverable', sessionId: 'trashed-shell', userId });
    };

    it('hides the shell from list and lookup', async () => {
      await seedTrashedShell();
      expect((await sessionModel.query()).map((s) => s.id)).toEqual(['live-shell']);
      expect(await sessionModel.findByIdOrSlug('trashed-shell')).toBeUndefined();
      expect(await sessionModel.findByIdOrSlug('live-shell')).toBeTruthy();
    });

    it('turns delete / batchDelete / update into no-ops so the recoverable topics survive', async () => {
      await seedTrashedShell();

      const single = await sessionModel.delete('trashed-shell');
      expect(single.orphanedAgentIds).toEqual([]);
      const batch = await sessionModel.batchDelete(['trashed-shell', 'live-shell']);
      expect(batch.orphanedAgentIds).toEqual(['live-agent']);
      await sessionModel.update('trashed-shell', { title: 'renamed' });

      const [shell] = await serverDB
        .select()
        .from(sessions)
        .where(eq(sessions.id, 'trashed-shell'));
      expect(shell).toBeTruthy();
      expect(shell.title).toBeNull();
      // the link and the topics behind it are untouched — restoring the agent brings everything back
      expect(
        await serverDB
          .select()
          .from(agentsToSessions)
          .where(eq(agentsToSessions.sessionId, 'trashed-shell')),
      ).toHaveLength(1);
      expect(await serverDB.select().from(topics).where(eq(topics.id, 'recoverable'))).toHaveLength(
        1,
      );
      expect(
        await serverDB.select().from(sessions).where(eq(sessions.id, 'live-shell')),
      ).toHaveLength(0);
    });

    it('keeps a legacy group session with live members reachable, minus the trashed member', async () => {
      await serverDB.insert(sessions).values({ id: 'group-shell', type: 'group', userId });
      await serverDB.insert(agents).values([
        { deletedAt: new Date(), id: 'trashed-member', isDeleted: true, userId },
        { id: 'live-member', userId },
      ]);
      await serverDB.insert(agentsToSessions).values([
        { agentId: 'trashed-member', sessionId: 'group-shell', userId },
        { agentId: 'live-member', sessionId: 'group-shell', userId },
      ]);

      const [group] = await sessionModel.query();
      expect(group.id).toBe('group-shell');
      expect(group.agentsToSessions.map((l: any) => l.agent.id)).toEqual(['live-member']);
      expect((await sessionModel.findByIdOrSlug('group-shell'))?.agent.id).toBe('live-member');

      // still write-protected: hard-deleting it would cascade the trashed member's link away
      await sessionModel.delete('group-shell');
      expect(
        await serverDB.select().from(sessions).where(eq(sessions.id, 'group-shell')),
      ).toHaveLength(1);
    });

    it('hides a legacy group session once every member is trashed', async () => {
      await serverDB.insert(sessions).values({ id: 'group-shell', type: 'group', userId });
      await serverDB
        .insert(agents)
        .values({ deletedAt: new Date(), id: 'trashed-member', isDeleted: true, userId });
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: 'trashed-member', sessionId: 'group-shell', userId });

      expect(await sessionModel.query()).toEqual([]);
      expect(await sessionModel.findByIdOrSlug('group-shell')).toBeUndefined();
    });

    it('deleteAll leaves the hidden shell in place', async () => {
      await seedTrashedShell();
      await sessionModel.deleteAll();
      const remaining = await serverDB.select().from(sessions).where(eq(sessions.userId, userId));
      expect(remaining.map((s) => s.id)).toEqual(['trashed-shell']);
      expect(await serverDB.select().from(topics).where(eq(topics.id, 'recoverable'))).toHaveLength(
        1,
      );
    });
  });

  describe('batchDelete', () => {
    it('should handle deleting sessions with no associated messages or topics', async () => {
      // Create test data
      await serverDB.insert(sessions).values([
        { id: '1', userId },
        { id: '2', userId },
      ]);

      // Call the batchDelete method
      await sessionModel.batchDelete(['1', '2']);

      // Assert deletion results
      const result = await serverDB.select({ id: sessions.id }).from(sessions);

      expect(result).toHaveLength(0);
    });

    it('should handle concurrent batch deletions gracefully', async () => {
      // Create test data
      await serverDB.insert(sessions).values([
        { id: '1', userId },
        { id: '2', userId },
      ]);

      // Concurrently call the batchDelete method
      await Promise.all([
        sessionModel.batchDelete(['1', '2']),
        sessionModel.batchDelete(['1', '2']),
      ]);

      // Assert deletion results
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
});
