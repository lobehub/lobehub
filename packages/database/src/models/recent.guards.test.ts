// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../core/getTestDB';
import { agents, messages, topics, users } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { RecentModel } from './recent';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'recent-guards-user';
const agentId = 'recent-guards-agent';
const topicId = 'recent-guards-topic';
const recentModel = new RecentModel(serverDB, userId);

const markdown = '## Done\n\n**Shipped** the [fix](https://example.com)  ';

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: agentId, slug: 'inbox', userId });
  await serverDB.insert(topics).values({ agentId, id: topicId, userId });
  await serverDB.insert(messages).values({
    agentId,
    content: markdown,
    id: `${topicId}-message`,
    role: 'assistant',
    topicId,
    userId,
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Agents, topics and messages cascade with their owner.
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('RecentModel preview guard', () => {
  it('falls back to the raw markdown when remove-markdown throws', async () => {
    // remove-markdown strips horizontal rules before entering its own try/catch, so a
    // `replace` that throws on this preview escapes the library. Every other string, the
    // driver's and drizzle's included, goes through the real `replace`.
    const replace = String.prototype.replace;
    const failing = vi.spyOn(String.prototype, 'replace').mockImplementation(function (
      this: string,
      ...args: Parameters<typeof replace>
    ) {
      if (String(this) === markdown) throw new TypeError('remove-markdown: unexpected input');
      return replace.apply(this, args);
    });

    const [row] = await recentModel.queryRecent(1, ['topic'], true);
    const threw = failing.mock.results.some((result) => result.type === 'throw');
    failing.mockRestore();

    expect(threw).toBe(true);
    // Untouched, trailing whitespace included: the fallback skips the plain-text pass entirely.
    expect(row).toMatchObject({ id: topicId, lastAssistantMessage: markdown });
  });
});

describe('RecentModel updatedAt guard', () => {
  it('turns a non-Date updatedAt from the decoder back into a Date', async () => {
    const [topic] = await serverDB.select().from(topics).where(eq(topics.id, topicId));
    // The column decoder hands back the ISO string instead of a Date, as a driver or drizzle
    // upgrade that stops parsing timestamptz would.
    vi.spyOn(topics.updatedAt, 'mapFromDriverValue').mockImplementation((value) =>
      value instanceof Date ? (value.toISOString() as unknown as Date) : new Date(value),
    );

    const [row] = await recentModel.queryRecent(1, ['topic']);

    expect(row.id).toBe(topicId);
    expect(row.updatedAt).toBeInstanceOf(Date);
    expect(row.updatedAt.getTime()).toBe(topic.updatedAt.getTime());
  });
});
