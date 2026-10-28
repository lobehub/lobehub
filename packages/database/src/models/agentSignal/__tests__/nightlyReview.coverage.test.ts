// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { createProxyTestDB } from '../../__tests__/_proxyTestDB';
import { AgentSignalNightlyReviewModel } from '../nightlyReview';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'nightly-review-coverage-user';
const agentId = 'nightly-review-coverage-agent';
const topicId = 'nightly-review-coverage-topic';

afterEach(async () => {
  // Agents, topics and messages cascade with their owner.
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('AgentSignalNightlyReviewModel coverage', () => {
  /**
   * node-postgres in this repo hands `MIN`/`MAX` of a timestamptz back as a string, but a driver
   * keeping pg's default parsers returns a `Date`; both must come out as the same instant.
   */
  it('keeps activity timestamps a driver already parsed into Date objects', async () => {
    await serverDB
      .insert(users)
      .values({ id: userId, preference: { lab: { enableSelfLearning: true } } });
    await serverDB.insert(agents).values({ id: agentId, title: 'Custom', userId });
    await serverDB.insert(topics).values({ agentId, id: topicId, title: 'Custom', userId });
    await serverDB.insert(messages).values({
      agentId,
      content: 'activity',
      createdAt: new Date('2026-05-03T14:00:00.000Z'),
      id: 'nightly-review-coverage-message',
      role: 'user',
      topicId,
      userId,
    });

    // Raw driver rows go through its default type parsers, so timestamps arrive as Date.
    const dateParsingDB = createProxyTestDB(serverDB);

    const result = await new AgentSignalNightlyReviewModel(dateParsingDB).listActiveAgentTargets(
      userId,
      {
        agentId,
        windowEnd: new Date('2026-05-03T23:59:59.999Z'),
        windowStart: new Date('2026-05-03T00:00:00.000Z'),
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0].firstActivityAt).toEqual(new Date('2026-05-03T14:00:00.000Z'));
    expect(result[0].lastActivityAt).toEqual(new Date('2026-05-03T14:00:00.000Z'));
  });
});
