// @vitest-environment node
import { INBOX_SESSION_ID } from '@lobechat/const';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { NewAgent } from '../../schemas';
import {
  agents,
  agentsFiles,
  agentsKnowledgeBases,
  agentsToSessions,
  documents,
  files,
  knowledgeBases,
  sessionGroups,
  sessions,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-model-test-user-id';
const userId2 = 'agent-model-test-user-id-2';
const agentModel = new AgentModel(serverDB, userId);
const agentModel2 = new AgentModel(serverDB, userId2);

const knowledgeBase = { id: 'kb1', userId, name: 'knowledgeBase' };
const knowledgeBase2 = { id: 'kb2', userId: userId2, name: 'knowledgeBase2' };
const fileList = [
  {
    id: '1',
    name: 'document.pdf',
    url: 'https://a.com/document.pdf',
    size: 1000,
    fileType: 'application/pdf',
    userId,
  },
  {
    id: '2',
    name: 'image.jpg',
    url: 'https://a.com/image.jpg',
    size: 500,
    fileType: 'image/jpeg',
    userId,
  },
];

const fileList2 = [
  {
    id: '3',
    name: 'other.pdf',
    url: 'https://a.com/other.pdf',
    size: 1000,
    fileType: 'application/pdf',
    userId: userId2,
  },
];

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);
  await serverDB.insert(knowledgeBases).values([knowledgeBase, knowledgeBase2]);
  await serverDB.insert(files).values([...fileList, ...fileList2]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('AgentModel', () => {
  describe('getAgentConfigById', () => {
    it('should return agent config with assigned knowledge', async () => {
      const agentId = 'test-agent-id';
      await serverDB.insert(agents).values({ id: agentId, userId });
      await serverDB
        .insert(agentsKnowledgeBases)
        .values({ agentId, knowledgeBaseId: 'kb1', userId });
      await serverDB.insert(agentsFiles).values({ agentId, fileId: '1', userId });

      const result = await agentModel.getAgentConfigById(agentId);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(agentId);
      expect(result!.knowledgeBases).toHaveLength(1);
      expect(result!.files).toHaveLength(1);
    });

    it('should fetch and include document content for enabled files', async () => {
      const agentId = 'test-agent-with-docs';
      await serverDB.insert(agents).values({ id: agentId, userId });
      await serverDB.insert(agentsFiles).values({ agentId, fileId: '1', userId, enabled: true });
      await serverDB.insert(documents).values({
        id: 'doc1',
        fileId: '1',
        userId,
        content: 'This is document content',
        fileType: 'application/pdf',
        totalCharCount: 100,
        totalLineCount: 10,
        sourceType: 'file',
        source: 'document.pdf',
      });

      const result = await agentModel.getAgentConfigById(agentId);

      expect(result).not.toBeNull();
      expect(result!.files).toHaveLength(1);
      expect(result!.files[0].content).toBe('This is document content');
      expect(result!.files[0].enabled).toBe(true);
    });

    it('should not include content for disabled files', async () => {
      const agentId = 'test-agent-disabled-file';
      await serverDB.insert(agents).values({ id: agentId, userId });
      await serverDB.insert(agentsFiles).values({ agentId, fileId: '1', userId, enabled: false });
      await serverDB.insert(documents).values({
        id: 'doc2',
        fileId: '1',
        userId,
        content: 'This should not be included',
        fileType: 'application/pdf',
        totalCharCount: 100,
        totalLineCount: 10,
        sourceType: 'file',
        source: 'document.pdf',
      });

      const result = await agentModel.getAgentConfigById(agentId);

      expect(result).not.toBeNull();
      expect(result!.files).toHaveLength(1);
      expect(result!.files[0].content).toBeUndefined();
      expect(result!.files[0].enabled).toBe(false);
    });

    it('should handle files without documents', async () => {
      const agentId = 'test-agent-no-docs';
      await serverDB.insert(agents).values({ id: agentId, userId });
      await serverDB.insert(agentsFiles).values({ agentId, fileId: '2', userId, enabled: true });

      const result = await agentModel.getAgentConfigById(agentId);

      expect(result).not.toBeNull();
      expect(result!.files).toHaveLength(1);
      expect(result!.files[0].content).toBeUndefined();
    });

    it('should handle agent with no files', async () => {
      const agentId = 'test-agent-no-files';
      await serverDB.insert(agents).values({ id: agentId, userId });

      const result = await agentModel.getAgentConfigById(agentId);

      expect(result).not.toBeNull();
      expect(result!.files).toHaveLength(0);
    });

    it('should not return agent belonging to another user', async () => {
      const agentId = 'test-agent-other-user';
      // Create agent for user2
      await serverDB.insert(agents).values({ id: agentId, userId: userId2 });

      // Try to access with user1's model
      const result = await agentModel.getAgentConfigById(agentId);

      expect(result).toBeNull();
    });

    it('should not return knowledge from another user agent', async () => {
      const agentId = 'test-agent-cross-user-knowledge';
      // Create agent for user2 with knowledge
      await serverDB.insert(agents).values({ id: agentId, userId: userId2 });
      await serverDB
        .insert(agentsKnowledgeBases)
        .values({ agentId, knowledgeBaseId: 'kb2', userId: userId2 });
      await serverDB.insert(agentsFiles).values({ agentId, fileId: '3', userId: userId2 });

      // Try to access with user1's model
      const result = await agentModel.getAgentConfigById(agentId);

      // Should return null since user1 cannot access user2's agent
      expect(result).toBeNull();
    });
  });

  describe('getAgentConfig', () => {
    it('should find agent by ID', async () => {
      const agentId = 'test-agent-by-id';
      await serverDB.insert(agents).values({ id: agentId, userId });

      const result = await agentModel.getAgentConfig(agentId);

      expect(result).toBeDefined();
      expect(result?.id).toBe(agentId);
    });

    it('should find agent by slug when ID does not match', async () => {
      const agentId = 'test-agent-slug';
      const slug = 'my-agent-slug';
      await serverDB.insert(agents).values({ id: agentId, slug, userId });

      const result = await agentModel.getAgentConfig(slug);

      expect(result).toBeDefined();
      expect(result?.id).toBe(agentId);
      expect(result?.slug).toBe(slug);
    });

    it('should return null when neither ID nor slug matches', async () => {
      const result = await agentModel.getAgentConfig('non-existent-id-or-slug');

      expect(result).toBeNull();
    });

    it('should not find agent by slug from another user', async () => {
      const agentId = 'test-agent-other-user';
      const slug = 'shared-slug';
      // Create agent with same slug but different user
      await serverDB.insert(agents).values({ id: agentId, slug, userId: userId2 });

      const result = await agentModel.getAgentConfig(slug);

      expect(result).toBeNull();
    });

    it('should not find agent by ID if it belongs to another user', async () => {
      const agentId = 'test-agent-cross-user';
      await serverDB.insert(agents).values({ id: agentId, userId: userId2 });

      // ID lookup should not work across users for security
      const result = await agentModel.getAgentConfig(agentId);

      expect(result).toBeNull();
    });

    it('should prefer ID match over slug match', async () => {
      // Create two agents: one with ID "abc", another with slug "abc"
      const agent1Id = 'abc';
      const agent2Id = 'different-id';
      await serverDB.insert(agents).values({ id: agent1Id, userId });
      await serverDB.insert(agents).values({ id: agent2Id, slug: 'abc', userId });

      const result = await agentModel.getAgentConfig('abc');

      // Should return the agent matched by ID, not slug
      expect(result).toBeDefined();
      expect(result?.id).toBe(agent1Id);
    });

    it('should enrich agent with knowledge when found', async () => {
      const agentId = 'test-agent-with-knowledge';
      await serverDB.insert(agents).values({ id: agentId, userId });
      await serverDB
        .insert(agentsKnowledgeBases)
        .values({ agentId, knowledgeBaseId: 'kb1', userId });
      await serverDB.insert(agentsFiles).values({ agentId, fileId: '1', userId });

      const result = await agentModel.getAgentConfig(agentId);

      expect(result).toBeDefined();
      expect(result?.knowledgeBases).toHaveLength(1);
      expect(result?.files).toHaveLength(1);
    });
  });

  describe('findBySessionId', () => {
    it('should find agent by session id', async () => {
      const agentId = 'test-agent-id';
      const sessionId = 'test-session-id';
      await serverDB.insert(agents).values({ id: agentId, userId });
      await serverDB.insert(sessions).values({ id: sessionId, userId });
      await serverDB.insert(agentsToSessions).values({ agentId, sessionId, userId });

      const result = await agentModel.findBySessionId(sessionId);

      expect(result).toBeDefined();
      expect(result?.id).toBe(agentId);
    });

    it('should return undefined when session is not found', async () => {
      const result = await agentModel.findBySessionId('non-existent-session');

      expect(result).toBeUndefined();
    });

    it('should not return agent from another user session', async () => {
      const agentId = 'test-agent-other-user-session';
      const sessionId = 'test-session-other-user';
      // Create agent and session for user2
      await serverDB.insert(agents).values({ id: agentId, userId: userId2 });
      await serverDB.insert(sessions).values({ id: sessionId, userId: userId2 });
      await serverDB.insert(agentsToSessions).values({ agentId, sessionId, userId: userId2 });

      // Try to access with user1's model
      const result = await agentModel.findBySessionId(sessionId);

      expect(result).toBeUndefined();
    });
  });

  describe('getAgentAssignedKnowledge', () => {
    it('should return knowledge bases and files for the agent', async () => {
      const agentId = 'test-agent-knowledge';
      await serverDB.insert(agents).values({ id: agentId, userId });
      await serverDB
        .insert(agentsKnowledgeBases)
        .values({ agentId, knowledgeBaseId: 'kb1', userId, enabled: true });
      await serverDB.insert(agentsFiles).values({ agentId, fileId: '1', userId, enabled: true });

      const result = await agentModel.getAgentAssignedKnowledge(agentId);

      expect(result.knowledgeBases).toHaveLength(1);
      expect(result.files).toHaveLength(1);
    });

    it('should not return knowledge from another user', async () => {
      const agentId = 'test-agent-knowledge-other-user';
      // Create agent with knowledge for user2
      await serverDB.insert(agents).values({ id: agentId, userId: userId2 });
      await serverDB
        .insert(agentsKnowledgeBases)
        .values({ agentId, knowledgeBaseId: 'kb2', userId: userId2, enabled: true });
      await serverDB
        .insert(agentsFiles)
        .values({ agentId, fileId: '3', userId: userId2, enabled: true });

      // Try to access with user1's model
      const result = await agentModel.getAgentAssignedKnowledge(agentId);

      // Should return empty arrays since user1 cannot access user2's knowledge
      expect(result.knowledgeBases).toHaveLength(0);
      expect(result.files).toHaveLength(0);
    });

    it('should handle empty knowledge bases and files', async () => {
      const agentId = 'test-agent-no-knowledge';
      await serverDB.insert(agents).values({ id: agentId, userId });

      const result = await agentModel.getAgentAssignedKnowledge(agentId);

      expect(result.knowledgeBases).toHaveLength(0);
      expect(result.files).toHaveLength(0);
    });
  });

  describe('createAgentKnowledgeBase', () => {
    it('should create a new agent knowledge base association with enabled=true by default', async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ userId })
        .returning()
        .then((res) => res[0]);

      await agentModel.createAgentKnowledgeBase(agent.id, knowledgeBase.id);

      const result = await serverDB.query.agentsKnowledgeBases.findFirst({
        where: eq(agentsKnowledgeBases.agentId, agent.id),
      });

      expect(result).toMatchObject({
        agentId: agent.id,
        knowledgeBaseId: knowledgeBase.id,
        userId,
        enabled: true,
      });
    });

    it('should create a new agent knowledge base association with enabled=false', async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ userId })
        .returning()
        .then((res) => res[0]);

      await agentModel.createAgentKnowledgeBase(agent.id, knowledgeBase.id, false);

      const result = await serverDB.query.agentsKnowledgeBases.findFirst({
        where: eq(agentsKnowledgeBases.agentId, agent.id),
      });

      expect(result).toMatchObject({
        agentId: agent.id,
        knowledgeBaseId: knowledgeBase.id,
        userId,
        enabled: false,
      });
    });
  });

  describe('deleteAgentKnowledgeBase', () => {
    it('should delete an agent knowledge base association', async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ userId })
        .returning()
        .then((res) => res[0]);
      await serverDB
        .insert(agentsKnowledgeBases)
        .values({ agentId: agent.id, knowledgeBaseId: knowledgeBase.id, userId });

      await agentModel.deleteAgentKnowledgeBase(agent.id, knowledgeBase.id);

      const result = await serverDB.query.agentsKnowledgeBases.findFirst({
        where: eq(agentsKnowledgeBases.agentId, agent.id),
      });

      expect(result).toBeUndefined();
    });

    it('should not delete another user agent knowledge base association', async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ userId })
        .returning()
        .then((res) => res[0]);
      await serverDB
        .insert(agentsKnowledgeBases)
        .values({ agentId: agent.id, knowledgeBaseId: knowledgeBase.id, userId });

      // Try to delete with another user's model
      await agentModel2.deleteAgentKnowledgeBase(agent.id, knowledgeBase.id);

      const result = await serverDB.query.agentsKnowledgeBases.findFirst({
        where: eq(agentsKnowledgeBases.agentId, agent.id),
      });

      // Should still exist
      expect(result).toBeDefined();
    });
  });

  describe('toggleKnowledgeBase', () => {
    it('should toggle the enabled status of an agent knowledge base association', async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ userId })
        .returning()
        .then((res) => res[0]);

      await serverDB
        .insert(agentsKnowledgeBases)
        .values({ agentId: agent.id, knowledgeBaseId: knowledgeBase.id, userId, enabled: true });

      await agentModel.toggleKnowledgeBase(agent.id, knowledgeBase.id, false);

      const result = await serverDB.query.agentsKnowledgeBases.findFirst({
        where: eq(agentsKnowledgeBases.agentId, agent.id),
      });

      expect(result?.enabled).toBe(false);
    });

    it('should not toggle another user agent knowledge base association', async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ userId })
        .returning()
        .then((res) => res[0]);

      await serverDB
        .insert(agentsKnowledgeBases)
        .values({ agentId: agent.id, knowledgeBaseId: knowledgeBase.id, userId, enabled: true });

      // Try to toggle with another user's model
      await agentModel2.toggleKnowledgeBase(agent.id, knowledgeBase.id, false);

      const result = await serverDB.query.agentsKnowledgeBases.findFirst({
        where: eq(agentsKnowledgeBases.agentId, agent.id),
      });

      // Should still be enabled
      expect(result?.enabled).toBe(true);
    });
  });

  describe('createAgentFiles', () => {
    it('should create new agent file associations with enabled=true by default', async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ userId })
        .returning()
        .then((res) => res[0]);

      await agentModel.createAgentFiles(agent.id, ['1', '2']);

      const results = await serverDB.query.agentsFiles.findMany({
        where: eq(agentsFiles.agentId, agent.id),
      });

      expect(results).toHaveLength(2);
      expect(results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ agentId: agent.id, fileId: '1', userId, enabled: true }),
          expect.objectContaining({ agentId: agent.id, fileId: '2', userId, enabled: true }),
        ]),
      );
    });

    it('should create new agent file associations with enabled=false', async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ userId })
        .returning()
        .then((res) => res[0]);

      await agentModel.createAgentFiles(agent.id, ['1'], false);

      const results = await serverDB.query.agentsFiles.findMany({
        where: eq(agentsFiles.agentId, agent.id),
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        agentId: agent.id,
        fileId: '1',
        userId,
        enabled: false,
      });
    });

    it('should skip files that already exist', async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ userId })
        .returning()
        .then((res) => res[0]);

      // First insert
      await serverDB.insert(agentsFiles).values({ agentId: agent.id, fileId: '1', userId });

      // Try to insert the same file again
      await agentModel.createAgentFiles(agent.id, ['1', '2']);

      const results = await serverDB.query.agentsFiles.findMany({
        where: eq(agentsFiles.agentId, agent.id),
      });

      // Should only have 2 files (1 existing + 1 new), not 3
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.fileId).sort()).toEqual(['1', '2']);
    });

    it('should return early when all files already exist', async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ userId })
        .returning()
        .then((res) => res[0]);

      // First insert
      await serverDB.insert(agentsFiles).values([
        { agentId: agent.id, fileId: '1', userId },
        { agentId: agent.id, fileId: '2', userId },
      ]);

      // Try to insert the same files again
      const result = await agentModel.createAgentFiles(agent.id, ['1', '2']);

      // Should return undefined (early return)
      expect(result).toBeUndefined();

      const results = await serverDB.query.agentsFiles.findMany({
        where: eq(agentsFiles.agentId, agent.id),
      });

      // Should still only have 2 files
      expect(results).toHaveLength(2);
    });
  });

  describe('deleteAgentFile', () => {
    it('should delete an agent file association', async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ userId })
        .returning()
        .then((res) => res[0]);

      await serverDB.insert(agentsFiles).values({ agentId: agent.id, fileId: '1', userId });

      await agentModel.deleteAgentFile(agent.id, '1');

      const result = await serverDB.query.agentsFiles.findFirst({
        where: eq(agentsFiles.agentId, agent.id),
      });

      expect(result).toBeUndefined();
    });

    it('should not delete another user agent file association', async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ userId })
        .returning()
        .then((res) => res[0]);

      await serverDB.insert(agentsFiles).values({ agentId: agent.id, fileId: '1', userId });

      // Try to delete with another user's model
      await agentModel2.deleteAgentFile(agent.id, '1');

      const result = await serverDB.query.agentsFiles.findFirst({
        where: eq(agentsFiles.agentId, agent.id),
      });

      // Should still exist
      expect(result).toBeDefined();
    });
  });

  describe('update', () => {
    it('should update agent fields and set updatedAt', async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ userId, title: 'Original Title' })
        .returning()
        .then((res) => res[0]);

      const originalUpdatedAt = agent.updatedAt;

      // Wait a bit to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      await agentModel.update(agent.id, { title: 'Updated Title', description: 'New description' });

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });

      expect(result?.title).toBe('Updated Title');
      expect(result?.description).toBe('New description');
      expect(result?.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });

    it('should not update another user agent', async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ userId, title: 'Original Title' })
        .returning()
        .then((res) => res[0]);

      await agentModel2.update(agent.id, { title: 'Hacked Title' });

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });

      expect(result?.title).toBe('Original Title');
    });
  });

  describe('touchUpdatedAt', () => {
    it('should only update updatedAt without changing other fields', async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ userId, title: 'My Agent', description: 'My Description' })
        .returning()
        .then((res) => res[0]);

      const originalUpdatedAt = agent.updatedAt;

      // Wait a bit to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      await agentModel.touchUpdatedAt(agent.id);

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });

      expect(result?.title).toBe('My Agent');
      expect(result?.description).toBe('My Description');
      expect(result?.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });

    it('should not touch another user agent updatedAt', async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ userId, title: 'My Agent' })
        .returning()
        .then((res) => res[0]);

      const originalUpdatedAt = agent.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 10));

      await agentModel2.touchUpdatedAt(agent.id);

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });

      expect(result?.updatedAt.getTime()).toBe(originalUpdatedAt.getTime());
    });
  });

  describe('delete', () => {
    it('should delete an agent and its associated session', async () => {
      // Create agent and session
      const [agent] = await serverDB
        .insert(agents)
        .values({ userId, title: 'Test Agent' })
        .returning();
      const [session] = await serverDB
        .insert(sessions)
        .values({ userId, type: 'agent' })
        .returning();
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: agent.id, sessionId: session.id, userId });

      // Delete the agent
      await agentModel.delete(agent.id);

      // Verify agent is deleted
      const deletedAgent = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });
      expect(deletedAgent).toBeUndefined();

      // Verify session is deleted
      const deletedSession = await serverDB.query.sessions.findFirst({
        where: eq(sessions.id, session.id),
      });
      expect(deletedSession).toBeUndefined();

      // Verify agentsToSessions link is deleted
      const deletedLink = await serverDB.query.agentsToSessions.findFirst({
        where: eq(agentsToSessions.agentId, agent.id),
      });
      expect(deletedLink).toBeUndefined();
    });

    it('should delete an agent with multiple sessions', async () => {
      // Create agent with multiple sessions
      const [agent] = await serverDB
        .insert(agents)
        .values({ userId, title: 'Multi-session Agent' })
        .returning();
      const [session1] = await serverDB
        .insert(sessions)
        .values({ userId, type: 'agent' })
        .returning();
      const [session2] = await serverDB
        .insert(sessions)
        .values({ userId, type: 'agent' })
        .returning();
      await serverDB.insert(agentsToSessions).values([
        { agentId: agent.id, sessionId: session1.id, userId },
        { agentId: agent.id, sessionId: session2.id, userId },
      ]);

      // Delete the agent
      await agentModel.delete(agent.id);

      // Verify all are deleted
      const deletedAgent = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });
      expect(deletedAgent).toBeUndefined();

      const remainingSessions = await serverDB.query.sessions.findMany({
        where: eq(sessions.userId, userId),
      });
      expect(remainingSessions).toHaveLength(0);
    });

    it('should delete an agent without any sessions', async () => {
      // Create agent without session
      const [agent] = await serverDB
        .insert(agents)
        .values({ userId, title: 'No-session Agent' })
        .returning();

      // Delete the agent
      await agentModel.delete(agent.id);

      // Verify agent is deleted
      const deletedAgent = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });
      expect(deletedAgent).toBeUndefined();
    });

    it('should not delete another user agent', async () => {
      // Create agent for user1
      const [agent] = await serverDB
        .insert(agents)
        .values({ userId, title: 'User1 Agent' })
        .returning();
      const [session] = await serverDB
        .insert(sessions)
        .values({ userId, type: 'agent' })
        .returning();
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: agent.id, sessionId: session.id, userId });

      // Try to delete with user2's model
      await agentModel2.delete(agent.id);

      // Verify agent still exists
      const existingAgent = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });
      expect(existingAgent).toBeDefined();
      expect(existingAgent?.title).toBe('User1 Agent');

      // Verify session still exists
      const existingSession = await serverDB.query.sessions.findFirst({
        where: eq(sessions.id, session.id),
      });
      expect(existingSession).toBeDefined();
    });

    it('should delete agent files and knowledge bases associations', async () => {
      // Create agent with files and knowledge bases
      const [agent] = await serverDB
        .insert(agents)
        .values({ userId, title: 'Agent with knowledge' })
        .returning();
      await serverDB.insert(agentsFiles).values({ agentId: agent.id, fileId: '1', userId });
      await serverDB
        .insert(agentsKnowledgeBases)
        .values({ agentId: agent.id, knowledgeBaseId: 'kb1', userId });

      // Delete the agent
      await agentModel.delete(agent.id);

      // Verify agent is deleted
      const deletedAgent = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });
      expect(deletedAgent).toBeUndefined();

      // Verify agentsFiles are deleted (cascade)
      const remainingFiles = await serverDB.query.agentsFiles.findMany({
        where: eq(agentsFiles.agentId, agent.id),
      });
      expect(remainingFiles).toHaveLength(0);

      // Verify agentsKnowledgeBases are deleted (cascade)
      const remainingKBs = await serverDB.query.agentsKnowledgeBases.findMany({
        where: eq(agentsKnowledgeBases.agentId, agent.id),
      });
      expect(remainingKBs).toHaveLength(0);
    });
  });

  describe('toggleFile', () => {
    it('should toggle the enabled status of an agent file association', async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ userId })
        .returning()
        .then((res) => res[0]);

      await serverDB
        .insert(agentsFiles)
        .values({ agentId: agent.id, fileId: '1', userId, enabled: true });

      await agentModel.toggleFile(agent.id, '1', false);

      const result = await serverDB.query.agentsFiles.findFirst({
        where: eq(agentsFiles.agentId, agent.id),
      });

      expect(result?.enabled).toBe(false);
    });

    it('should not toggle another user agent file association', async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ userId })
        .returning()
        .then((res) => res[0]);

      await serverDB
        .insert(agentsFiles)
        .values({ agentId: agent.id, fileId: '1', userId, enabled: true });

      // Try to toggle with another user's model
      await agentModel2.toggleFile(agent.id, '1', false);

      const result = await serverDB.query.agentsFiles.findFirst({
        where: eq(agentsFiles.agentId, agent.id),
      });

      // Should still be enabled
      expect(result?.enabled).toBe(true);
    });
  });

  describe('updateConfig', () => {
    it('should update agent config and set updatedAt', async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ userId, title: 'Original Title', model: 'gpt-3.5-turbo' })
        .returning()
        .then((res) => res[0]);

      const originalUpdatedAt = agent.updatedAt;

      // Wait a bit to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      await agentModel.updateConfig(agent.id, { title: 'Updated Title', model: 'gpt-4' });

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });

      expect(result?.title).toBe('Updated Title');
      expect(result?.model).toBe('gpt-4');
      expect(result?.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });

    it('should update updatedAt even when only updating meta fields like avatar', async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ userId, title: 'Test Agent', avatar: 'old-avatar' })
        .returning()
        .then((res) => res[0]);

      const originalUpdatedAt = agent.updatedAt;

      // Wait a bit to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      await agentModel.updateConfig(agent.id, { avatar: 'new-avatar' });

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });

      expect(result?.avatar).toBe('new-avatar');
      expect(result?.title).toBe('Test Agent'); // Should preserve other fields
      expect(result?.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });

    it('should not update another user agent', async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ userId, title: 'Original Title' })
        .returning()
        .then((res) => res[0]);

      await agentModel2.updateConfig(agent.id, { title: 'Hacked Title' });

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });

      expect(result?.title).toBe('Original Title');
    });
  });

  describe('create', () => {
    it('should create a virtual agent without session', async () => {
      const config = {
        title: 'Virtual Agent',
        description: 'A virtual group member',
        model: 'gpt-4',
        provider: 'openai',
        virtual: true,
      };

      const result = await agentModel.create(config);

      expect(result).toBeDefined();
      expect(result.title).toBe('Virtual Agent');
      expect(result.description).toBe('A virtual group member');
      expect(result.model).toBe('gpt-4');
      expect(result.provider).toBe('openai');
      expect(result.virtual).toBe(true);
      expect(result.userId).toBe(userId);

      // Verify no session was created
      const sessionLinks = await serverDB.query.agentsToSessions.findMany({
        where: eq(agentsToSessions.agentId, result.id),
      });
      expect(sessionLinks).toHaveLength(0);
    });

    it('should create agent with default virtual=false', async () => {
      const config = {
        title: 'Normal Agent',
      };

      const result = await agentModel.create(config);

      expect(result).toBeDefined();
      expect(result.title).toBe('Normal Agent');
      expect(result.virtual).toBe(false);
    });

    it('should create agent with all optional fields', async () => {
      const config = {
        title: 'Full Agent',
        description: 'Full description',
        avatar: 'avatar-url',
        backgroundColor: '#ffffff',
        model: 'gpt-4',
        provider: 'openai',
        systemRole: 'You are a helpful assistant',
        tags: ['tag1', 'tag2'],
        plugins: ['plugin1'],
        openingMessage: 'Hello!',
        openingQuestions: ['Question 1', 'Question 2'],
        virtual: true,
      };

      const result = await agentModel.create(config);

      expect(result.title).toBe('Full Agent');
      expect(result.description).toBe('Full description');
      expect(result.avatar).toBe('avatar-url');
      expect(result.backgroundColor).toBe('#ffffff');
      expect(result.model).toBe('gpt-4');
      expect(result.provider).toBe('openai');
      expect(result.systemRole).toBe('You are a helpful assistant');
      expect(result.tags).toEqual(['tag1', 'tag2']);
      expect(result.plugins).toEqual(['plugin1']);
      expect(result.openingMessage).toBe('Hello!');
      expect(result.openingQuestions).toEqual(['Question 1', 'Question 2']);
      expect(result.virtual).toBe(true);
    });

    it('should create agent with custom id', async () => {
      const customId = 'custom-agent-id-123';
      const config = {
        id: customId,
        title: 'Custom ID Agent',
      };

      const result = await agentModel.create(config);

      expect(result.id).toBe(customId);
    });

    it('should create multiple agents for the same user', async () => {
      const agent1 = await agentModel.create({ title: 'Agent 1', virtual: true });
      const agent2 = await agentModel.create({ title: 'Agent 2', virtual: true });

      expect(agent1.id).not.toBe(agent2.id);

      const allAgents = await serverDB.query.agents.findMany({
        where: eq(agents.userId, userId),
      });
      expect(allAgents.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('batchCreate', () => {
    it('should batch create multiple virtual agents', async () => {
      const configs = [
        { title: 'Agent 1', model: 'gpt-4', virtual: true },
        { title: 'Agent 2', model: 'gpt-3.5-turbo', virtual: true },
        { title: 'Agent 3', model: 'claude-3', virtual: true },
      ];

      const results = await agentModel.batchCreate(configs);

      expect(results).toHaveLength(3);
      expect(results[0].title).toBe('Agent 1');
      expect(results[1].title).toBe('Agent 2');
      expect(results[2].title).toBe('Agent 3');
      results.forEach((agent) => {
        expect(agent.userId).toBe(userId);
        expect(agent.virtual).toBe(true);
      });
    });

    it('should return empty array for empty input', async () => {
      const results = await agentModel.batchCreate([]);

      expect(results).toEqual([]);
    });

    it('should batch create agents with different configs', async () => {
      const configs = [
        {
          title: 'Full Agent',
          description: 'Full description',
          model: 'gpt-4',
          provider: 'openai',
          systemRole: 'You are helpful',
          virtual: true,
        },
        {
          title: 'Minimal Agent',
          virtual: true,
        },
      ];

      const results = await agentModel.batchCreate(configs);

      expect(results).toHaveLength(2);
      expect(results[0].description).toBe('Full description');
      expect(results[0].systemRole).toBe('You are helpful');
      expect(results[1].description).toBeNull();
      expect(results[1].systemRole).toBeNull();
    });

    it('should handle model type conversion in batch', async () => {
      const configs = [
        { title: 'Agent 1', model: 'gpt-4' },
        { title: 'Agent 2', model: undefined },
        { title: 'Agent 3' },
      ];

      const results = await agentModel.batchCreate(configs);

      expect(results[0].model).toBe('gpt-4');
      expect(results[1].model).toBeNull();
      expect(results[2].model).toBeNull();
    });
  });

  describe('getBuiltinAgent', () => {
    describe('inbox compatibility', () => {
      it('should return existing inbox agent directly if slug exists in agents table', async () => {
        // Create an agent with slug='inbox'
        const [agent] = await serverDB
          .insert(agents)
          .values({
            slug: INBOX_SESSION_ID,
            userId,
            model: 'gpt-4',
          })
          .returning();

        const result = await agentModel.getBuiltinAgent(INBOX_SESSION_ID);

        expect(result).toBeDefined();
        expect(result?.id).toBe(agent.id);
        expect(result?.slug).toBe(INBOX_SESSION_ID);
      });

      it('should find inbox from legacy session and update agent slug', async () => {
        // Create legacy format: session(slug=inbox) + agent(no slug) + relation
        const [session] = await serverDB
          .insert(sessions)
          .values({
            slug: INBOX_SESSION_ID,
            userId,
            type: 'agent',
          })
          .returning();

        const [agent] = await serverDB
          .insert(agents)
          .values({
            userId,
            model: 'gpt-4',
            // Note: no slug set
          })
          .returning();

        await serverDB.insert(agentsToSessions).values({
          sessionId: session.id,
          agentId: agent.id,
          userId,
        });

        const result = await agentModel.getBuiltinAgent(INBOX_SESSION_ID);

        // Should return the agent and update its slug
        expect(result).toBeDefined();
        expect(result?.id).toBe(agent.id);
        expect(result?.slug).toBe(INBOX_SESSION_ID);

        // Verify the slug was updated in database
        const updatedAgent = await serverDB.query.agents.findFirst({
          where: eq(agents.id, agent.id),
        });
        expect(updatedAgent?.slug).toBe(INBOX_SESSION_ID);
      });

      it('should create new inbox agent if no legacy data exists', async () => {
        const result = await agentModel.getBuiltinAgent(INBOX_SESSION_ID);

        expect(result).toBeDefined();
        expect(result?.slug).toBe(INBOX_SESSION_ID);
        expect(result?.virtual).toBe(true);
      });

      it('should return the same agent on subsequent calls (idempotent)', async () => {
        // First call - creates the agent
        const result1 = await agentModel.getBuiltinAgent(INBOX_SESSION_ID);

        // Second call - should return the same agent
        const result2 = await agentModel.getBuiltinAgent(INBOX_SESSION_ID);

        expect(result1?.id).toBe(result2?.id);
        expect(result1?.slug).toBe(result2?.slug);
      });

      it('should not affect other users inbox agent', async () => {
        // User1 creates inbox via legacy method
        const [session] = await serverDB
          .insert(sessions)
          .values({
            slug: INBOX_SESSION_ID,
            userId,
            type: 'agent',
          })
          .returning();

        const [agent] = await serverDB
          .insert(agents)
          .values({
            userId,
            model: 'gpt-4',
          })
          .returning();

        await serverDB.insert(agentsToSessions).values({
          sessionId: session.id,
          agentId: agent.id,
          userId,
        });

        // User2 gets their inbox (should create a new one)
        const result2 = await agentModel2.getBuiltinAgent(INBOX_SESSION_ID);

        // User1 gets their inbox
        const result1 = await agentModel.getBuiltinAgent(INBOX_SESSION_ID);

        // Should be different agents
        expect(result1?.id).toBe(agent.id);
        expect(result2?.id).not.toBe(agent.id);

        // Both should have slug='inbox'
        expect(result1?.slug).toBe(INBOX_SESSION_ID);
        expect(result2?.slug).toBe(INBOX_SESSION_ID);
      });
    });

    describe('other builtin agents', () => {
      it('should return null for unknown slug', async () => {
        const result = await agentModel.getBuiltinAgent('unknown-agent-slug');

        expect(result).toBeNull();
      });

      it('should create page-agent builtin agent', async () => {
        const result = await agentModel.getBuiltinAgent('page-agent');

        expect(result).toBeDefined();
        expect(result?.slug).toBe('page-agent');
        expect(result?.virtual).toBe(true);
      });
    });
  });

  describe('batchDelete', () => {
    it('should batch delete multiple agents', async () => {
      // Create multiple agents
      const [agent1] = await serverDB
        .insert(agents)
        .values({ userId, title: 'Agent 1' })
        .returning();
      const [agent2] = await serverDB
        .insert(agents)
        .values({ userId, title: 'Agent 2' })
        .returning();
      const [agent3] = await serverDB
        .insert(agents)
        .values({ userId, title: 'Agent 3' })
        .returning();

      // Batch delete agent1 and agent2
      await agentModel.batchDelete([agent1.id, agent2.id]);

      // Verify agent1 and agent2 are deleted
      const deletedAgent1 = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent1.id),
      });
      const deletedAgent2 = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent2.id),
      });
      expect(deletedAgent1).toBeUndefined();
      expect(deletedAgent2).toBeUndefined();

      // Verify agent3 still exists
      const remainingAgent = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent3.id),
      });
      expect(remainingAgent).toBeDefined();
      expect(remainingAgent?.title).toBe('Agent 3');
    });

    it('should return early for empty array input', async () => {
      // Create an agent to ensure the test has something to potentially delete
      const [agent] = await serverDB
        .insert(agents)
        .values({ userId, title: 'Test Agent' })
        .returning();

      // Call batchDelete with empty array
      const result = await agentModel.batchDelete([]);

      // Should return undefined (early return)
      expect(result).toBeUndefined();

      // Verify agent still exists
      const existingAgent = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });
      expect(existingAgent).toBeDefined();
    });

    it('should not delete another user agents', async () => {
      // Create agents for user1
      const [agent1] = await serverDB
        .insert(agents)
        .values({ userId, title: 'User1 Agent 1' })
        .returning();
      const [agent2] = await serverDB
        .insert(agents)
        .values({ userId, title: 'User1 Agent 2' })
        .returning();

      // Try to batch delete with user2's model
      await agentModel2.batchDelete([agent1.id, agent2.id]);

      // Verify agents still exist
      const existingAgent1 = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent1.id),
      });
      const existingAgent2 = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent2.id),
      });
      expect(existingAgent1).toBeDefined();
      expect(existingAgent2).toBeDefined();
    });

    it('should handle mixed valid and invalid agent IDs', async () => {
      // Create an agent
      const [agent] = await serverDB
        .insert(agents)
        .values({ userId, title: 'Valid Agent' })
        .returning();

      // Batch delete with one valid and one invalid ID
      await agentModel.batchDelete([agent.id, 'non-existent-id']);

      // Verify valid agent is deleted
      const deletedAgent = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });
      expect(deletedAgent).toBeUndefined();
    });

    it('should delete agent along with associated files and knowledge bases (cascade)', async () => {
      // Create agent with files and knowledge bases
      const [agent] = await serverDB
        .insert(agents)
        .values({ userId, title: 'Agent with knowledge' })
        .returning();
      await serverDB.insert(agentsFiles).values({ agentId: agent.id, fileId: '1', userId });
      await serverDB
        .insert(agentsKnowledgeBases)
        .values({ agentId: agent.id, knowledgeBaseId: 'kb1', userId });

      // Batch delete the agent
      await agentModel.batchDelete([agent.id]);

      // Verify agent is deleted
      const deletedAgent = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });
      expect(deletedAgent).toBeUndefined();

      // Verify agentsFiles are deleted (cascade)
      const remainingFiles = await serverDB.query.agentsFiles.findMany({
        where: eq(agentsFiles.agentId, agent.id),
      });
      expect(remainingFiles).toHaveLength(0);

      // Verify agentsKnowledgeBases are deleted (cascade)
      const remainingKBs = await serverDB.query.agentsKnowledgeBases.findMany({
        where: eq(agentsKnowledgeBases.agentId, agent.id),
      });
      expect(remainingKBs).toHaveLength(0);
    });
  });

  describe('duplicate', () => {
    it('should duplicate an agent with all config fields', async () => {
      // Create source agent with full config
      const [sourceAgent] = await serverDB
        .insert(agents)
        .values({
          userId,
          title: 'Original Agent',
          description: 'Original description',
          tags: ['tag1', 'tag2'],
          avatar: 'avatar-url',
          backgroundColor: '#ffffff',
          plugins: ['plugin1'],
          model: 'gpt-4',
          provider: 'openai',
          systemRole: 'You are helpful',
          openingMessage: 'Hello!',
          openingQuestions: ['Q1', 'Q2'],
          chatConfig: { historyCount: 10 },
          fewShots: [{ role: 'user', content: 'test' }],
          params: { temperature: 0.7 },
          tts: { showAllLocaleVoice: true },
        } as NewAgent)
        .returning();

      const result = await agentModel.duplicate(sourceAgent.id);

      expect(result).toBeDefined();
      expect(result?.agentId).toBeDefined();
      expect(result?.agentId).not.toBe(sourceAgent.id);

      // Verify the duplicated agent
      const duplicatedAgent = await serverDB.query.agents.findFirst({
        where: eq(agents.id, result!.agentId),
      });

      expect(duplicatedAgent).toEqual(
        expect.objectContaining({
          // Should be copied
          title: 'Original Agent (Copy)',
          description: 'Original description',
          tags: ['tag1', 'tag2'],
          avatar: 'avatar-url',
          backgroundColor: '#ffffff',
          plugins: ['plugin1'],
          model: 'gpt-4',
          provider: 'openai',
          systemRole: 'You are helpful',
          openingMessage: 'Hello!',
          openingQuestions: ['Q1', 'Q2'],
          chatConfig: { historyCount: 10 },
          fewShots: [{ role: 'user', content: 'test' }],
          params: { temperature: 0.7 },
          tts: { showAllLocaleVoice: true },
          sessionGroupId: null,
          userId,
          // Should NOT be copied (new values)
          virtual: false,
          pinned: null,
          clientId: null,
          editorData: null,
          marketIdentifier: null,
        }),
      );

      // Verify these are NOT copied from source
      expect(duplicatedAgent?.id).not.toBe(sourceAgent.id);
      expect(duplicatedAgent?.slug).not.toBe(sourceAgent.slug);
    });

    it('should use provided title when duplicating', async () => {
      const [sourceAgent] = await serverDB
        .insert(agents)
        .values({ userId, title: 'Original' })
        .returning();

      const result = await agentModel.duplicate(sourceAgent.id, 'Custom Title');

      const duplicatedAgent = await serverDB.query.agents.findFirst({
        where: eq(agents.id, result!.agentId),
      });

      expect(duplicatedAgent?.title).toBe('Custom Title');
    });

    it('should return null for non-existent agent', async () => {
      const result = await agentModel.duplicate('non-existent-id');

      expect(result).toBeNull();
    });

    it('should not duplicate another user agent', async () => {
      const [sourceAgent] = await serverDB
        .insert(agents)
        .values({ userId: userId2, title: 'User2 Agent' })
        .returning();

      const result = await agentModel.duplicate(sourceAgent.id);

      expect(result).toBeNull();
    });

    it('should not copy marketIdentifier, slug, or id', async () => {
      const [sourceAgent] = await serverDB
        .insert(agents)
        .values({
          userId,
          title: 'Original',
          slug: 'original-slug',
          marketIdentifier: 'market-123',
        })
        .returning();

      const result = await agentModel.duplicate(sourceAgent.id);

      const duplicatedAgent = await serverDB.query.agents.findFirst({
        where: eq(agents.id, result!.agentId),
      });

      expect(duplicatedAgent?.id).not.toBe(sourceAgent.id);
      expect(duplicatedAgent?.slug).not.toBe('original-slug');
      expect(duplicatedAgent?.marketIdentifier).toBeNull();
    });

    it('should preserve sessionGroupId when duplicating', async () => {
      // Create a session group
      const [sessionGroup] = await serverDB
        .insert(sessionGroups)
        .values({ userId, name: 'Test Group' })
        .returning();

      const [sourceAgent] = await serverDB
        .insert(agents)
        .values({ userId, title: 'Agent in Group', sessionGroupId: sessionGroup.id })
        .returning();

      const result = await agentModel.duplicate(sourceAgent.id);

      const duplicatedAgent = await serverDB.query.agents.findFirst({
        where: eq(agents.id, result!.agentId),
      });

      expect(duplicatedAgent?.sessionGroupId).toBe(sessionGroup.id);
    });

    it('should handle agent with null title', async () => {
      const [sourceAgent] = await serverDB
        .insert(agents)
        .values({ userId, title: null })
        .returning();

      const result = await agentModel.duplicate(sourceAgent.id);

      const duplicatedAgent = await serverDB.query.agents.findFirst({
        where: eq(agents.id, result!.agentId),
      });

      expect(duplicatedAgent?.title).toBe('Copy');
    });
  });

  describe('queryAgents', () => {
    it('should return non-virtual agents for the user', async () => {
      // Create non-virtual agents
      await agentModel.create({
        title: 'Agent 1',
        description: 'First agent',
        avatar: 'avatar1',
        backgroundColor: '#ff0000',
        virtual: false,
      });
      await agentModel.create({
        title: 'Agent 2',
        description: 'Second agent',
        avatar: 'avatar2',
        backgroundColor: '#00ff00',
        virtual: false,
      });

      const result = await agentModel.queryAgents();

      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result.some((a: { title: string | null }) => a.title === 'Agent 1')).toBe(true);
      expect(result.some((a: { title: string | null }) => a.title === 'Agent 2')).toBe(true);
      // Check that only required fields are returned
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('title');
      expect(result[0]).toHaveProperty('description');
      expect(result[0]).toHaveProperty('avatar');
      expect(result[0]).toHaveProperty('backgroundColor');
    });

    it('should exclude virtual agents', async () => {
      // Create a virtual agent
      await agentModel.create({
        title: 'Virtual Agent',
        virtual: true,
      });
      // Create a non-virtual agent
      await agentModel.create({
        title: 'Regular Agent',
        virtual: false,
      });

      const result = await agentModel.queryAgents();

      expect(result.some((a: { title: string | null }) => a.title === 'Virtual Agent')).toBe(false);
      expect(result.some((a: { title: string | null }) => a.title === 'Regular Agent')).toBe(true);
    });

    it('should only return agents for the current user', async () => {
      // Create agent for user 1
      await agentModel.create({
        title: 'User1 Agent',
        virtual: false,
      });
      // Create agent for user 2
      await agentModel2.create({
        title: 'User2 Agent',
        virtual: false,
      });

      const result1 = await agentModel.queryAgents();
      const result2 = await agentModel2.queryAgents();

      expect(result1.some((a: { title: string | null }) => a.title === 'User1 Agent')).toBe(true);
      expect(result1.some((a: { title: string | null }) => a.title === 'User2 Agent')).toBe(false);
      expect(result2.some((a: { title: string | null }) => a.title === 'User2 Agent')).toBe(true);
      expect(result2.some((a: { title: string | null }) => a.title === 'User1 Agent')).toBe(false);
    });

    it('should return empty array when no agents exist', async () => {
      // Use a new user with no agents
      const emptyUserId = 'empty-user-id';
      await serverDB.insert(users).values({ id: emptyUserId });
      const emptyAgentModel = new AgentModel(serverDB, emptyUserId);

      const result = await emptyAgentModel.queryAgents();

      expect(result).toEqual([]);
    });

    it('should handle agents with null virtual field (treat as non-virtual)', async () => {
      // Directly insert agent with null virtual (simulating legacy data)
      await serverDB.insert(agents).values({
        id: 'null-virtual-agent',
        title: 'Null Virtual Agent',
        userId,
        virtual: null as unknown as boolean,
      });

      const result = await agentModel.queryAgents();

      expect(result.some((a: { title: string | null }) => a.title === 'Null Virtual Agent')).toBe(
        true,
      );
    });

    it('should filter by keyword in title and description', async () => {
      await agentModel.create({
        title: 'Code Assistant',
        description: 'Helps with coding',
        virtual: false,
      });
      await agentModel.create({
        title: 'Writer',
        description: 'Helps with writing tasks',
        virtual: false,
      });
      await agentModel.create({
        title: 'Designer',
        description: 'Helps with design code review',
        virtual: false,
      });

      // Search by title
      const codeResults = await agentModel.queryAgents({ keyword: 'Code' });
      expect(codeResults.some((a: { title: string | null }) => a.title === 'Code Assistant')).toBe(
        true,
      );
      expect(codeResults.some((a: { title: string | null }) => a.title === 'Designer')).toBe(true); // matches 'code' in description
      expect(codeResults.some((a: { title: string | null }) => a.title === 'Writer')).toBe(false);

      // Search by description
      const writingResults = await agentModel.queryAgents({ keyword: 'writing' });
      expect(writingResults.some((a: { title: string | null }) => a.title === 'Writer')).toBe(true);
    });

    it('should respect limit and offset parameters', async () => {
      // Create multiple agents
      for (let i = 1; i <= 5; i++) {
        await agentModel.create({
          title: `Agent ${i}`,
          virtual: false,
        });
      }

      const limitedResults = await agentModel.queryAgents({ limit: 2 });
      expect(limitedResults.length).toBe(2);

      const offsetResults = await agentModel.queryAgents({ limit: 2, offset: 2 });
      expect(offsetResults.length).toBe(2);
    });
  });
});
