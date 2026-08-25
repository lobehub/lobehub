// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { messages, topics, users, userSettings } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TopicSummaryModel } from '../topicSummary';

const db: LobeChatDatabase = await getTestDB();
const model = new TopicSummaryModel(db);
const userId = 'topic-summary-user';
const otherUserId = 'topic-summary-other';
// Never touched the setting — the feature is opt-in, so this user stays out.
const unsetUserId = 'topic-summary-unset';
const now = new Date('2026-07-31T12:00:00.000Z');

describe('TopicSummaryModel', () => {
  beforeEach(async () => {
    await db.delete(users);
    await db.insert(users).values([{ id: userId }, { id: otherUserId }, { id: unsetUserId }]);
    await db.insert(userSettings).values({
      id: userId,
      systemAgent: { topicAutoSummary: { enabled: true } },
    });
  });

  afterEach(async () => {
    await db.delete(users);
  });

  it('lists only opted-in, stale candidates inside the rolling lookback window', async () => {
    await db.insert(userSettings).values({
      id: otherUserId,
      systemAgent: { topicAutoSummary: { enabled: false } },
    });
    await db.insert(topics).values([
      { createdAt: new Date('2026-07-31T00:00:00Z'), id: 'eligible', userId },
      { createdAt: new Date('2026-07-29T00:00:00Z'), id: 'too-old', userId },
      { createdAt: new Date('2026-07-31T00:00:00Z'), id: 'disabled', userId: otherUserId },
      { createdAt: new Date('2026-07-31T00:00:00Z'), id: 'unset', userId: unsetUserId },
      { createdAt: new Date('2026-07-31T00:00:00Z'), id: 'active', status: 'running', userId },
    ]);
    await db.insert(messages).values([
      {
        content: 'a',
        id: 'm-eligible',
        role: 'user',
        topicId: 'eligible',
        updatedAt: new Date('2026-07-31T10:00:00Z'),
        userId,
      },
      {
        content: 'b',
        id: 'm-old',
        role: 'user',
        topicId: 'too-old',
        updatedAt: new Date('2026-07-29T10:00:00Z'),
        userId,
      },
      {
        content: 'c',
        id: 'm-disabled',
        role: 'user',
        topicId: 'disabled',
        updatedAt: new Date('2026-07-31T10:00:00Z'),
        userId: otherUserId,
      },
      {
        content: 'c2',
        id: 'm-unset',
        role: 'user',
        topicId: 'unset',
        updatedAt: new Date('2026-07-31T10:00:00Z'),
        userId: unsetUserId,
      },
      {
        content: 'd',
        id: 'm-active',
        role: 'user',
        topicId: 'active',
        updatedAt: new Date('2026-07-31T10:00:00Z'),
        userId,
      },
    ]);

    const result = await model.listCandidates({
      idleBefore: new Date('2026-07-31T11:00:00Z'),
      limit: 20,
      topicCreatedAfter: new Date('2026-07-30T12:00:00Z'),
    });

    expect(result.map(({ id }) => id)).toEqual(['eligible']);
  });

  it('skips a topic whose watermark matches its latest message', async () => {
    const lastMessageUpdatedAt = new Date('2026-07-31T10:00:00Z');
    await db.insert(topics).values({
      createdAt: new Date('2026-07-31T00:00:00Z'),
      id: 'summarized',
      metadata: {
        autoSummary: {
          lastMessageId: 'm-summary',
          lastMessageUpdatedAt: lastMessageUpdatedAt.toISOString(),
          summarizedAt: now.toISOString(),
          version: 1,
        },
      },
      userId,
    });
    await db.insert(messages).values({
      content: 'done',
      id: 'm-summary',
      role: 'assistant',
      topicId: 'summarized',
      updatedAt: lastMessageUpdatedAt,
      userId,
    });

    const result = await model.listCandidates({
      idleBefore: new Date('2026-07-31T11:00:00Z'),
      limit: 20,
      topicCreatedAfter: new Date('2026-07-30T12:00:00Z'),
    });

    expect(result).toEqual([]);
  });

  it('excludes system-generated topics from candidates', async () => {
    await db.insert(topics).values([
      { createdAt: new Date('2026-07-31T00:00:00Z'), id: 'regular', userId },
      {
        createdAt: new Date('2026-07-31T00:00:00Z'),
        id: 'evaluation',
        trigger: 'eval',
        userId,
      },
    ]);
    await db.insert(messages).values([
      {
        content: 'regular message',
        id: 'm-regular',
        role: 'user',
        topicId: 'regular',
        updatedAt: new Date('2026-07-31T10:00:00Z'),
        userId,
      },
      {
        content: 'evaluation message',
        id: 'm-evaluation',
        role: 'user',
        topicId: 'evaluation',
        updatedAt: new Date('2026-07-31T10:00:00Z'),
        userId,
      },
    ]);

    const result = await model.listCandidates({
      idleBefore: new Date('2026-07-31T11:00:00Z'),
      limit: 20,
      topicCreatedAfter: new Date('2026-07-30T12:00:00Z'),
    });

    expect(result.map(({ id }) => id)).toEqual(['regular']);
  });

  it('does not overwrite the summary when a newer message arrives', async () => {
    await db.insert(topics).values({ id: 'racing', userId });
    await db.insert(messages).values([
      {
        content: 'old',
        id: 'm-old',
        role: 'user',
        topicId: 'racing',
        updatedAt: new Date('2026-07-31T10:00:00Z'),
        userId,
      },
      {
        content: 'new',
        id: 'm-new',
        role: 'assistant',
        topicId: 'racing',
        updatedAt: new Date('2026-07-31T10:01:00Z'),
        userId,
      },
    ]);

    const updated = await model.updateSummaryIfCurrent({
      description: 'Old description',
      lastMessageId: 'm-old',
      lastMessageUpdatedAt: new Date('2026-07-31T10:00:00Z'),
      summary: 'Old summary',
      topicId: 'racing',
    });
    const [topic] = await db.select().from(topics).where(eq(topics.id, 'racing'));

    expect(updated).toBe(false);
    expect(topic.description).toBeNull();
    expect(topic.historySummary).toBeNull();
  });

  it('ignores newer ineligible messages when checking the write fence', async () => {
    await db.insert(topics).values({ id: 'tool-followup', userId });
    await db.insert(messages).values([
      {
        content: 'answer',
        id: 'm-answer',
        role: 'assistant',
        topicId: 'tool-followup',
        updatedAt: new Date('2026-07-31T10:00:00Z'),
        userId,
      },
      {
        content: 'tool result',
        id: 'm-tool',
        role: 'tool',
        topicId: 'tool-followup',
        updatedAt: new Date('2026-07-31T10:01:00Z'),
        userId,
      },
    ]);

    const updated = await model.updateSummaryIfCurrent({
      description: 'Description',
      lastMessageId: 'm-answer',
      lastMessageUpdatedAt: new Date('2026-07-31T10:00:00Z'),
      summary: 'Summary',
      topicId: 'tool-followup',
    });
    const [topic] = await db.select().from(topics).where(eq(topics.id, 'tool-followup'));

    expect(updated).toBe(true);
    expect(topic.description).toBe('Description');
    expect(topic.historySummary).toBe('Summary');
  });
});
