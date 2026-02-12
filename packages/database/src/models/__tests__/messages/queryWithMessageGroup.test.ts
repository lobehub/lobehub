// @vitest-environment node
import { MessageGroupType } from '@lobechat/types';
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messageGroups, messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const userId = 'message-query-test-user';
const topicId = 'test-topic-1';

let messageModel: MessageModel;
let serverDB: LobeChatDatabase;

beforeEach(async () => {
  serverDB = await getTestDB();

  // Clean up
  await serverDB.delete(messageGroups);
  await serverDB.delete(messages);
  await serverDB.delete(topics);
  await serverDB.delete(users);

  // Create test user
  await serverDB.insert(users).values({ id: userId });

  // Create test topic
  await serverDB.insert(topics).values({ id: topicId, userId });

  // Initialize model
  messageModel = new MessageModel(serverDB, userId);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('MessageModel.query with MessageGroup aggregation', () => {
  /**
   * Test Scenario 1: Basic query without compression groups
   * Expected: All messages should be returned normally
   */
  describe('query without compression groups', () => {
    it('should return all messages when no compression groups exist', async () => {
      // Create test messages
      await serverDB.insert(messages).values([
        { id: 'msg-1', content: 'Hello', role: 'user', topicId, userId },
        { id: 'msg-2', content: 'Hi there!', role: 'assistant', topicId, userId },
        { id: 'msg-3', content: 'How are you?', role: 'user', topicId, userId },
      ]);

      const result = await messageModel.query({ topicId });

      expect(result).toHaveLength(3);
      expect(result.map((m) => m.id)).toEqual(['msg-1', 'msg-2', 'msg-3']);
    });
  });

  /**
   * Test Scenario 2: Query with compression groups
   * Expected:
   * - Compressed messages (messageGroupId IS NOT NULL) should be excluded from normal trajectory
   * - Only uncompressed messages should appear
   * - Compression group should appear as a special node (role: 'compressedGroup')
   */
  describe('query with compression groups - compressed messages filtering', () => {
    it('should exclude compressed messages from query results', async () => {
      // Create messages - some will be compressed
      await serverDB.insert(messages).values([
        {
          id: 'msg-comp-1',
          content: 'Early message 1',
          role: 'user',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'msg-comp-2',
          content: 'Early message 2',
          role: 'assistant',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:01:00Z'),
        },
        {
          id: 'msg-comp-3',
          content: 'Early message 3',
          role: 'user',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:02:00Z'),
        },
        {
          id: 'msg-normal-1',
          content: 'Recent message 1',
          role: 'assistant',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:03:00Z'),
        },
        {
          id: 'msg-normal-2',
          content: 'Recent message 2',
          role: 'user',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:04:00Z'),
        },
      ]);

      // Create a compression group
      await serverDB.insert(messageGroups).values({
        id: 'comp-group-1',
        content: 'Summary of early conversation',
        type: MessageGroupType.Compression,
        topicId,
        userId,
        createdAt: new Date('2024-01-01T10:02:30Z'),
      });

      // Mark early messages as compressed
      await serverDB
        .update(messages)
        .set({ messageGroupId: 'comp-group-1' })
        .where(inArray(messages.id, ['msg-comp-1', 'msg-comp-2', 'msg-comp-3']));

      // Query messages
      const result = await messageModel.query({ topicId });

      // Expected behavior:
      // - Compressed messages (msg-comp-1, msg-comp-2, msg-comp-3) should NOT appear
      // - Only uncompressed messages (msg-normal-1, msg-normal-2) should appear
      // - Compression group should appear as a special node (role: 'compressedGroup')
      // Total: 1 compressedGroup node + 2 normal messages = 3 items
      expect(result).toHaveLength(3);

      // Verify the compressedGroup node
      const compressedGroupNode = result.find((m) => m.role === 'compressedGroup');
      expect(compressedGroupNode).toBeDefined();
      expect(compressedGroupNode!.id).toBe('comp-group-1');
      expect(compressedGroupNode!.content).toBe('Summary of early conversation');

      // Verify uncompressed messages
      const normalMessages = result.filter((m) => m.role !== 'compressedGroup');
      expect(normalMessages).toHaveLength(2);
      expect(normalMessages.map((m) => m.id)).toEqual(['msg-normal-1', 'msg-normal-2']);
    });

    it('should handle multiple compression groups correctly', async () => {
      // Create messages for multiple compression scenarios
      await serverDB.insert(messages).values([
        // First batch to compress
        {
          id: 'batch1-1',
          content: 'Batch 1 msg 1',
          role: 'user',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'batch1-2',
          content: 'Batch 1 msg 2',
          role: 'assistant',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:01:00Z'),
        },
        // Second batch to compress
        {
          id: 'batch2-1',
          content: 'Batch 2 msg 1',
          role: 'user',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:02:00Z'),
        },
        {
          id: 'batch2-2',
          content: 'Batch 2 msg 2',
          role: 'assistant',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:03:00Z'),
        },
        // Uncompressed messages
        {
          id: 'recent-1',
          content: 'Recent msg',
          role: 'user',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:04:00Z'),
        },
      ]);

      // Create first compression group
      await serverDB.insert(messageGroups).values({
        id: 'comp-group-batch1',
        content: 'Summary of batch 1',
        type: MessageGroupType.Compression,
        topicId,
        userId,
        createdAt: new Date('2024-01-01T10:01:30Z'),
      });

      // Create second compression group
      await serverDB.insert(messageGroups).values({
        id: 'comp-group-batch2',
        content: 'Summary of batch 2',
        type: MessageGroupType.Compression,
        topicId,
        userId,
        createdAt: new Date('2024-01-01T10:03:30Z'),
      });

      // Mark messages as compressed
      await serverDB
        .update(messages)
        .set({ messageGroupId: 'comp-group-batch1' })
        .where(inArray(messages.id, ['batch1-1', 'batch1-2']));
      await serverDB
        .update(messages)
        .set({ messageGroupId: 'comp-group-batch2' })
        .where(inArray(messages.id, ['batch2-1', 'batch2-2']));

      const result = await messageModel.query({ topicId });

      // Expected:
      // - 4 compressed messages excluded
      // - 1 uncompressed message included
      // - 2 compression groups as special nodes
      // Total: 2 compressedGroup nodes + 1 message = 3 items
      expect(result).toHaveLength(3);

      // Verify compression group nodes
      const compressedGroups = result.filter((m) => m.role === 'compressedGroup');
      expect(compressedGroups).toHaveLength(2);
      expect(compressedGroups.map((g) => g.id)).toEqual(
        expect.arrayContaining(['comp-group-batch1', 'comp-group-batch2']),
      );

      // Verify uncompressed message
      const normalMessages = result.filter((m) => m.role !== 'compressedGroup');
      expect(normalMessages).toHaveLength(1);
      expect(normalMessages[0].id).toBe('recent-1');
    });
  });

  /**
   * Test Scenario 3: Pinned messages in compression groups
   * Expected:
   * - Compression group node should have a `pinnedMessages` array field
   * - This array should contain messages with `favorite=true` from that group
   */
  describe('pinned messages in compression groups', () => {
    it('should extract pinned messages from compression group', async () => {
      // Create messages with some marked as favorite
      await serverDB.insert(messages).values([
        {
          id: 'pinned-1',
          content: 'Important message',
          role: 'assistant',
          topicId,
          userId,
          favorite: true,
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'normal-1',
          content: 'Normal message',
          role: 'user',
          topicId,
          userId,
          favorite: false,
          createdAt: new Date('2024-01-01T10:01:00Z'),
        },
        {
          id: 'pinned-2',
          content: 'Another important message',
          role: 'user',
          topicId,
          userId,
          favorite: true,
          createdAt: new Date('2024-01-01T10:02:00Z'),
        },
        {
          id: 'uncompressed-1',
          content: 'Latest message',
          role: 'assistant',
          topicId,
          userId,
          favorite: false,
          createdAt: new Date('2024-01-01T10:03:00Z'),
        },
      ]);

      // Create compression group for first 3 messages
      await serverDB.insert(messageGroups).values({
        id: 'comp-with-pinned',
        content: 'Summary with pinned messages',
        type: MessageGroupType.Compression,
        topicId,
        userId,
        createdAt: new Date('2024-01-01T10:02:30Z'),
      });

      // Mark first 3 messages as compressed
      await serverDB
        .update(messages)
        .set({ messageGroupId: 'comp-with-pinned' })
        .where(inArray(messages.id, ['pinned-1', 'normal-1', 'pinned-2']));

      const result = await messageModel.query({ topicId });

      // Expected structure:
      // [
      //   {
      //     role: 'compressedGroup',
      //     id: 'comp-with-pinned',
      //     content: 'Summary with pinned messages',
      //     pinnedMessages: [
      //       { id: 'pinned-1', content: 'Important message', favorite: true },
      //       { id: 'pinned-2', content: 'Another important message', favorite: true },
      //     ],
      //   },
      //   { role: 'assistant', id: 'uncompressed-1', content: 'Latest message' },
      // ]
      expect(result).toHaveLength(2);

      // Verify compressedGroup node with pinnedMessages
      const compressedGroupNode = result.find((m) => m.role === 'compressedGroup') as any;
      expect(compressedGroupNode).toBeDefined();
      expect(compressedGroupNode.id).toBe('comp-with-pinned');
      expect(compressedGroupNode.pinnedMessages).toBeDefined();
      expect(compressedGroupNode.pinnedMessages).toHaveLength(2);
      expect(compressedGroupNode.pinnedMessages.map((m: any) => m.id)).toEqual(
        expect.arrayContaining(['pinned-1', 'pinned-2']),
      );

      // Verify uncompressed message
      const normalMessage = result.find((m) => m.role !== 'compressedGroup');
      expect(normalMessage).toBeDefined();
      expect(normalMessage!.id).toBe('uncompressed-1');
    });

    it('should handle compression group with no pinned messages', async () => {
      // Create messages with no favorites
      await serverDB.insert(messages).values([
        {
          id: 'no-fav-1',
          content: 'Message 1',
          role: 'user',
          topicId,
          userId,
          favorite: false,
        },
        {
          id: 'no-fav-2',
          content: 'Message 2',
          role: 'assistant',
          topicId,
          userId,
          favorite: false,
        },
        {
          id: 'uncompressed',
          content: 'Latest',
          role: 'user',
          topicId,
          userId,
          favorite: false,
        },
      ]);

      // Create compression group
      await serverDB.insert(messageGroups).values({
        id: 'comp-no-pinned',
        content: 'Summary without pinned',
        type: MessageGroupType.Compression,
        topicId,
        userId,
      });

      // Mark first 2 messages as compressed
      await serverDB
        .update(messages)
        .set({ messageGroupId: 'comp-no-pinned' })
        .where(inArray(messages.id, ['no-fav-1', 'no-fav-2']));

      const result = await messageModel.query({ topicId });

      // Expected: 1 compressedGroup + 1 uncompressed message = 2 items
      expect(result).toHaveLength(2);

      // Verify compressedGroup node has empty pinnedMessages
      const compressedGroupNode = result.find((m) => m.role === 'compressedGroup') as any;
      expect(compressedGroupNode).toBeDefined();
      expect(compressedGroupNode.pinnedMessages).toBeDefined();
      expect(compressedGroupNode.pinnedMessages).toHaveLength(0);
    });
  });

  /**
   * Test Scenario 4: Parallel (Compare) Groups
   * Expected:
   * - Parallel group messages should be aggregated under a 'compareGroup' node
   * - The node should have children containing all parallel messages
   */
  describe('parallel (compare) groups', () => {
    it('should aggregate parallel messages under compareGroup node', async () => {
      // Create user message and parallel assistant responses
      await serverDB.insert(messages).values([
        {
          id: 'user-msg',
          content: 'Compare GPT-4 and Claude',
          role: 'user',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
        // Parallel responses - will be in a compare group
        {
          id: 'gpt4-response',
          content: 'GPT-4 response',
          role: 'assistant',
          model: 'gpt-4',
          provider: 'openai',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:01:00Z'),
        },
        {
          id: 'claude-response',
          content: 'Claude response',
          role: 'assistant',
          model: 'claude-3',
          provider: 'anthropic',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:01:01Z'),
        },
        {
          id: 'follow-up',
          content: 'Thanks!',
          role: 'user',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:02:00Z'),
        },
      ]);

      // Create parallel (compare) group
      await serverDB.insert(messageGroups).values({
        id: 'parallel-group-1',
        type: 'parallel', // MessageGroupType.Parallel
        parentMessageId: 'user-msg',
        topicId,
        userId,
        createdAt: new Date('2024-01-01T10:01:00Z'),
      });

      // Mark parallel responses as part of the group
      await serverDB
        .update(messages)
        .set({ messageGroupId: 'parallel-group-1' })
        .where(inArray(messages.id, ['gpt4-response', 'claude-response']));

      const result = await messageModel.query({ topicId });

      // Expected structure:
      // [
      //   { role: 'user', id: 'user-msg', content: 'Compare GPT-4 and Claude' },
      //   {
      //     role: 'compareGroup',
      //     id: 'parallel-group-1',
      //     children: [
      //       { role: 'assistant', id: 'gpt4-response', model: 'gpt-4' },
      //       { role: 'assistant', id: 'claude-response', model: 'claude-3' },
      //     ],
      //   },
      //   { role: 'user', id: 'follow-up', content: 'Thanks!' },
      // ]
      expect(result).toHaveLength(3);

      // Verify user message
      expect(result[0].id).toBe('user-msg');
      expect(result[0].role).toBe('user');

      // Verify compareGroup node
      const compareGroupNode = result.find((m) => m.role === 'compareGroup') as any;
      expect(compareGroupNode).toBeDefined();
      expect(compareGroupNode.id).toBe('parallel-group-1');
      expect(compareGroupNode.children).toBeDefined();
      expect(compareGroupNode.children).toHaveLength(2);
      expect(compareGroupNode.children.map((c: any) => c.id)).toEqual(
        expect.arrayContaining(['gpt4-response', 'claude-response']),
      );

      // Verify follow-up message
      expect(result[2].id).toBe('follow-up');
      expect(result[2].role).toBe('user');
    });
  });

  /**
   * Test Scenario 5: Mixed compression and parallel groups
   * Expected: Proper ordering and aggregation of both group types
   */
  describe('mixed compression and parallel groups', () => {
    it('should handle both compression and parallel groups in same topic', async () => {
      // Create a complex conversation scenario
      await serverDB.insert(messages).values([
        // Early messages to be compressed
        {
          id: 'early-1',
          content: 'Early msg 1',
          role: 'user',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'early-2',
          content: 'Early msg 2',
          role: 'assistant',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:01:00Z'),
        },
        // User asks for comparison
        {
          id: 'compare-ask',
          content: 'Compare models',
          role: 'user',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:02:00Z'),
        },
        // Parallel responses
        {
          id: 'model-a',
          content: 'Model A response',
          role: 'assistant',
          model: 'model-a',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:03:00Z'),
        },
        {
          id: 'model-b',
          content: 'Model B response',
          role: 'assistant',
          model: 'model-b',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:03:01Z'),
        },
        // Final message
        {
          id: 'final',
          content: 'Thanks for comparison',
          role: 'user',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:04:00Z'),
        },
      ]);

      // Create compression group for early messages
      await serverDB.insert(messageGroups).values({
        id: 'comp-group',
        content: 'Summary of early conversation',
        type: MessageGroupType.Compression,
        topicId,
        userId,
        createdAt: new Date('2024-01-01T10:01:30Z'),
      });

      // Create parallel group for model comparisons
      await serverDB.insert(messageGroups).values({
        id: 'parallel-group',
        type: 'parallel',
        parentMessageId: 'compare-ask',
        topicId,
        userId,
        createdAt: new Date('2024-01-01T10:03:00Z'),
      });

      // Mark messages
      await serverDB
        .update(messages)
        .set({ messageGroupId: 'comp-group' })
        .where(inArray(messages.id, ['early-1', 'early-2']));
      await serverDB
        .update(messages)
        .set({ messageGroupId: 'parallel-group' })
        .where(inArray(messages.id, ['model-a', 'model-b']));

      const result = await messageModel.query({ topicId });

      // Expected structure:
      // [
      //   { role: 'compressedGroup', id: 'comp-group', content: 'Summary...', pinnedMessages: [] },
      //   { role: 'user', id: 'compare-ask', content: 'Compare models' },
      //   { role: 'compareGroup', id: 'parallel-group', children: [model-a, model-b] },
      //   { role: 'user', id: 'final', content: 'Thanks for comparison' },
      // ]
      expect(result).toHaveLength(4);

      // Verify structure
      const compressedGroup = result.find((m) => m.role === 'compressedGroup');
      const compareGroup = result.find((m) => m.role === 'compareGroup');
      const normalMessages = result.filter(
        (m) => m.role !== 'compressedGroup' && m.role !== 'compareGroup',
      );

      expect(compressedGroup).toBeDefined();
      expect(compareGroup).toBeDefined();
      expect(normalMessages).toHaveLength(2);
      expect(normalMessages.map((m) => m.id)).toEqual(
        expect.arrayContaining(['compare-ask', 'final']),
      );
    });
  });

  /**
   * Test Scenario 6: compressedMessages field
   * Expected:
   * - Compression group node should have a `compressedMessages` array field
   * - This array should contain all messages from that group with full data
   */
  describe('compressedMessages in compression groups', () => {
    it('should include all messages in compressedMessages array', async () => {
      // Create messages to be compressed
      await serverDB.insert(messages).values([
        {
          id: 'comp-msg-1',
          content: 'User message 1',
          role: 'user',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'comp-msg-2',
          content: 'Assistant response',
          role: 'assistant',
          model: 'gpt-4',
          provider: 'openai',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:01:00Z'),
        },
        {
          id: 'comp-msg-3',
          content: 'User follow-up',
          role: 'user',
          topicId,
          userId,
          parentId: 'comp-msg-2',
          createdAt: new Date('2024-01-01T10:02:00Z'),
        },
        {
          id: 'uncompressed-msg',
          content: 'Latest message',
          role: 'assistant',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:03:00Z'),
        },
      ]);

      // Create compression group
      await serverDB.insert(messageGroups).values({
        id: 'comp-group-with-msgs',
        content: 'Summary of conversation',
        type: MessageGroupType.Compression,
        topicId,
        userId,
        createdAt: new Date('2024-01-01T10:02:30Z'),
      });

      // Mark messages as compressed
      await serverDB
        .update(messages)
        .set({ messageGroupId: 'comp-group-with-msgs' })
        .where(inArray(messages.id, ['comp-msg-1', 'comp-msg-2', 'comp-msg-3']));

      const result = await messageModel.query({ topicId });

      // Expected: 1 compressedGroup + 1 uncompressed message = 2 items
      expect(result).toHaveLength(2);

      // Verify compressedGroup node has compressedMessages
      const compressedGroupNode = result.find((m) => m.role === 'compressedGroup') as any;
      expect(compressedGroupNode).toBeDefined();
      expect(compressedGroupNode.compressedMessages).toBeDefined();
      expect(compressedGroupNode.compressedMessages).toHaveLength(3);

      // Verify compressedMessages contain full message data
      const compressedMsgs = compressedGroupNode.compressedMessages;
      expect(compressedMsgs.map((m: any) => m.id)).toEqual([
        'comp-msg-1',
        'comp-msg-2',
        'comp-msg-3',
      ]);

      // Verify message fields are preserved
      const assistantMsg = compressedMsgs.find((m: any) => m.id === 'comp-msg-2');
      expect(assistantMsg.model).toBe('gpt-4');
      expect(assistantMsg.provider).toBe('openai');
      expect(assistantMsg.content).toBe('Assistant response');

      // Verify parentId is preserved for conversation-flow parsing
      const followUpMsg = compressedMsgs.find((m: any) => m.id === 'comp-msg-3');
      expect(followUpMsg.parentId).toBe('comp-msg-2');
    });

    it('should include compressedMessages with empty pinnedMessages when no favorites', async () => {
      await serverDB.insert(messages).values([
        {
          id: 'msg-no-fav-1',
          content: 'Message 1',
          role: 'user',
          topicId,
          userId,
          favorite: false,
        },
        {
          id: 'msg-no-fav-2',
          content: 'Message 2',
          role: 'assistant',
          topicId,
          userId,
          favorite: false,
        },
      ]);

      await serverDB.insert(messageGroups).values({
        id: 'comp-no-fav',
        content: 'Summary',
        type: MessageGroupType.Compression,
        topicId,
        userId,
      });

      await serverDB
        .update(messages)
        .set({ messageGroupId: 'comp-no-fav' })
        .where(inArray(messages.id, ['msg-no-fav-1', 'msg-no-fav-2']));

      const result = await messageModel.query({ topicId });

      const compressedGroupNode = result.find((m) => m.role === 'compressedGroup') as any;
      expect(compressedGroupNode).toBeDefined();

      // compressedMessages should contain all messages
      expect(compressedGroupNode.compressedMessages).toHaveLength(2);

      // pinnedMessages should be empty
      expect(compressedGroupNode.pinnedMessages).toHaveLength(0);
    });

    it('should have both pinnedMessages and compressedMessages correctly populated', async () => {
      await serverDB.insert(messages).values([
        {
          id: 'fav-msg',
          content: 'Important message',
          role: 'assistant',
          topicId,
          userId,
          favorite: true,
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'normal-msg',
          content: 'Normal message',
          role: 'user',
          topicId,
          userId,
          favorite: false,
          createdAt: new Date('2024-01-01T10:01:00Z'),
        },
      ]);

      await serverDB.insert(messageGroups).values({
        id: 'comp-mixed',
        content: 'Summary',
        type: MessageGroupType.Compression,
        topicId,
        userId,
      });

      await serverDB
        .update(messages)
        .set({ messageGroupId: 'comp-mixed' })
        .where(inArray(messages.id, ['fav-msg', 'normal-msg']));

      const result = await messageModel.query({ topicId });

      const compressedGroupNode = result.find((m) => m.role === 'compressedGroup') as any;

      // compressedMessages contains all messages
      expect(compressedGroupNode.compressedMessages).toHaveLength(2);

      // pinnedMessages only contains favorite messages
      expect(compressedGroupNode.pinnedMessages).toHaveLength(1);
      expect(compressedGroupNode.pinnedMessages[0].id).toBe('fav-msg');
    });
  });

  /**
   * Test Scenario 7: Trajectory ordering
   * Expected: Items should be ordered by createdAt correctly,
   * including MessageGroup nodes at their proper positions
   */
  describe('trajectory ordering', () => {
    it('should order compression groups at correct position in trajectory', async () => {
      // Create messages with specific timestamps
      await serverDB.insert(messages).values([
        {
          id: 'msg-1',
          content: 'First',
          role: 'user',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'msg-2',
          content: 'Second',
          role: 'assistant',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:01:00Z'),
        },
        {
          id: 'msg-3',
          content: 'Third',
          role: 'user',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:02:00Z'),
        },
        {
          id: 'msg-4',
          content: 'Fourth (after compression)',
          role: 'assistant',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:04:00Z'),
        },
      ]);

      // Create compression group with timestamp between msg-3 and msg-4
      await serverDB.insert(messageGroups).values({
        id: 'ordered-comp',
        content: 'Compressed summary',
        type: MessageGroupType.Compression,
        topicId,
        userId,
        createdAt: new Date('2024-01-01T10:03:00Z'), // Between msg-3 and msg-4
      });

      // Compress first 3 messages
      await serverDB
        .update(messages)
        .set({ messageGroupId: 'ordered-comp' })
        .where(inArray(messages.id, ['msg-1', 'msg-2', 'msg-3']));

      const result = await messageModel.query({ topicId });

      // Expected order:
      // 1. compressedGroup (createdAt: 10:03:00) - represents msgs 1-3
      // 2. msg-4 (createdAt: 10:04:00)
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('compressedGroup');
      expect(result[0].id).toBe('ordered-comp');
      expect(result[1].role).toBe('assistant');
      expect(result[1].id).toBe('msg-4');
    });
  });

  /**
   * Test Scenario 8: Branch scenario - compression with message branching
   * Expected:
   * - Compression should correctly capture messages by their IDs
   * - Branch messages (same parentId) should be handled correctly
   * - Only explicitly marked messages should be in compressedMessages
   */
  describe('compression with message branches', () => {
    it('should only include explicitly marked messages in compression, not branch siblings', async () => {
      // Create a conversation with branches:
      // User A -> Assistant B1 (branch 1)
      //        -> Assistant B2 (branch 2)
      // User continues on B1 -> C
      await serverDB.insert(messages).values([
        {
          id: 'branch-user-a',
          content: 'User question',
          role: 'user',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'branch-assistant-b1',
          content: 'Assistant response B1',
          role: 'assistant',
          parentId: 'branch-user-a',
          model: 'gpt-4',
          provider: 'openai',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:01:00Z'),
        },
        {
          id: 'branch-assistant-b2',
          content: 'Assistant response B2 (branch)',
          role: 'assistant',
          parentId: 'branch-user-a', // Same parent - this is a branch
          model: 'claude-3',
          provider: 'anthropic',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:01:30Z'),
        },
        {
          id: 'branch-user-c',
          content: 'Follow up on B1',
          role: 'user',
          parentId: 'branch-assistant-b1', // Continue on B1
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:02:00Z'),
        },
        {
          id: 'branch-latest',
          content: 'Latest message',
          role: 'assistant',
          parentId: 'branch-user-c',
          topicId,
          userId,
          createdAt: new Date('2024-01-01T10:03:00Z'),
        },
      ]);

      // Create compression group for the main thread (A -> B1 -> C), NOT including B2
      await serverDB.insert(messageGroups).values({
        id: 'branch-comp',
        content: 'Compressed main thread',
        type: MessageGroupType.Compression,
        topicId,
        userId,
        createdAt: new Date('2024-01-01T10:02:30Z'),
      });

      // Only mark main thread messages as compressed (A, B1, C)
      // B2 is NOT included in compression
      await serverDB
        .update(messages)
        .set({ messageGroupId: 'branch-comp' })
        .where(inArray(messages.id, ['branch-user-a', 'branch-assistant-b1', 'branch-user-c']));

      const result = await messageModel.query({ topicId });

      // Expected: compressedGroup + B2 (uncompressed branch) + latest
      expect(result).toHaveLength(3);

      const compressedGroup = result.find((m) => m.role === 'compressedGroup') as any;
      expect(compressedGroup).toBeDefined();
      expect(compressedGroup.id).toBe('branch-comp');

      // compressedMessages should only contain the main thread (A, B1, C)
      expect(compressedGroup.compressedMessages).toHaveLength(3);
      const compressedIds = compressedGroup.compressedMessages.map((m: any) => m.id);
      expect(compressedIds).toContain('branch-user-a');
      expect(compressedIds).toContain('branch-assistant-b1');
      expect(compressedIds).toContain('branch-user-c');
      // B2 should NOT be in compressedMessages
      expect(compressedIds).not.toContain('branch-assistant-b2');

      // Verify parentId is preserved for conversation-flow parsing
      const b1InCompressed = compressedGroup.compressedMessages.find(
        (m: any) => m.id === 'branch-assistant-b1',
      );
      expect(b1InCompressed.parentId).toBe('branch-user-a');

      // B2 should still be visible as uncompressed message
      const b2 = result.find((m) => m.id === 'branch-assistant-b2');
      expect(b2).toBeDefined();
      expect(b2!.content).toBe('Assistant response B2 (branch)');
    });
  });
});
