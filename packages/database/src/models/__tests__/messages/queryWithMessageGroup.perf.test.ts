// @vitest-environment node
import { MessageGroupType } from '@lobechat/types';
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messageGroups, messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const userId = 'message-query-perf-test-user';
const topicId = 'perf-test-topic-1';

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

/**
 * Performance tests for MessageModel.query with MessageGroup aggregation
 * These tests run sequentially to avoid resource contention
 */
describe.sequential('MessageModel.query performance', () => {
  it('should query 500 messages within 100ms', { retry: 3 }, async () => {
    // Create 500 messages
    const messageData = Array.from({ length: 500 }, (_, i) => ({
      id: `perf-msg-${i}`,
      content: `Message content ${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      topicId,
      userId,
      createdAt: new Date(Date.now() - (500 - i) * 1000), // Spread over time
    }));

    await serverDB.insert(messages).values(messageData);

    // Warm up query (first query might be slower due to connection/cache)
    await messageModel.query({ topicId });

    // Measure query performance
    const startTime = performance.now();
    const result = await messageModel.query({ topicId });
    const endTime = performance.now();

    const queryTime = endTime - startTime;

    expect(result).toHaveLength(500);
    expect(queryTime).toBeLessThan(100);

    console.log(`Query 500 messages took ${queryTime.toFixed(2)}ms`);
  });

  it('should query 500 messages with compression groups within 100ms', { retry: 3 }, async () => {
    // Create 500 messages, 400 will be compressed into groups
    const messageData = Array.from({ length: 500 }, (_, i) => ({
      id: `perf-comp-msg-${i}`,
      content: `Message content ${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      topicId,
      userId,
      favorite: i % 10 === 0, // Every 10th message is pinned
      createdAt: new Date(Date.now() - (500 - i) * 1000),
    }));

    await serverDB.insert(messages).values(messageData);

    // Create 4 compression groups, each compressing 100 messages
    for (let g = 0; g < 4; g++) {
      const groupId = `perf-comp-group-${g}`;
      await serverDB.insert(messageGroups).values({
        id: groupId,
        content: `Summary of group ${g}`,
        type: MessageGroupType.Compression,
        topicId,
        userId,
        createdAt: new Date(Date.now() - (400 - g * 100) * 1000),
      });

      // Mark messages 0-99, 100-199, 200-299, 300-399 as compressed
      const messageIds = Array.from({ length: 100 }, (_, i) => `perf-comp-msg-${g * 100 + i}`);
      await serverDB
        .update(messages)
        .set({ messageGroupId: groupId })
        .where(inArray(messages.id, messageIds));
    }

    // Warm up query
    await messageModel.query({ topicId });

    // Measure query performance
    const startTime = performance.now();
    const result = await messageModel.query({ topicId });
    const endTime = performance.now();

    const queryTime = endTime - startTime;

    // Expected: 4 compressedGroup nodes + 100 uncompressed messages = 104 items
    expect(result).toHaveLength(104);
    expect(queryTime).toBeLessThan(100);

    // Verify compressed groups have pinnedMessages
    const compressedGroups = result.filter((m) => m.role === 'compressedGroup') as any[];
    expect(compressedGroups).toHaveLength(4);

    // Each group should have ~10 pinned messages (every 10th out of 100)
    for (const group of compressedGroups) {
      expect(group.pinnedMessages).toBeDefined();
      expect(group.pinnedMessages.length).toBeGreaterThanOrEqual(9);
      expect(group.pinnedMessages.length).toBeLessThanOrEqual(11);
    }

    console.log(`Query 500 messages with 4 compression groups took ${queryTime.toFixed(2)}ms`);
  });
});
