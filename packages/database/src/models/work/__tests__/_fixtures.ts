import type {
  DocumentWorkSummaryItem,
  ExternalWorkSummaryItem,
  TaskWorkListItem,
  TaskWorkSummaryItem,
  WorkListItem,
  WorkSummaryItem,
} from '@lobechat/types';
import { expect } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, threads, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';

/**
 * Shared harness for the per-type WorkModel test files (task / document /
 * linear / github / queries). Each file gets its own isolated PGlite instance
 * (getTestDB is a per-module singleton), so seeding the same fixed ids across
 * files never collides.
 */
export const serverDB: LobeChatDatabase = await getTestDB();

export const userId = 'work-test-user-id';
export const userId2 = 'work-test-user-id-2';
export const topicId = 'work-test-topic-id';
export const threadId = 'work-test-thread-id';
export const agentId = 'work-test-agent-id';
export const agentId2 = 'work-test-agent-id-2';

export const seedWorkTestData = async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);
  await serverDB.insert(agents).values([
    { id: agentId, title: 'Work test agent', userId },
    { id: agentId2, title: 'Work test agent 2', userId: userId2 },
  ]);
  await serverDB.insert(topics).values({ id: topicId, userId });
  await serverDB.insert(threads).values({
    id: threadId,
    title: 'Work test thread',
    topicId,
    type: 'standalone',
    userId,
  });
};

export const cleanupWorkTestData = async () => {
  await serverDB.delete(users);
};

export const expectTaskListItem = (item?: WorkListItem): TaskWorkListItem => {
  expect(item).toBeDefined();

  if (!item || item.type !== 'task') {
    throw new Error('Expected task work list item');
  }

  return item;
};

export const expectTaskSummaryItem = (item?: WorkSummaryItem): TaskWorkSummaryItem => {
  expect(item).toBeDefined();

  if (!item || item.type !== 'task') {
    throw new Error('Expected task work summary');
  }

  return item;
};

export const expectDocumentSummaryItem = (item?: WorkSummaryItem): DocumentWorkSummaryItem => {
  expect(item).toBeDefined();

  if (!item || item.type !== 'document') {
    throw new Error('Expected document work summary');
  }

  return item;
};

export const expectExternalSummaryItem = (item?: WorkSummaryItem): ExternalWorkSummaryItem => {
  expect(item).toBeDefined();

  if (!item || item.type !== 'external') {
    throw new Error('Expected external work summary');
  }

  return item;
};
