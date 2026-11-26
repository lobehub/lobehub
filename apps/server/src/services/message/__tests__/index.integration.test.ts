// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import {
  agents,
  agentsToSessions,
  files,
  messageGroups,
  messages,
  messagesFiles,
  sessions,
  topics,
  users,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { HeterogeneousAgentSessionErrorCode } from '@lobechat/electron-client-ipc';
import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { MessageGroupType } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageService } from '../index';

// Mock FileService to avoid S3 environment variable requirements
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return {
      // Carries both inputs, so a caller passing the wrong id or path shows up.
      getFileAccessUrl: vi.fn().mockImplementation(async function (file: {
        id?: string;
        url: string;
      }) {
        return `/proxy/${file.id}?path=${file.url}`;
      }),
      getFullFileUrl: vi.fn().mockImplementation(function (path: string) {
        return path ? `/files${path}` : null;
      }),
    };
  }),
}));

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-service-integration-test';
const otherUserId = 'message-service-integration-test-other';

beforeEach(async () => {
  await serverDB.transaction(async (trx) => {
    await trx.delete(users).where(eq(users.id, userId));
    await trx.delete(users).where(eq(users.id, otherUserId));
    await trx.insert(users).values([{ id: userId }, { id: otherUserId }]);

    await trx.insert(files).values({
      id: 'f1',
      userId,
      url: 'abc',
      name: 'file-1',
      fileType: 'image/png',
      size: 1000,
    });
  });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('MessageService Integration Tests', () => {
  describe('createMessage', () => {
    it('should create message with agentId and return message list', async () => {
      const messageService = new MessageService(serverDB, userId);

      // Create agent and session
      await serverDB.insert(agents).values({ id: 'agent-1', userId });
      await serverDB.insert(sessions).values({ id: 'session-1', userId });
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: 'agent-1', sessionId: 'session-1', userId });

      const result = await messageService.createMessage({
        agentId: 'agent-1',
        content: 'Hello world',
        role: 'user',
      });

      expect(result.id).toBeDefined();
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('Hello world');
      expect(result.messages[0].role).toBe('user');
    });

    it('should create message with topicId', async () => {
      const messageService = new MessageService(serverDB, userId);

      await serverDB.insert(agents).values({ id: 'agent-1', userId });
      await serverDB.insert(sessions).values({ id: 'session-1', userId });
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: 'agent-1', sessionId: 'session-1', userId });
      await serverDB.insert(topics).values({ id: 'topic-1', userId, sessionId: 'session-1' });

      const result = await messageService.createMessage({
        agentId: 'agent-1',
        content: 'Topic message',
        role: 'user',
        topicId: 'topic-1',
      });

      expect(result.id).toBeDefined();
      expect(result.messages[0].topicId).toBe('topic-1');
    });
  });

  describe('queryWithSuccess with agentId', () => {
    it('should query messages by agentId (new data)', async () => {
      const messageService = new MessageService(serverDB, userId);

      await serverDB.insert(agents).values({ id: 'agent-1', userId });
      await serverDB.insert(sessions).values({ id: 'session-1', userId });
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: 'agent-1', sessionId: 'session-1', userId });

      // Create messages with agentId directly (new data pattern)
      await serverDB.insert(messages).values([
        { id: 'msg-1', userId, agentId: 'agent-1', role: 'user', content: 'message 1' },
        { id: 'msg-2', userId, agentId: 'agent-1', role: 'assistant', content: 'message 2' },
      ]);

      // Use removeMessage to trigger queryWithSuccess
      const result = await messageService.removeMessage('msg-1', { agentId: 'agent-1' });

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0].id).toBe('msg-2');
    });

    it('should query messages by agentId (legacy sessionId data)', async () => {
      const messageService = new MessageService(serverDB, userId);

      await serverDB.insert(agents).values({ id: 'agent-1', userId });
      await serverDB.insert(sessions).values({ id: 'session-1', userId });
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: 'agent-1', sessionId: 'session-1', userId });

      // Create messages with sessionId only (legacy data pattern)
      await serverDB.insert(messages).values([
        { id: 'msg-1', userId, sessionId: 'session-1', role: 'user', content: 'legacy message 1' },
        {
          id: 'msg-2',
          userId,
          sessionId: 'session-1',
          role: 'assistant',
          content: 'legacy message 2',
        },
      ]);

      // Query using agentId should find legacy sessionId data via OR condition
      const result = await messageService.removeMessage('msg-1', { agentId: 'agent-1' });

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0].id).toBe('msg-2');
    });

    it('should query mixed data (both agentId and sessionId)', async () => {
      const messageService = new MessageService(serverDB, userId);

      await serverDB.insert(agents).values({ id: 'agent-1', userId });
      await serverDB.insert(sessions).values({ id: 'session-1', userId });
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: 'agent-1', sessionId: 'session-1', userId });

      // Create mixed messages
      await serverDB.insert(messages).values([
        // Legacy data (sessionId only)
        { id: 'msg-1', userId, sessionId: 'session-1', role: 'user', content: 'legacy message' },
        // New data (agentId only)
        { id: 'msg-2', userId, agentId: 'agent-1', role: 'assistant', content: 'new message' },
        // Both fields
        {
          id: 'msg-3',
          userId,
          agentId: 'agent-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'both fields',
        },
      ]);

      // Create a dummy message to delete
      await serverDB
        .insert(messages)
        .values({ id: 'msg-to-delete', userId, agentId: 'agent-1', role: 'user', content: 'temp' });

      const result = await messageService.removeMessage('msg-to-delete', { agentId: 'agent-1' });

      expect(result.success).toBe(true);
      // Should find all 3 messages via OR condition
      expect(result.messages).toHaveLength(3);
    });
  });

  describe('queryWithSuccess with sessionId (backward compatibility)', () => {
    it('should still work with sessionId for backward compatibility', async () => {
      const messageService = new MessageService(serverDB, userId);

      await serverDB.insert(sessions).values({ id: 'session-1', userId });

      await serverDB.insert(messages).values([
        { id: 'msg-1', userId, sessionId: 'session-1', role: 'user', content: 'message 1' },
        { id: 'msg-2', userId, sessionId: 'session-1', role: 'assistant', content: 'message 2' },
      ]);

      const result = await messageService.removeMessage('msg-1', { sessionId: 'session-1' });

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0].id).toBe('msg-2');
    });
  });

  describe('removeMessages', () => {
    it('should delete multiple messages and return remaining', async () => {
      const messageService = new MessageService(serverDB, userId);

      await serverDB.insert(agents).values({ id: 'agent-1', userId });
      await serverDB.insert(sessions).values({ id: 'session-1', userId });
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: 'agent-1', sessionId: 'session-1', userId });

      await serverDB.insert(messages).values([
        { id: 'msg-1', userId, agentId: 'agent-1', role: 'user', content: 'message 1' },
        { id: 'msg-2', userId, agentId: 'agent-1', role: 'assistant', content: 'message 2' },
        { id: 'msg-3', userId, agentId: 'agent-1', role: 'user', content: 'message 3' },
      ]);

      const result = await messageService.removeMessages(['msg-1', 'msg-2'], {
        agentId: 'agent-1',
      });

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0].id).toBe('msg-3');
    });
  });

  describe('updateMessage', () => {
    it('should update message and return message list with agentId', async () => {
      const messageService = new MessageService(serverDB, userId);

      await serverDB.insert(agents).values({ id: 'agent-1', userId });
      await serverDB.insert(sessions).values({ id: 'session-1', userId });
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: 'agent-1', sessionId: 'session-1', userId });

      await serverDB
        .insert(messages)
        .values([
          { id: 'msg-1', userId, agentId: 'agent-1', role: 'user', content: 'original content' },
        ]);

      const result = await messageService.updateMessage(
        'msg-1',
        { content: 'updated content' },
        { agentId: 'agent-1' },
      );

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0].content).toBe('updated content');
    });

    it('should persist normalized message errors and return them in queried messages', async () => {
      const messageService = new MessageService(serverDB, userId);

      await serverDB.insert(agents).values({ id: 'agent-1', userId });
      await serverDB.insert(sessions).values({ id: 'session-1', userId });
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: 'agent-1', sessionId: 'session-1', userId });
      await serverDB.insert(topics).values({ id: 'topic-1', userId, sessionId: 'session-1' });

      await serverDB.insert(messages).values({
        id: 'msg-err-1',
        userId,
        agentId: 'agent-1',
        topicId: 'topic-1',
        role: 'assistant',
        content: '',
      });

      const messageError = {
        body: {
          agentType: 'claude-code',
          code: HeterogeneousAgentSessionErrorCode.AuthRequired,
          message: 'Failed to authenticate. API Error: 401',
        },
        message: 'Failed to authenticate. API Error: 401',
        type: AgentRuntimeErrorType.AgentRuntimeError,
      };

      const result = await messageService.updateMessage(
        'msg-err-1',
        { error: messageError },
        { agentId: 'agent-1', topicId: 'topic-1' },
      );

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      const expectedError = {
        ...messageError,
        attribution: 'user',
        body: {
          ...messageError.body,
          details: { kind: 'auth_required' },
        },
        category: 'auth',
        countAsFailure: false,
        errorRef: 'H1001',
        httpStatus: 470,
        isFallback: false,
        numericId: 1001,
        retryable: false,
        severity: 'warning',
      };

      expect(result.messages![0].error).toEqual(expectedError);

      const [persistedMessage] = await serverDB
        .select({ error: messages.error })
        .from(messages)
        .where(eq(messages.id, 'msg-err-1'));

      expect(persistedMessage.error).toEqual(expectedError);
    });
  });

  describe('updateMetadata', () => {
    it('should update metadata and return message list with agentId', async () => {
      const messageService = new MessageService(serverDB, userId);

      await serverDB.insert(agents).values({ id: 'agent-1', userId });
      await serverDB.insert(sessions).values({ id: 'session-1', userId });
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: 'agent-1', sessionId: 'session-1', userId });

      await serverDB
        .insert(messages)
        .values([{ id: 'msg-1', userId, agentId: 'agent-1', role: 'assistant', content: 'test' }]);

      const result = await messageService.updateMetadata(
        'msg-1',
        { duration: 1000 },
        { agentId: 'agent-1' },
      );

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
    });
  });

  describe('user isolation', () => {
    it('should not return messages from other users', async () => {
      const messageService = new MessageService(serverDB, userId);

      await serverDB.insert(agents).values([
        { id: 'agent-1', userId },
        { id: 'agent-2', userId: otherUserId },
      ]);
      await serverDB.insert(sessions).values([
        { id: 'session-1', userId },
        { id: 'session-2', userId: otherUserId },
      ]);
      await serverDB.insert(agentsToSessions).values([
        { agentId: 'agent-1', sessionId: 'session-1', userId },
        { agentId: 'agent-2', sessionId: 'session-2', userId: otherUserId },
      ]);

      await serverDB.insert(messages).values([
        { id: 'msg-1', userId, agentId: 'agent-1', role: 'user', content: 'my message' },
        {
          id: 'msg-2',
          userId: otherUserId,
          agentId: 'agent-2',
          role: 'user',
          content: 'other user message',
        },
      ]);

      // Create a dummy message to trigger query
      await serverDB
        .insert(messages)
        .values({ id: 'msg-to-delete', userId, agentId: 'agent-1', role: 'user', content: 'temp' });

      const result = await messageService.removeMessage('msg-to-delete', { agentId: 'agent-1' });

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages![0].id).toBe('msg-1');
      // Should not include other user's messages
      expect(result.messages!.every((m) => m.id !== 'msg-2')).toBe(true);
    });
  });

  describe('finalizeCompression', () => {
    it('should create assistant message with correct parentId (last compressed message ID, not messageGroupId)', async () => {
      const messageService = new MessageService(serverDB, userId);

      // Setup: agent, session, topic
      await serverDB.insert(agents).values({ id: 'agent-1', userId });
      await serverDB.insert(sessions).values({ id: 'session-1', userId });
      await serverDB
        .insert(agentsToSessions)
        .values({ agentId: 'agent-1', sessionId: 'session-1', userId });
      await serverDB.insert(topics).values({ id: 'topic-1', userId, sessionId: 'session-1' });

      // Create messages to be compressed
      await serverDB.insert(messages).values([
        {
          id: 'msg-1',
          userId,
          agentId: 'agent-1',
          topicId: 'topic-1',
          role: 'user',
          content: 'message 1',
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'msg-2',
          userId,
          agentId: 'agent-1',
          topicId: 'topic-1',
          role: 'assistant',
          content: 'message 2',
          createdAt: new Date('2024-01-01T10:01:00Z'),
        },
        {
          id: 'msg-3',
          userId,
          agentId: 'agent-1',
          topicId: 'topic-1',
          role: 'user',
          content: 'message 3 - this is the last compressed message',
          createdAt: new Date('2024-01-01T10:02:00Z'),
        },
      ]);

      // Create compression group
      await serverDB.insert(messageGroups).values({
        id: 'comp-group-1',
        userId,
        topicId: 'topic-1',
        content: '...',
        type: MessageGroupType.Compression,
        createdAt: new Date('2024-01-01T10:02:30Z'),
      });

      // Mark messages as compressed
      await serverDB
        .update(messages)
        .set({ messageGroupId: 'comp-group-1' })
        .where(eq(messages.topicId, 'topic-1'));

      // Call finalizeCompression
      const result = await messageService.finalizeCompression('comp-group-1', 'Summary content', {
        agentId: 'agent-1',
        topicId: 'topic-1',
      });

      expect(result.success).toBe(true);
      expect(result.messages).toBeDefined();

      // Verify compression content was updated
      const updatedGroup = await serverDB
        .select()
        .from(messageGroups)
        .where(eq(messageGroups.id, 'comp-group-1'));

      expect(updatedGroup).toHaveLength(1);
      expect(updatedGroup[0].content).toBe('Summary content');
    });
  });

  // A protocol 2 step diffs `prepareUiMessages` over its raw topic read, and the
  // client reads the same topic through `queryMessages`. If the two resolved
  // attachments differently, a patch would rewrite them on every step.
  describe('prepareUiMessages over a raw read', () => {
    it('matches the signed read for every attachment kind', async () => {
      const messageService = new MessageService(serverDB, userId);
      await serverDB.insert(agents).values({ id: 'agent-1', userId });
      await serverDB.insert(topics).values({ id: 'topic-1', userId });
      await serverDB.insert(files).values([
        { fileType: 'video/mp4', id: 'f-video', name: 'v', size: 1, url: 'video', userId },
        { fileType: 'audio/mpeg', id: 'f-audio', name: 'a', size: 1, url: 'audio', userId },
        { fileType: 'application/pdf', id: 'f-doc', name: 'd', size: 1, url: 'doc', userId },
        // Another user's file: the viewer gets a tombstone, not its path.
        {
          fileType: 'image/png',
          id: 'f-private',
          name: 'p',
          size: 1,
          url: 'private',
          userId: otherUserId,
        },
      ]);
      await serverDB.insert(messageGroups).values({
        content: 'summary',
        createdAt: new Date('2024-01-01T10:00:30Z'),
        id: 'group-1',
        topicId: 'topic-1',
        type: MessageGroupType.Compression,
        userId,
      });
      const message = { agentId: 'agent-1', role: 'user' as const, topicId: 'topic-1', userId };
      await serverDB.insert(messages).values([
        {
          ...message,
          content: 'compressed',
          createdAt: new Date('2024-01-01T10:00:00Z'),
          id: 'msg-compressed',
          messageGroupId: 'group-1',
        },
        {
          ...message,
          content: 'latest',
          createdAt: new Date('2024-01-01T10:01:00Z'),
          id: 'msg-latest',
        },
      ]);
      await serverDB.insert(messagesFiles).values(
        [
          ['msg-compressed', 'f1'],
          ['msg-latest', 'f1'],
          ['msg-latest', 'f-video'],
          ['msg-latest', 'f-audio'],
          ['msg-latest', 'f-doc'],
          ['msg-latest', 'f-private'],
        ].map(([messageId, fileId]) => ({ fileId, messageId, userId })),
      );

      const params = { agentId: 'agent-1', skipWorks: true, topicId: 'topic-1' };
      const raw = await (messageService as any).messageModel.query(params, {
        allowShareVisitor: true,
      });
      const signed = await messageService.queryMessages(params, { allowShareVisitor: true });

      // Guards the fixture: every attachment kind, the tombstone and the
      // compressed member are really in the read.
      const serialized = JSON.stringify(signed);
      for (const url of ['f-video?path=video', 'f-audio?path=audio', 'f-doc?path=doc'])
        expect(serialized).toContain(`/proxy/${url}`);
      // Once on the latest message, once on the compressed member.
      expect(serialized.split('/proxy/f1?path=abc')).toHaveLength(3);
      expect(serialized).toContain('"inaccessible":true');
      expect(serialized).not.toContain('path=private');

      expect(await messageService.prepareUiMessages(raw)).toEqual(signed);
    });
  });
});
