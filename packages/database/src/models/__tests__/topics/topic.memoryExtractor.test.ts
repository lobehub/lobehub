import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';

const userId = 'topic-memory-extractor-user';
const serverDB: LobeChatDatabase = await getTestDB();
const topicModel = new TopicModel(serverDB, userId);

describe('TopicModel - countTopicsForMemoryExtractor', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values({ id: userId });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('counts only unextracted topics when ignoreExtracted is false (default behavior)', async () => {
    await serverDB.insert(topics).values([
      {
        id: 't1',
        createdAt: new Date('2023-01-01'),
        metadata: {},
        userId,
      },
      {
        id: 't2',
        createdAt: new Date('2023-02-01'),
        metadata: {
          userMemoryExtractStatus: 'completed',
        },
        userId,
      },
      {
        id: 't3',
        createdAt: new Date('2023-03-01'),
        metadata: {},
        userId,
      },
    ]);

    const total = await topicModel.countTopicsForMemoryExtractor({
      ignoreExtracted: false,
    });

    expect(total).toBe(2);
  });

  it('includes extracted topics when ignoreExtracted is true', async () => {
    await serverDB.insert(topics).values([
      {
        id: 't1',
        createdAt: new Date('2023-01-01'),
        metadata: {},
        userId,
      },
      {
        id: 't2',
        createdAt: new Date('2023-02-01'),
        metadata: {
          userMemoryExtractStatus: 'completed',
        },
        userId,
      },
    ]);

    const total = await topicModel.countTopicsForMemoryExtractor({
      ignoreExtracted: true,
    });

    expect(total).toBe(2);
  });

  it('excludes agent-share visitor topics from the count', async () => {
    await serverDB.insert(topics).values([
      // normal creator topic — kept
      {
        id: 't1',
        createdAt: new Date('2023-01-01'),
        metadata: {},
        userId,
      },
      // agent-share visitor topic: userId is still the creator, but senderId
      // marks it as a visitor conversation that must not feed memory extraction
      {
        id: 't2-visitor',
        createdAt: new Date('2023-01-02'),
        metadata: {},
        senderId: 'visitor-user-x',
        userId,
      },
    ]);

    const total = await topicModel.countTopicsForMemoryExtractor({
      ignoreExtracted: true,
    });

    expect(total).toBe(1);
  });
});

describe('TopicModel - listTopicsForMemoryExtractor', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values({ id: userId });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('excludes agent-share visitor topics from the list', async () => {
    await serverDB.insert(topics).values([
      // normal creator topic — kept
      {
        id: 't1',
        createdAt: new Date('2023-01-01'),
        metadata: {},
        userId,
      },
      // agent-share visitor topic: userId is still the creator, but senderId
      // marks it as a visitor conversation that must not feed memory extraction
      {
        id: 't2-visitor',
        createdAt: new Date('2023-01-02'),
        metadata: {},
        senderId: 'visitor-user-x',
        userId,
      },
    ]);

    const result = await topicModel.listTopicsForMemoryExtractor({ ignoreExtracted: true });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('t1');
  });
});
