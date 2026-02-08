// @vitest-environment node
import { MessageGroupType } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { messageGroups, messages } from '../../schemas/message';
import { topics } from '../../schemas/topic';
import { users } from '../../schemas/user';
import { LobeChatDatabase } from '../../type';
import { CompressionRepository } from './index';

const userId = 'compression-test-user';
const topicId = 'test-topic-1';

let compressionRepo: CompressionRepository;

const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  // Clean up
  await serverDB.delete(messageGroups);
  await serverDB.delete(messages);
  await serverDB.delete(topics);
  await serverDB.delete(users);

  // Create test user
  await serverDB.insert(users).values({ id: userId });

  // Create test topic
  await serverDB.insert(topics).values({ id: topicId, userId });

  // Initialize repo
  compressionRepo = new CompressionRepository(serverDB, userId);
});

describe('CompressionRepository', () => {
  describe('createCompressionGroup', () => {
    it('should create a compression group', async () => {
      const metadata = {
        compressedAt: new Date().toISOString(),
        compressionStrategy: 'summarize' as const,
        originalMessageCount: 10,
        originalTokenCount: 5000,
      };
      const groupId = await compressionRepo.createCompressionGroup({
        content: 'This is a summary of the conversation.',
        messageIds: [],
        metadata,
        topicId,
      });

      expect(groupId).toBeDefined();

      // Verify the group was created
      const groups = await compressionRepo.getCompressionGroups(topicId);
      expect(groups).toHaveLength(1);
      expect(groups[0].content).toBe('This is a summary of the conversation.');
      expect(groups[0].type).toBe(MessageGroupType.Compression);
      expect(groups[0].metadata).toEqual(metadata);
    });

    it('should create compression group and mark messages as compressed', async () => {
      // Create test messages
      await serverDB.insert(messages).values([
        { id: 'msg-1', content: 'Hello', role: 'user', topicId, userId },
        { id: 'msg-2', content: 'Hi there!', role: 'assistant', topicId, userId },
        { id: 'msg-3', content: 'How are you?', role: 'user', topicId, userId },
      ]);

      const groupId = await compressionRepo.createCompressionGroup({
        content: 'User greeted and asked how assistant is doing.',
        messageIds: ['msg-1', 'msg-2', 'msg-3'],
        metadata: {
          endMessageId: 'msg-3',
          originalMessageCount: 3,
          startMessageId: 'msg-1',
        },
        topicId,
      });

      // Verify messages are marked as compressed
      const compressedMessages = await compressionRepo.getCompressedMessages(groupId);
      expect(compressedMessages).toHaveLength(3);
    });
  });

  describe('getCompressionGroups', () => {
    it('should return all compression groups for a topic ordered by createdAt', async () => {
      // Create multiple compression groups
      await compressionRepo.createCompressionGroup({
        content: 'First summary',
        messageIds: [],
        metadata: { originalMessageCount: 5 },
        topicId,
      });

      await compressionRepo.createCompressionGroup({
        content: 'Second summary',
        messageIds: [],
        metadata: { originalMessageCount: 10 },
        topicId,
      });

      const groups = await compressionRepo.getCompressionGroups(topicId);
      expect(groups).toHaveLength(2);
      expect(groups[0].content).toBe('First summary');
      expect(groups[1].content).toBe('Second summary');
    });

    it('should not return groups from other topics', async () => {
      const otherTopicId = 'other-topic';
      await serverDB.insert(topics).values({ id: otherTopicId, userId });

      await compressionRepo.createCompressionGroup({
        content: 'Summary for topic 1',
        messageIds: [],
        metadata: {},
        topicId,
      });

      await compressionRepo.createCompressionGroup({
        content: 'Summary for other topic',
        messageIds: [],
        metadata: {},
        topicId: otherTopicId,
      });

      const groups = await compressionRepo.getCompressionGroups(topicId);
      expect(groups).toHaveLength(1);
      expect(groups[0].content).toBe('Summary for topic 1');
    });
  });

  describe('getLatestCompressionGroup', () => {
    it('should return the latest compression group', async () => {
      await compressionRepo.createCompressionGroup({
        content: 'Old summary',
        messageIds: [],
        metadata: {},
        topicId,
      });

      await compressionRepo.createCompressionGroup({
        content: 'Latest summary',
        messageIds: [],
        metadata: {},
        topicId,
      });

      const latest = await compressionRepo.getLatestCompressionGroup(topicId);
      expect(latest).not.toBeNull();
      expect(latest!.content).toBe('Latest summary');
    });

    it('should return null if no compression groups exist', async () => {
      const latest = await compressionRepo.getLatestCompressionGroup(topicId);
      expect(latest).toBeNull();
    });
  });

  describe('updateCompressionContent', () => {
    it('should update compression group content', async () => {
      const groupId = await compressionRepo.createCompressionGroup({
        content: 'Original summary',
        messageIds: [],
        metadata: { originalTokenCount: 1000 },
        topicId,
      });

      await compressionRepo.updateCompressionContent(groupId, 'Updated summary', {
        compressedTokenCount: 100,
      });

      const groups = await compressionRepo.getCompressionGroups(topicId);
      expect(groups[0].content).toBe('Updated summary');
    });
  });

  describe('toggleMessagePin', () => {
    it('should pin a message', async () => {
      await serverDB.insert(messages).values({
        content: 'Important message',
        id: 'msg-pin-test',
        role: 'user',
        topicId,
        userId,
      });

      await compressionRepo.toggleMessagePin('msg-pin-test', true);

      const [message] = await serverDB
        .select()
        .from(messages)
        .where(
          (() => {
            const { eq, and } = require('drizzle-orm');
            return and(eq(messages.id, 'msg-pin-test'), eq(messages.userId, userId));
          })(),
        );

      expect((message.metadata as any)?.pinned).toBe(true);
    });

    it('should unpin a message', async () => {
      await serverDB.insert(messages).values({
        content: 'Pinned message',
        id: 'msg-unpin-test',
        metadata: { pinned: true },
        role: 'user',
        topicId,
        userId,
      });

      await compressionRepo.toggleMessagePin('msg-unpin-test', false);

      const [message] = await serverDB
        .select()
        .from(messages)
        .where(
          (() => {
            const { eq, and } = require('drizzle-orm');
            return and(eq(messages.id, 'msg-unpin-test'), eq(messages.userId, userId));
          })(),
        );

      expect((message.metadata as any)?.pinned).toBe(false);
    });
  });

  describe('getUncompressedMessages', () => {
    it('should return only uncompressed messages', async () => {
      // Create messages
      await serverDB.insert(messages).values([
        { id: 'msg-uncomp-1', content: 'Uncompressed 1', role: 'user', topicId, userId },
        { id: 'msg-uncomp-2', content: 'Uncompressed 2', role: 'assistant', topicId, userId },
        { id: 'msg-comp-1', content: 'To be compressed', role: 'user', topicId, userId },
      ]);

      // Compress one message
      await compressionRepo.createCompressionGroup({
        content: 'Summary',
        messageIds: ['msg-comp-1'],
        metadata: {},
        topicId,
      });

      const uncompressed = await compressionRepo.getUncompressedMessages(topicId);
      expect(uncompressed).toHaveLength(2);
      expect(uncompressed.map((m) => m.id)).toEqual(
        expect.arrayContaining(['msg-uncomp-1', 'msg-uncomp-2']),
      );
    });
  });

  describe('deleteCompressionGroup', () => {
    it('should delete compression group and unmark messages', async () => {
      await serverDB.insert(messages).values([
        { id: 'msg-delete-1', content: 'Message 1', role: 'user', topicId, userId },
        { id: 'msg-delete-2', content: 'Message 2', role: 'assistant', topicId, userId },
      ]);

      const groupId = await compressionRepo.createCompressionGroup({
        content: 'To be deleted',
        messageIds: ['msg-delete-1', 'msg-delete-2'],
        metadata: {},
        topicId,
      });

      // Verify messages are compressed
      let compressedMessages = await compressionRepo.getCompressedMessages(groupId);
      expect(compressedMessages).toHaveLength(2);

      // Delete the group
      await compressionRepo.deleteCompressionGroup(groupId);

      // Verify group is deleted
      const groups = await compressionRepo.getCompressionGroups(topicId);
      expect(groups).toHaveLength(0);

      // Verify messages are uncompressed
      const uncompressed = await compressionRepo.getUncompressedMessages(topicId);
      expect(uncompressed).toHaveLength(2);
    });
  });

  describe('unmarkMessagesFromCompression', () => {
    it('should remove messages from compression group', async () => {
      await serverDB.insert(messages).values([
        { id: 'msg-unmark-1', content: 'Message 1', role: 'user', topicId, userId },
        { id: 'msg-unmark-2', content: 'Message 2', role: 'assistant', topicId, userId },
      ]);

      const groupId = await compressionRepo.createCompressionGroup({
        content: 'Summary',
        messageIds: ['msg-unmark-1', 'msg-unmark-2'],
        metadata: {},
        topicId,
      });

      // Unmark one message
      await compressionRepo.unmarkMessagesFromCompression(['msg-unmark-1']);

      const compressedMessages = await compressionRepo.getCompressedMessages(groupId);
      expect(compressedMessages).toHaveLength(1);
      expect(compressedMessages[0].id).toBe('msg-unmark-2');
    });
  });

  /**
   * Tests for LOBE-2066: MessageGroup aggregation in queryMessage
   *
   * These tests verify the expected behavior for querying messages with compression groups,
   * specifically focusing on:
   * 1. Compressed messages should NOT appear in normal trajectory
   * 2. Compression groups should appear as aggregated nodes
   * 3. Pinned (favorite) messages within compression groups should be extracted
   */
  describe('MessageGroup aggregation query scenarios', () => {
    describe('compressed messages filtering', () => {
      it('should exclude compressed messages from uncompressed query', async () => {
        // Setup: Create 5 messages, compress 3 of them
        await serverDB.insert(messages).values([
          {
            id: 'msg-1',
            content: 'Hello',
            role: 'user',
            topicId,
            userId,
            createdAt: new Date('2024-01-01T10:00:00Z'),
          },
          {
            id: 'msg-2',
            content: 'Hi there!',
            role: 'assistant',
            topicId,
            userId,
            createdAt: new Date('2024-01-01T10:01:00Z'),
          },
          {
            id: 'msg-3',
            content: 'How are you?',
            role: 'user',
            topicId,
            userId,
            createdAt: new Date('2024-01-01T10:02:00Z'),
          },
          {
            id: 'msg-4',
            content: 'I am fine',
            role: 'assistant',
            topicId,
            userId,
            createdAt: new Date('2024-01-01T10:03:00Z'),
          },
          {
            id: 'msg-5',
            content: 'Latest question',
            role: 'user',
            topicId,
            userId,
            createdAt: new Date('2024-01-01T10:04:00Z'),
          },
        ]);

        // Compress the first 3 messages
        await compressionRepo.createCompressionGroup({
          content: 'User greeted assistant and asked how they are.',
          messageIds: ['msg-1', 'msg-2', 'msg-3'],
          metadata: {
            originalMessageCount: 3,
            startMessageId: 'msg-1',
            endMessageId: 'msg-3',
          },
          topicId,
        });

        // Query uncompressed messages
        const uncompressedMessages = await compressionRepo.getUncompressedMessages(topicId);

        // Should only return msg-4 and msg-5
        expect(uncompressedMessages).toHaveLength(2);
        expect(uncompressedMessages.map((m) => m.id)).toEqual(['msg-4', 'msg-5']);
      });

      it('should return all messages as uncompressed when no compression groups exist', async () => {
        await serverDB.insert(messages).values([
          { id: 'msg-no-comp-1', content: 'Message 1', role: 'user', topicId, userId },
          { id: 'msg-no-comp-2', content: 'Message 2', role: 'assistant', topicId, userId },
          { id: 'msg-no-comp-3', content: 'Message 3', role: 'user', topicId, userId },
        ]);

        const uncompressedMessages = await compressionRepo.getUncompressedMessages(topicId);

        expect(uncompressedMessages).toHaveLength(3);
      });
    });

    describe('pinned messages in compression groups', () => {
      it('should identify favorite messages within compression groups', async () => {
        // Setup: Create messages with some marked as favorite
        await serverDB.insert(messages).values([
          {
            id: 'msg-fav-1',
            content: 'Normal message',
            role: 'user',
            topicId,
            userId,
            favorite: false,
          },
          {
            id: 'msg-fav-2',
            content: 'Important code example',
            role: 'assistant',
            topicId,
            userId,
            favorite: true,
          },
          {
            id: 'msg-fav-3',
            content: 'Follow up question',
            role: 'user',
            topicId,
            userId,
            favorite: false,
          },
          {
            id: 'msg-fav-4',
            content: 'Critical answer - pinned',
            role: 'assistant',
            topicId,
            userId,
            favorite: true,
          },
          {
            id: 'msg-fav-5',
            content: 'Latest message',
            role: 'user',
            topicId,
            userId,
            favorite: false,
          },
        ]);

        // Compress messages 1-4
        const groupId = await compressionRepo.createCompressionGroup({
          content: 'Discussion about code with important examples.',
          messageIds: ['msg-fav-1', 'msg-fav-2', 'msg-fav-3', 'msg-fav-4'],
          metadata: {
            originalMessageCount: 4,
            startMessageId: 'msg-fav-1',
            endMessageId: 'msg-fav-4',
          },
          topicId,
        });

        // Query compressed messages to verify
        const compressedMessages = await compressionRepo.getCompressedMessages(groupId);
        expect(compressedMessages).toHaveLength(4);

        // Verify favorite messages within the compression group
        const favoriteMessages = compressedMessages.filter((m) => m.favorite === true);
        expect(favoriteMessages).toHaveLength(2);
        expect(favoriteMessages.map((m) => m.id)).toEqual(
          expect.arrayContaining(['msg-fav-2', 'msg-fav-4']),
        );
      });

      it('should return empty array when compression group has no favorite messages', async () => {
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

        const groupId = await compressionRepo.createCompressionGroup({
          content: 'Summary without any pinned messages.',
          messageIds: ['msg-no-fav-1', 'msg-no-fav-2'],
          metadata: { originalMessageCount: 2 },
          topicId,
        });

        const compressedMessages = await compressionRepo.getCompressedMessages(groupId);
        const favoriteMessages = compressedMessages.filter((m) => m.favorite === true);

        expect(favoriteMessages).toHaveLength(0);
      });

      it('should handle multiple compression groups with pinned messages', async () => {
        // Create messages for two separate compression scenarios
        await serverDB.insert(messages).values([
          // First compression group
          {
            id: 'msg-multi-1',
            content: 'Group 1 msg 1',
            role: 'user',
            topicId,
            userId,
            favorite: false,
          },
          {
            id: 'msg-multi-2',
            content: 'Group 1 pinned',
            role: 'assistant',
            topicId,
            userId,
            favorite: true,
          },
          // Second compression group
          {
            id: 'msg-multi-3',
            content: 'Group 2 msg 1',
            role: 'user',
            topicId,
            userId,
            favorite: true,
          },
          {
            id: 'msg-multi-4',
            content: 'Group 2 msg 2',
            role: 'assistant',
            topicId,
            userId,
            favorite: false,
          },
          {
            id: 'msg-multi-5',
            content: 'Group 2 pinned',
            role: 'user',
            topicId,
            userId,
            favorite: true,
          },
          // Uncompressed message
          {
            id: 'msg-multi-6',
            content: 'Latest uncompressed',
            role: 'assistant',
            topicId,
            userId,
            favorite: false,
          },
        ]);

        // Create first compression group
        const groupId1 = await compressionRepo.createCompressionGroup({
          content: 'First conversation summary',
          messageIds: ['msg-multi-1', 'msg-multi-2'],
          metadata: { originalMessageCount: 2 },
          topicId,
        });

        // Create second compression group
        const groupId2 = await compressionRepo.createCompressionGroup({
          content: 'Second conversation summary',
          messageIds: ['msg-multi-3', 'msg-multi-4', 'msg-multi-5'],
          metadata: { originalMessageCount: 3 },
          topicId,
        });

        // Verify first group has 1 favorite message
        const group1Messages = await compressionRepo.getCompressedMessages(groupId1);
        const group1Favorites = group1Messages.filter((m) => m.favorite === true);
        expect(group1Favorites).toHaveLength(1);
        expect(group1Favorites[0].id).toBe('msg-multi-2');

        // Verify second group has 2 favorite messages
        const group2Messages = await compressionRepo.getCompressedMessages(groupId2);
        const group2Favorites = group2Messages.filter((m) => m.favorite === true);
        expect(group2Favorites).toHaveLength(2);
        expect(group2Favorites.map((m) => m.id)).toEqual(
          expect.arrayContaining(['msg-multi-3', 'msg-multi-5']),
        );

        // Verify uncompressed messages
        const uncompressedMessages = await compressionRepo.getUncompressedMessages(topicId);
        expect(uncompressedMessages).toHaveLength(1);
        expect(uncompressedMessages[0].id).toBe('msg-multi-6');
      });
    });

    describe('compression group as trajectory node', () => {
      it('should return compression groups with content and metadata', async () => {
        await serverDB.insert(messages).values([
          { id: 'msg-traj-1', content: 'Hello', role: 'user', topicId, userId },
          { id: 'msg-traj-2', content: 'Hi!', role: 'assistant', topicId, userId },
        ]);

        const metadata = {
          originalMessageCount: 2,
          originalTokenCount: 150,
          startMessageId: 'msg-traj-1',
          endMessageId: 'msg-traj-2',
          compressedAt: new Date().toISOString(),
          compressionStrategy: 'summarize' as const,
        };

        await compressionRepo.createCompressionGroup({
          content: 'User and assistant exchanged greetings.',
          messageIds: ['msg-traj-1', 'msg-traj-2'],
          metadata,
          topicId,
        });

        const groups = await compressionRepo.getCompressionGroups(topicId);

        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({
          content: 'User and assistant exchanged greetings.',
          type: MessageGroupType.Compression,
          topicId,
        });
        expect(groups[0].metadata).toMatchObject({
          originalMessageCount: 2,
          originalTokenCount: 150,
          startMessageId: 'msg-traj-1',
          endMessageId: 'msg-traj-2',
        });
      });

      it('should order compression groups by createdAt for trajectory', async () => {
        // Create messages and compression groups with specific timing
        await serverDB.insert(messages).values([
          { id: 'msg-order-1', content: 'Early message', role: 'user', topicId, userId },
          { id: 'msg-order-2', content: 'Middle message', role: 'assistant', topicId, userId },
          { id: 'msg-order-3', content: 'Late message', role: 'user', topicId, userId },
        ]);

        // Create first compression group
        await compressionRepo.createCompressionGroup({
          content: 'First summary',
          messageIds: ['msg-order-1'],
          metadata: { originalMessageCount: 1 },
          topicId,
        });

        // Small delay to ensure different createdAt
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Create second compression group
        await compressionRepo.createCompressionGroup({
          content: 'Second summary',
          messageIds: ['msg-order-2', 'msg-order-3'],
          metadata: { originalMessageCount: 2 },
          topicId,
        });

        const groups = await compressionRepo.getCompressionGroups(topicId);

        expect(groups).toHaveLength(2);
        expect(groups[0].content).toBe('First summary');
        expect(groups[1].content).toBe('Second summary');
        // Verify ordering by createdAt
        expect(new Date(groups[0].createdAt).getTime()).toBeLessThan(
          new Date(groups[1].createdAt).getTime(),
        );
      });
    });

    describe('trajectory assembly scenario', () => {
      it('should support building trajectory with compression groups and uncompressed messages', async () => {
        // This test simulates the full trajectory assembly scenario
        // Setup: Mixed compressed and uncompressed messages

        await serverDB.insert(messages).values([
          // Early messages to be compressed (with one pinned)
          {
            id: 'traj-1',
            content: 'Hello',
            role: 'user',
            topicId,
            userId,
            favorite: false,
            createdAt: new Date('2024-01-01T10:00:00Z'),
          },
          {
            id: 'traj-2',
            content: 'Hi there!',
            role: 'assistant',
            topicId,
            userId,
            favorite: true,
            createdAt: new Date('2024-01-01T10:01:00Z'),
          },
          {
            id: 'traj-3',
            content: 'Important question',
            role: 'user',
            topicId,
            userId,
            favorite: true,
            createdAt: new Date('2024-01-01T10:02:00Z'),
          },
          {
            id: 'traj-4',
            content: 'Detailed answer',
            role: 'assistant',
            topicId,
            userId,
            favorite: false,
            createdAt: new Date('2024-01-01T10:03:00Z'),
          },
          // Recent uncompressed messages
          {
            id: 'traj-5',
            content: 'New question',
            role: 'user',
            topicId,
            userId,
            favorite: false,
            createdAt: new Date('2024-01-01T10:04:00Z'),
          },
          {
            id: 'traj-6',
            content: 'New answer',
            role: 'assistant',
            topicId,
            userId,
            favorite: false,
            createdAt: new Date('2024-01-01T10:05:00Z'),
          },
        ]);

        // Compress early messages
        const groupId = await compressionRepo.createCompressionGroup({
          content: 'Initial conversation with important question and answer.',
          messageIds: ['traj-1', 'traj-2', 'traj-3', 'traj-4'],
          metadata: {
            originalMessageCount: 4,
            startMessageId: 'traj-1',
            endMessageId: 'traj-4',
          },
          topicId,
        });

        // Fetch components for trajectory assembly
        const compressionGroups = await compressionRepo.getCompressionGroups(topicId);
        const uncompressedMessages = await compressionRepo.getUncompressedMessages(topicId);
        const compressedMessages = await compressionRepo.getCompressedMessages(groupId);
        const pinnedMessagesInGroup = compressedMessages.filter((m) => m.favorite === true);

        // Verify trajectory components
        // 1. Compression groups
        expect(compressionGroups).toHaveLength(1);
        expect(compressionGroups[0].content).toBe(
          'Initial conversation with important question and answer.',
        );

        // 2. Uncompressed messages (recent ones)
        expect(uncompressedMessages).toHaveLength(2);
        expect(uncompressedMessages.map((m) => m.id)).toEqual(['traj-5', 'traj-6']);

        // 3. Pinned messages within compression group (for pinnedMessages field)
        expect(pinnedMessagesInGroup).toHaveLength(2);
        expect(pinnedMessagesInGroup.map((m) => m.id)).toEqual(
          expect.arrayContaining(['traj-2', 'traj-3']),
        );

        // Expected trajectory structure (pseudo):
        // [
        //   {
        //     role: 'compressedGroup',
        //     id: groupId,
        //     content: 'Initial conversation with important question and answer.',
        //     pinnedMessages: [traj-2, traj-3],
        //   },
        //   { role: 'user', id: 'traj-5', content: 'New question' },
        //   { role: 'assistant', id: 'traj-6', content: 'New answer' },
        // ]
      });
    });
  });
});
