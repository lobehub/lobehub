// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, messages, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { detachFromSurvivingTopics } from '../agent/delete';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-detach-cov-user';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('detachFromSurvivingTopics', () => {
  it('is a no-op when there is no agent to delete', async () => {
    await serverDB.insert(agents).values({ id: 'detach-agent', slug: 'detach-agent', userId });
    await serverDB.insert(topics).values({ agentId: 'detach-agent', id: 'detach-topic', userId });
    await serverDB.insert(messages).values({
      agentId: 'detach-agent',
      content: 'kept',
      id: 'detach-message',
      role: 'user',
      topicId: 'detach-topic',
      userId,
    });

    await expect(detachFromSurvivingTopics({ db: serverDB }, [])).resolves.toBeUndefined();

    const row = await serverDB.query.messages.findFirst({
      where: eq(messages.id, 'detach-message'),
    });
    expect(row?.agentId).toBe('detach-agent');
  });
});
