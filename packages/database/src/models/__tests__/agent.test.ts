// @vitest-environment node
import { DEFAULT_INBOX_AVATAR, DEFAULT_INBOX_TITLE, INBOX_SESSION_ID } from '@lobechat/const';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { NewAgent } from '../../schemas';
import {
  agents,
  agentsFiles,
  agentsKnowledgeBases,
  agentsToSessions,
  devices,
  documents,
  files,
  knowledgeBases,
  sessionGroups,
  sessions,
  topics,
  users,
  workspaces,
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
  describe('existsOwnedById', () => {
    it('is true only for the agent creator (edit-rights gate), not merely visibility', async () => {
      const ownAgent = 'owned-agent-id';
      const othersAgent = 'others-agent-id';
      await serverDB.insert(agents).values([
        { id: ownAgent, userId },
        { id: othersAgent, userId: userId2 },
      ]);

      expect(await agentModel.existsOwnedById(ownAgent)).toBe(true);
      // Another user's agent is not "owned" even if it were visible.
      expect(await agentModel.existsOwnedById(othersAgent)).toBe(false);
      // Its actual creator passes.
      expect(await agentModel2.existsOwnedById(othersAgent)).toBe(true);
    });
  });

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

  describe('getAgentModelConfig', () => {
    it('returns model + provider when both are configured', async () => {
      const agentId = 'snap-agent-1';
      await serverDB
        .insert(agents)
        .values({ id: agentId, model: 'claude-sonnet-4-6', provider: 'anthropic', userId });

      const result = await agentModel.getAgentModelConfig(agentId);

      expect(result).toEqual({ model: 'claude-sonnet-4-6', provider: 'anthropic' });
    });

    it('resolves by slug when id does not match', async () => {
      const agentId = 'snap-agent-by-slug';
      const slug = 'snap-slug';
      await serverDB
        .insert(agents)
        .values({ id: agentId, model: 'gpt-4o', provider: 'openai', slug, userId });

      const result = await agentModel.getAgentModelConfig(slug);

      expect(result).toEqual({ model: 'gpt-4o', provider: 'openai' });
    });

    it('returns null when model or provider is missing', async () => {
      const agentId = 'snap-agent-incomplete';
      await serverDB.insert(agents).values({ id: agentId, model: 'gpt-4o', userId });

      const result = await agentModel.getAgentModelConfig(agentId);

      expect(result).toBeNull();
    });

    it('does not leak across users', async () => {
      const agentId = 'snap-agent-other-user';
      await serverDB
        .insert(agents)
        .values({ id: agentId, model: 'gpt-4o', provider: 'openai', userId: userId2 });

      const result = await agentModel.getAgentModelConfig(agentId);

      expect(result).toBeNull();
    });
  });

  describe('getAgentSnapshotForTaskCreate', () => {
    it('returns model/provider snapshot + visibility in one call', async () => {
      const agentId = 'snap-task-create-1';
      await serverDB.insert(agents).values({
        id: agentId,
        model: 'claude-sonnet-4-6',
        provider: 'anthropic',
        userId,
        visibility: 'private',
      });

      const result = await agentModel.getAgentSnapshotForTaskCreate(agentId);

      expect(result).toEqual({
        snapshot: { model: 'claude-sonnet-4-6', provider: 'anthropic' },
        visibility: 'private',
      });
    });

    it('returns null when the agent is not visible to the current caller', async () => {
      const agentId = 'snap-task-create-other-user';
      await serverDB.insert(agents).values({
        id: agentId,
        model: 'gpt-4o',
        provider: 'openai',
        userId: userId2,
      });

      const result = await agentModel.getAgentSnapshotForTaskCreate(agentId);

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

    it('nulls out a mounted KB / file that the caller can no longer read', async () => {
      // Workspace: A owns a public KB + public file and mounts them onto a
      // public agent. B (another member) sees both mounts in the editor.
      // After A flips both back to `private`, the mount rows
      // should stay (so the UI can render an "unavailable" placeholder), but
      // the joined entity fields must be nulled so no name / description
      // leaks and the runtime skips the KB via its `k.id` filter.
      const wsId = 'agent-knowledge-vis-ws';
      await serverDB.insert(workspaces).values({
        id: wsId,
        name: 'kv-ws',
        primaryOwnerId: userId,
        slug: wsId,
      });

      await serverDB.insert(knowledgeBases).values({
        id: 'kb-vis',
        userId,
        workspaceId: wsId,
        name: 'Shared KB',
        visibility: 'public',
      });
      await serverDB.insert(files).values({
        id: 'file-vis',
        userId,
        workspaceId: wsId,
        name: 'shared.pdf',
        url: 'https://a.com/shared.pdf',
        size: 42,
        fileType: 'application/pdf',
        visibility: 'public',
      });

      const agentId = 'agent-vis';
      await serverDB.insert(agents).values({
        id: agentId,
        userId,
        workspaceId: wsId,
        visibility: 'public',
      });
      await serverDB.insert(agentsKnowledgeBases).values({
        agentId,
        knowledgeBaseId: 'kb-vis',
        userId,
        workspaceId: wsId,
        enabled: true,
      });
      await serverDB.insert(agentsFiles).values({
        agentId,
        fileId: 'file-vis',
        userId,
        workspaceId: wsId,
        enabled: true,
      });

      const wsMemberModel = new AgentModel(serverDB, userId2, wsId);

      const beforeUnpublish = await wsMemberModel.getAgentAssignedKnowledge(agentId);
      expect(beforeUnpublish.knowledgeBases[0]?.id).toBe('kb-vis');
      expect(beforeUnpublish.files[0]?.id).toBe('file-vis');

      // Creator flips both back to private
      await serverDB
        .update(knowledgeBases)
        .set({ visibility: 'private' })
        .where(eq(knowledgeBases.id, 'kb-vis'));
      await serverDB.update(files).set({ visibility: 'private' }).where(eq(files.id, 'file-vis'));

      const afterUnpublish = await wsMemberModel.getAgentAssignedKnowledge(agentId);
      // Mount rows still present (so UI can render an "unavailable" tile) but
      // the joined KB / file entity is missing — the `leftJoin`'s null side
      // spreads to nothing, leaving only the mount metadata (`enabled`). UI
      // checks `!item.id` and the runtime's `k.id` filter naturally skips.
      expect(afterUnpublish.knowledgeBases).toHaveLength(1);
      expect(afterUnpublish.knowledgeBases[0]?.id).toBeUndefined();
      expect(afterUnpublish.knowledgeBases[0]?.name).toBeUndefined();
      expect(afterUnpublish.knowledgeBases[0]?.enabled).toBe(true);
      expect(afterUnpublish.files).toHaveLength(1);
      expect(afterUnpublish.files[0]?.id).toBeUndefined();
      expect(afterUnpublish.files[0]?.name).toBeUndefined();
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

    it("should strip identity fields when updating the Agent Builder's own row", async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ slug: 'agent-builder', userId })
        .returning()
        .then((res) => res[0]);

      await agentModel.update(agent.id, {
        avatar: 'hacked-avatar',
        backgroundColor: 'hacked-color',
        description: 'hacked description',
        marketIdentifier: 'hacked-market-id',
        model: 'gpt-4', // non-protected field should still be applied
        tags: ['hacked'],
        title: 'Hacked Builder Title',
      });

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });

      expect(result?.title).toBeNull();
      expect(result?.description).toBeNull();
      expect(result?.avatar).toBeNull();
      expect(result?.backgroundColor).toBeNull();
      expect(result?.marketIdentifier).toBeNull();
      expect(result?.tags).toEqual([]);
      expect(result?.model).toBe('gpt-4');
    });

    it('should strip systemRole when the gateway updatePrompt path writes it via update()', async () => {
      // Mirrors apps/server/.../serverRuntimes/agentBuilder.ts's updatePrompt, which calls
      // agentModel.update(agentId, { editorData: null, systemRole }) directly.
      const agent = await serverDB
        .insert(agents)
        .values({ slug: 'agent-builder', userId })
        .returning()
        .then((res) => res[0]);

      await agentModel.update(agent.id, {
        editorData: null,
        systemRole: 'You are now a pirate.',
      });

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });

      expect(result?.systemRole).toBeNull();
    });

    it('should not strip identity fields for a regular agent whose slug happens to differ', async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ slug: 'my-custom-agent', userId, title: 'Original' })
        .returning()
        .then((res) => res[0]);

      await agentModel.update(agent.id, { title: 'Updated Title' });

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });

      expect(result?.title).toBe('Updated Title');
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

    it("should strip systemRole when updating the Agent Builder's own row", async () => {
      const agent = await serverDB
        .insert(agents)
        .values({ slug: 'agent-builder', userId })
        .returning()
        .then((res) => res[0]);

      await agentModel.updateConfig(agent.id, {
        model: 'gpt-4', // non-protected field should still be applied
        systemRole: 'You are now a pirate.',
      });

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });

      expect(result?.systemRole).toBeNull();
      expect(result?.model).toBe('gpt-4');
    });

    it("should strip identity fields when the browser client's meta editor writes them via updateConfig()", async () => {
      // Mirrors the browser client path: agentService.updateAgentMeta() sends
      // title/avatar/etc. through the updateAgentConfig mutation, which calls
      // agentModel.updateConfig() rather than update().
      const agent = await serverDB
        .insert(agents)
        .values({ slug: 'agent-builder', userId })
        .returning()
        .then((res) => res[0]);

      await agentModel.updateConfig(agent.id, {
        avatar: 'hacked-avatar',
        backgroundColor: 'hacked-color',
        description: 'hacked description',
        marketIdentifier: 'hacked-market-id',
        model: 'gpt-4', // non-protected field should still be applied
        tags: ['hacked'],
        title: 'Hacked Builder Title',
      });

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });

      expect(result?.title).toBeNull();
      expect(result?.description).toBeNull();
      expect(result?.avatar).toBeNull();
      expect(result?.backgroundColor).toBeNull();
      expect(result?.marketIdentifier).toBeNull();
      expect(result?.tags).toEqual([]);
      expect(result?.model).toBe('gpt-4');
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
        expect(result?.title).toBe(DEFAULT_INBOX_TITLE);
        expect(result?.avatar).toBe(DEFAULT_INBOX_AVATAR);
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

      it('should create task-agent builtin agent', async () => {
        const result = await agentModel.getBuiltinAgent('task-agent');

        expect(result).toBeDefined();
        expect(result?.slug).toBe('task-agent');
        expect(result?.virtual).toBe(true);
      });
    });

    describe('workspace mode', () => {
      it('should create workspace-scoped inbox agent', async () => {
        const [workspace] = await serverDB
          .insert(workspaces)
          .values({ name: 'ws', primaryOwnerId: userId, slug: 'ws-slug' })
          .returning();

        const wsAgentModel = new AgentModel(serverDB, userId, workspace.id);
        const result = await wsAgentModel.getBuiltinAgent(INBOX_SESSION_ID);

        expect(result).toBeDefined();
        expect(result?.slug).toBe(INBOX_SESSION_ID);
        expect(result?.workspaceId).toBe(workspace.id);
        expect(result?.userId).toBe(userId);
      });

      it('should allow workspace inbox to coexist with personal inbox for the same user', async () => {
        const personal = await agentModel.getBuiltinAgent(INBOX_SESSION_ID);
        expect(personal?.workspaceId).toBeNull();

        const [workspace] = await serverDB
          .insert(workspaces)
          .values({ name: 'ws2', primaryOwnerId: userId, slug: 'ws2-slug' })
          .returning();

        const wsAgentModel = new AgentModel(serverDB, userId, workspace.id);
        const ws = await wsAgentModel.getBuiltinAgent(INBOX_SESSION_ID);

        expect(ws?.id).not.toBe(personal?.id);
        expect(ws?.workspaceId).toBe(workspace.id);
      });

      it('should be idempotent in workspace mode', async () => {
        const [workspace] = await serverDB
          .insert(workspaces)
          .values({ name: 'ws3', primaryOwnerId: userId, slug: 'ws3-slug' })
          .returning();

        const wsAgentModel = new AgentModel(serverDB, userId, workspace.id);
        const first = await wsAgentModel.getBuiltinAgent(INBOX_SESSION_ID);
        const second = await wsAgentModel.getBuiltinAgent(INBOX_SESSION_ID);

        expect(first?.id).toBe(second?.id);
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

    it('should derive heteroType from agencyConfig.heterogeneousProvider', async () => {
      await serverDB.insert(agents).values({
        agencyConfig: { heterogeneousProvider: { type: 'claude-code' } },
        id: 'hetero-agent',
        title: 'CC 2号机',
        userId,
        virtual: false,
      });
      await agentModel.create({ title: 'Normal Agent', virtual: false });

      const result = await agentModel.queryAgents();

      const hetero = result.find((a) => a.id === 'hetero-agent');
      const normal = result.find((a) => a.title === 'Normal Agent');
      expect(hetero?.heteroType).toBe('claude-code');
      expect(normal?.heteroType).toBeUndefined();
      // raw agencyConfig must not leak into the result payload
      expect(hetero).not.toHaveProperty('agencyConfig');
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

    it('should fallback inbox agent meta by slug', async () => {
      await serverDB.insert(agents).values({
        avatar: null,
        id: 'inbox-agent-query',
        slug: INBOX_SESSION_ID,
        title: null,
        userId,
        virtual: null as unknown as boolean,
      });

      const result = await agentModel.queryAgents();
      const inbox = result.find((agent) => agent.id === 'inbox-agent-query');

      expect(inbox).toMatchObject({
        avatar: DEFAULT_INBOX_AVATAR,
        title: DEFAULT_INBOX_TITLE,
      });
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

  describe('countAgents', () => {
    it('should count all non-virtual agents regardless of pagination', async () => {
      for (let i = 1; i <= 5; i++) {
        await agentModel.create({
          title: `Agent ${i}`,
          virtual: false,
        });
      }
      await agentModel.create({
        title: 'Virtual Agent',
        virtual: true,
      });

      const total = await agentModel.countAgents();

      expect(total).toBe(5);
      // count stays the full total even when queryAgents is limited
      const limitedResults = await agentModel.queryAgents({ limit: 2 });
      expect(limitedResults.length).toBe(2);
    });

    it('should apply the same keyword filter as queryAgents', async () => {
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

      // matches 'Code Assistant' (title) and 'Designer' (description)
      expect(await agentModel.countAgents({ keyword: 'code' })).toBe(2);
      expect(await agentModel.countAgents({ keyword: 'writing' })).toBe(1);
      expect(await agentModel.countAgents({ keyword: 'nonexistent' })).toBe(0);
    });

    it('should only count agents for the current user', async () => {
      await agentModel.create({ title: 'User1 Agent', virtual: false });
      await agentModel2.create({ title: 'User2 Agent', virtual: false });

      expect(await agentModel.countAgents()).toBe(1);
      expect(await agentModel2.countAgents()).toBe(1);
    });

    it('should count agents with null virtual field (treat as non-virtual)', async () => {
      await serverDB.insert(agents).values({
        id: 'null-virtual-agent-count',
        title: 'Null Virtual Agent',
        userId,
        virtual: null as unknown as boolean,
      });

      expect(await agentModel.countAgents()).toBe(1);
    });

    it('should apply endDate / startDate / range filters against createdAt', async () => {
      await serverDB.insert(agents).values([
        {
          id: 'old-agent',
          title: 'Old Agent',
          userId,
          virtual: false,
          createdAt: new Date('2024-01-01T00:00:00Z'),
        },
        {
          id: 'mid-agent',
          title: 'Mid Agent',
          userId,
          virtual: false,
          createdAt: new Date('2024-06-01T00:00:00Z'),
        },
        {
          id: 'new-agent',
          title: 'New Agent',
          userId,
          virtual: false,
          createdAt: new Date('2024-12-01T00:00:00Z'),
        },
      ]);

      expect(await agentModel.countAgents({ endDate: '2024-03-01' })).toBe(1);
      expect(await agentModel.countAgents({ startDate: '2024-07-01' })).toBe(1);
      expect(await agentModel.countAgents({ range: ['2024-05-01', '2024-07-01'] })).toBe(1);
    });
  });

  describe('checkByMarketIdentifier', () => {
    it('should return true when agent with marketIdentifier exists', async () => {
      await serverDB.insert(agents).values({
        userId,
        title: 'Market Agent',
        marketIdentifier: 'market-test-123',
      });

      const result = await agentModel.checkByMarketIdentifier('market-test-123');
      expect(result).toBe(true);
    });

    it('should return false when no agent with marketIdentifier exists', async () => {
      const result = await agentModel.checkByMarketIdentifier('non-existent-market-id');
      expect(result).toBe(false);
    });

    it('should not find agents belonging to other users', async () => {
      await serverDB.insert(agents).values({
        userId: userId2,
        title: 'Other User Agent',
        marketIdentifier: 'other-user-market',
      });

      const result = await agentModel.checkByMarketIdentifier('other-user-market');
      expect(result).toBe(false);
    });
  });

  describe('getAgentByMarketIdentifier', () => {
    it('should return agent id when found', async () => {
      const [agent] = await serverDB
        .insert(agents)
        .values({ userId, title: 'Market Agent', marketIdentifier: 'market-get-123' })
        .returning();

      const result = await agentModel.getAgentByMarketIdentifier('market-get-123');
      expect(result).toBe(agent.id);
    });

    it('should return null when not found', async () => {
      const result = await agentModel.getAgentByMarketIdentifier('nonexistent');
      expect(result).toBeNull();
    });

    it('should return the most recently updated agent when multiple match', async () => {
      const [older] = await serverDB
        .insert(agents)
        .values({ userId, title: 'Older', marketIdentifier: 'dup-market' })
        .returning();

      await new Promise((resolve) => setTimeout(resolve, 10));

      const [newer] = await serverDB
        .insert(agents)
        .values({ userId, title: 'Newer', marketIdentifier: 'dup-market' })
        .returning();

      const result = await agentModel.getAgentByMarketIdentifier('dup-market');
      expect(result).toBe(newer.id);
    });

    it('should not return agents from other users', async () => {
      await serverDB.insert(agents).values({
        userId: userId2,
        title: 'Other',
        marketIdentifier: 'other-market-get',
      });

      const result = await agentModel.getAgentByMarketIdentifier('other-market-get');
      expect(result).toBeNull();
    });
  });

  describe('getAgentByForkedFromIdentifier', () => {
    it('should return agent id when forkedFromIdentifier matches', async () => {
      const [agent] = await serverDB
        .insert(agents)
        .values({
          userId,
          title: 'Forked Agent',
          params: { forkedFromIdentifier: 'source-market-id' },
        })
        .returning();

      const result = await agentModel.getAgentByForkedFromIdentifier('source-market-id');
      expect(result).toBe(agent.id);
    });

    it('should return null when no match', async () => {
      const result = await agentModel.getAgentByForkedFromIdentifier('no-match');
      expect(result).toBeNull();
    });

    it('should not return agents from other users', async () => {
      await serverDB.insert(agents).values({
        userId: userId2,
        title: 'Other Forked',
        params: { forkedFromIdentifier: 'other-fork-id' },
      });

      const result = await agentModel.getAgentByForkedFromIdentifier('other-fork-id');
      expect(result).toBeNull();
    });
  });

  describe('updateSessionGroupId', () => {
    it('should update agent sessionGroupId', async () => {
      const [group] = await serverDB
        .insert(sessionGroups)
        .values({ userId, name: 'Test Group' })
        .returning();

      const [agent] = await serverDB.insert(agents).values({ userId, title: 'Agent' }).returning();

      const result = await agentModel.updateSessionGroupId(agent.id, group.id);

      expect(result).toBeDefined();
      expect(result.sessionGroupId).toBe(group.id);
    });

    it('should set sessionGroupId to null', async () => {
      const [group] = await serverDB
        .insert(sessionGroups)
        .values({ userId, name: 'Group' })
        .returning();

      const [agent] = await serverDB
        .insert(agents)
        .values({ userId, title: 'Agent', sessionGroupId: group.id })
        .returning();

      const result = await agentModel.updateSessionGroupId(agent.id, null);
      expect(result.sessionGroupId).toBeNull();
    });

    it('should not update agents from other users', async () => {
      const [agent] = await serverDB
        .insert(agents)
        .values({ userId, title: 'User1 Agent' })
        .returning();

      const result = await agentModel2.updateSessionGroupId(agent.id, null);
      expect(result).toBeUndefined();
    });
  });

  describe('updateConfig workspace device binding', () => {
    const wsId = 'device-binding-ws';

    const seedWorkspace = async () => {
      await serverDB.insert(workspaces).values({
        id: wsId,
        name: 'device-ws',
        primaryOwnerId: userId,
        slug: wsId,
      });
      await serverDB.insert(devices).values({
        deviceId: 'ws-device-1',
        identitySource: 'machine-id',
        userId,
        workspaceId: wsId,
      });
    };

    it('rejects binding a device not enrolled in the workspace', async () => {
      await seedWorkspace();
      const [agent] = await serverDB
        .insert(agents)
        .values({ userId, visibility: 'public', workspaceId: wsId } as NewAgent)
        .returning();

      const wsModel = new AgentModel(serverDB, userId, wsId);
      await expect(
        wsModel.updateConfig(agent.id, {
          agencyConfig: { boundDeviceId: 'personal-device-x', executionTarget: 'device' },
        } as any),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('allows binding an enrolled workspace device', async () => {
      await seedWorkspace();
      const [agent] = await serverDB
        .insert(agents)
        .values({ userId, visibility: 'public', workspaceId: wsId } as NewAgent)
        .returning();

      const wsModel = new AgentModel(serverDB, userId, wsId);
      await wsModel.updateConfig(agent.id, {
        agencyConfig: { boundDeviceId: 'ws-device-1', executionTarget: 'device' },
      } as any);

      const result = await serverDB.query.agents.findFirst({ where: eq(agents.id, agent.id) });
      expect(result?.agencyConfig).toMatchObject({
        boundDeviceId: 'ws-device-1',
        executionTarget: 'device',
      });
    });

    it('grandfathers legacy device ids already stored on the agent', async () => {
      await seedWorkspace();
      // A stale personal-device reference left from before the agent joined the
      // workspace (the device row no longer exists at all). Client patches
      // spread the whole stored agencyConfig, so without grandfathering this
      // agent could never bind any device again.
      const [agent] = await serverDB
        .insert(agents)
        .values({
          agencyConfig: {
            boundDeviceId: 'stale-personal-device',
            executionTarget: 'local',
            workingDirByDevice: { 'stale-personal-device': '/Users/old/dir' },
          },
          userId,
          visibility: 'public',
          workspaceId: wsId,
        } as NewAgent)
        .returning();

      const wsModel = new AgentModel(serverDB, userId, wsId);
      await wsModel.updateConfig(agent.id, {
        agencyConfig: {
          boundDeviceId: 'ws-device-1',
          executionTarget: 'device',
          workingDirByDevice: { 'stale-personal-device': '/Users/old/dir' },
        },
      } as any);

      const result = await serverDB.query.agents.findFirst({ where: eq(agents.id, agent.id) });
      expect(result?.agencyConfig).toMatchObject({
        boundDeviceId: 'ws-device-1',
        executionTarget: 'device',
      });
    });

    it('still rejects a NEW non-workspace device id even alongside grandfathered ones', async () => {
      await seedWorkspace();
      const [agent] = await serverDB
        .insert(agents)
        .values({
          agencyConfig: {
            boundDeviceId: 'stale-personal-device',
            executionTarget: 'local',
          },
          userId,
          visibility: 'public',
          workspaceId: wsId,
        } as NewAgent)
        .returning();

      const wsModel = new AgentModel(serverDB, userId, wsId);
      await expect(
        wsModel.updateConfig(agent.id, {
          agencyConfig: {
            boundDeviceId: 'stale-personal-device',
            executionTarget: 'device',
            workingDirByDevice: { 'another-personal-device': '/tmp' },
          },
        } as any),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('updateConfig edge cases', () => {
    it('should return early for null data', async () => {
      const [agent] = await serverDB
        .insert(agents)
        .values({ userId, title: 'Original' })
        .returning();

      const result = await agentModel.updateConfig(agent.id, null);
      expect(result).toBeUndefined();

      const dbAgent = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });
      expect(dbAgent?.title).toBe('Original');
    });

    it('should return early for undefined data', async () => {
      const [agent] = await serverDB
        .insert(agents)
        .values({ userId, title: 'Original' })
        .returning();

      const result = await agentModel.updateConfig(agent.id, undefined);
      expect(result).toBeUndefined();
    });

    it('should return early for empty object', async () => {
      const [agent] = await serverDB
        .insert(agents)
        .values({ userId, title: 'Original' })
        .returning();

      const result = await agentModel.updateConfig(agent.id, {});
      expect(result).toBeUndefined();
    });

    it('should return early for non-existent agent', async () => {
      const result = await agentModel.updateConfig('non-existent-id', { title: 'New' });
      expect(result).toBeUndefined();
    });

    it('should merge nested chatConfig fields without replacing the whole object', async () => {
      const [agent] = await serverDB
        .insert(agents)
        .values({
          chatConfig: { enableHistoryCount: true, historyCount: 10 },
          title: 'Chat Config Agent',
          userId,
        } as NewAgent)
        .returning();

      await agentModel.updateConfig(agent.id, {
        chatConfig: { enableReasoning: true } as any,
      });

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });

      expect(result?.chatConfig).toEqual({
        enableHistoryCount: true,
        enableReasoning: true,
        historyCount: 10,
      });
    });

    it('should delete params field when value is undefined', async () => {
      const [agent] = await serverDB
        .insert(agents)
        .values({
          userId,
          title: 'Params Agent',
          params: { temperature: 0.7, topP: 0.9 },
        })
        .returning();

      await agentModel.updateConfig(agent.id, {
        params: { temperature: undefined } as any,
      });

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });

      // temperature should be deleted, topP should remain
      expect((result?.params as any)?.temperature).toBeUndefined();
      expect((result?.params as any)?.topP).toBe(0.9);
    });

    it('should handle null param values (disable flag)', async () => {
      const [agent] = await serverDB
        .insert(agents)
        .values({
          userId,
          title: 'Params Agent',
          params: { temperature: 0.7 },
        })
        .returning();

      await agentModel.updateConfig(agent.id, {
        params: { temperature: null, topP: 0.5 } as any,
      });

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });

      expect((result?.params as any)?.temperature).toBeNull();
      expect((result?.params as any)?.topP).toBe(0.5);
    });

    it('should delete a workingDirByDevice entry when value is undefined', async () => {
      const [agent] = await serverDB
        .insert(agents)
        .values({
          userId,
          title: 'Cwd Agent',
          agencyConfig: {
            executionTarget: 'local',
            workingDirByDevice: { 'device-a': '/a', 'device-b': '/b' },
          },
        } as NewAgent)
        .returning();

      await agentModel.updateConfig(agent.id, {
        agencyConfig: { workingDirByDevice: { 'device-a': undefined } } as any,
      });

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });

      // device-a cleared; device-b and sibling fields preserved
      expect((result?.agencyConfig as any)?.workingDirByDevice).toEqual({ 'device-b': '/b' });
      expect((result?.agencyConfig as any)?.executionTarget).toBe('local');
    });

    it('should still upsert a workingDirByDevice entry when value is a path', async () => {
      const [agent] = await serverDB
        .insert(agents)
        .values({
          userId,
          title: 'Cwd Agent',
          agencyConfig: { workingDirByDevice: { 'device-a': '/a' } },
        } as NewAgent)
        .returning();

      await agentModel.updateConfig(agent.id, {
        agencyConfig: { workingDirByDevice: { 'device-a': '/a', 'device-b': '/b' } } as any,
      });

      const result = await serverDB.query.agents.findFirst({
        where: eq(agents.id, agent.id),
      });

      expect((result?.agencyConfig as any)?.workingDirByDevice).toEqual({
        'device-a': '/a',
        'device-b': '/b',
      });
    });
  });

  describe('rank', () => {
    it('should rank agents by topic count, excluding agents with no topics', async () => {
      await serverDB.insert(agents).values([
        { avatar: 'av1', backgroundColor: 'bg1', id: 'ra1', title: 'Agent 1', userId },
        { id: 'ra2', title: 'Agent 2', userId },
        { id: 'ra3', title: 'Agent 3', userId }, // no topics → excluded
      ]);
      await serverDB.insert(topics).values([
        { agentId: 'ra1', id: 'rt1', userId },
        { agentId: 'ra1', id: 'rt2', userId },
        { agentId: 'ra1', id: 'rt3', userId },
        { agentId: 'ra2', id: 'rt4', userId },
        { agentId: 'ra2', id: 'rt5', userId },
      ]);

      const result = await agentModel.rank();

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        avatar: 'av1',
        backgroundColor: 'bg1',
        count: 3,
        id: 'ra1',
        title: 'Agent 1',
      });
      expect(result[1]).toMatchObject({ count: 2, id: 'ra2' });
    });

    it('should include the inbox agent but exclude other virtual agents', async () => {
      await serverDB.insert(agents).values([
        { id: 'inbox-agent', slug: 'inbox', title: 'Inbox', userId, virtual: true },
        { id: 'virtual-agent', title: 'Virtual', userId, virtual: true },
        { id: 'normal-agent', title: 'Normal', userId },
      ]);
      await serverDB.insert(topics).values([
        { agentId: 'inbox-agent', id: 'it1', userId },
        { agentId: 'virtual-agent', id: 'vt1', userId },
        { agentId: 'normal-agent', id: 'nt1', userId },
      ]);

      const ids = (await agentModel.rank()).map((r) => r.id);

      expect(ids).toContain('inbox-agent');
      expect(ids).toContain('normal-agent');
      expect(ids).not.toContain('virtual-agent');
    });

    it('should only rank the current user agents', async () => {
      await serverDB.insert(agents).values([
        { id: 'mine', title: 'Mine', userId },
        { id: 'theirs', title: 'Theirs', userId: userId2 },
      ]);
      await serverDB.insert(topics).values([
        { agentId: 'mine', id: 'mt1', userId },
        { agentId: 'theirs', id: 'tt1', userId: userId2 },
      ]);

      const result = await agentModel.rank();

      expect(result.map((r) => r.id)).toEqual(['mine']);
    });

    it('should respect the limit parameter', async () => {
      await serverDB.insert(agents).values([
        { id: 'la1', title: 'A1', userId },
        { id: 'la2', title: 'A2', userId },
      ]);
      await serverDB.insert(topics).values([
        { agentId: 'la1', id: 'lt1', userId },
        { agentId: 'la2', id: 'lt2', userId },
      ]);

      const result = await agentModel.rank(1);

      expect(result).toHaveLength(1);
    });
  });

  describe('listMessengerBindableAgents', () => {
    it('should keep the inbox, exclude other virtual agents, pin inbox first, and fallback its meta', async () => {
      await serverDB.insert(agents).values([
        // Inbox is the oldest, yet must be pinned to the top.
        {
          avatar: null,
          id: 'mb-inbox',
          slug: INBOX_SESSION_ID,
          title: null,
          updatedAt: new Date('2023-01-01'),
          userId,
          virtual: true,
        },
        {
          id: 'mb-normal',
          title: 'Normal',
          updatedAt: new Date('2024-01-01'),
          userId,
        },
        { id: 'mb-virtual', title: 'Virtual', userId, virtual: true },
      ]);

      const result = await agentModel.listMessengerBindableAgents();

      expect(result.map((r) => r.id)).toEqual(['mb-inbox', 'mb-normal']);
      expect(result[0]).toMatchObject({
        avatar: DEFAULT_INBOX_AVATAR,
        id: 'mb-inbox',
        isInbox: true,
        title: DEFAULT_INBOX_TITLE,
      });
      expect(result[1]).toMatchObject({ id: 'mb-normal', isInbox: false, title: 'Normal' });
    });

    it('should fall back a blank non-inbox title to options.fallbackTitle (null by default)', async () => {
      await serverDB.insert(agents).values([
        { id: 'mb-blank', title: null, userId },
        { id: 'mb-named', title: 'Named', userId },
      ]);

      const withoutFallback = await agentModel.listMessengerBindableAgents();
      expect(withoutFallback.find((r) => r.id === 'mb-blank')?.title).toBeNull();

      const withFallback = await agentModel.listMessengerBindableAgents({
        fallbackTitle: 'Custom Agent',
      });
      expect(withFallback.find((r) => r.id === 'mb-blank')?.title).toBe('Custom Agent');
      // A real title is never overridden by the fallback.
      expect(withFallback.find((r) => r.id === 'mb-named')?.title).toBe('Named');
    });

    it('should only list the current user agents', async () => {
      await serverDB.insert(agents).values([
        { id: 'mb-mine', title: 'Mine', userId },
        { id: 'mb-theirs', title: 'Theirs', userId: userId2 },
      ]);

      const result = await agentModel.listMessengerBindableAgents();

      expect(result.map((r) => r.id)).toEqual(['mb-mine']);
    });
  });
});
