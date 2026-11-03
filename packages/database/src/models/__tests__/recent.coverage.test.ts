// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, documents, messages, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { RecentModel } from '../recent';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 't863-recent-cov-user';
const recentModel = new RecentModel(serverDB, userId);

const seedTopic = async (id: string, assistantContent?: string) => {
  await serverDB.insert(topics).values({ agentId: 't863-recent-agent', id, userId });
  if (assistantContent !== undefined) {
    await serverDB.insert(messages).values({
      agentId: 't863-recent-agent',
      content: assistantContent,
      id: `${id}-message`,
      role: 'assistant',
      topicId: id,
      userId,
    });
  }
};

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: 't863-recent-agent', slug: 'inbox', userId });
});

afterEach(async () => {
  // Agents, topics, messages and documents cascade with their owner.
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('RecentModel coverage', () => {
  it('drops the topic arm when topics are not requested, even with previews on', async () => {
    await seedTopic('t863-recent-topic', 'an answer');
    await serverDB.insert(documents).values({
      fileType: 'markdown',
      id: 't863-recent-doc',
      source: 'document',
      sourceType: 'api',
      title: 'Doc',
      totalCharCount: 100,
      totalLineCount: 5,
      userId,
    });

    const result = await recentModel.queryRecent(10, ['document'], true);

    expect(result.map((row) => [row.type, row.id])).toEqual([['document', 't863-recent-doc']]);
    expect(result[0].lastAssistantMessage).toBeNull();
  });

  it('truncates a preview longer than the preview limit with an ellipsis', async () => {
    await seedTopic('t863-recent-long', 'a'.repeat(2500));

    const [row] = await recentModel.queryRecent(1, ['topic'], true);

    expect(row.id).toBe('t863-recent-long');
    expect(row.lastAssistantMessage).toBe(`${'a'.repeat(2000)}…`);
  });
});
