import { eq } from 'drizzle-orm';
import { afterEach, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { agents, topics, users } from '@/database/schemas';

import { assertCurrentToolDispatch } from './toolDispatch';

const db = await getTestDB();
const userId = 'fresh-tool-policy';
afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
});
it('reads current policy on every call and blocks a previously permitted builtin', async () => {
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ id: 'policy-agent', userId });
  await db.insert(topics).values({
    id: 'policy-topic',
    userId,
    agentId: 'policy-agent',
    metadata: { conversationMode: 'agent' },
  });
  const call = {
    db,
    userId,
    agentId: 'policy-agent',
    topicId: 'policy-topic',
    identifier: 'lobe-web-browsing',
    apiName: 'search',
  };
  await expect(assertCurrentToolDispatch(call)).resolves.toBeUndefined();
  await db
    .update(agents)
    .set({ plugins: [{ identifier: 'lobe-web-browsing', mode: 'disabled' }] })
    .where(eq(agents.id, 'policy-agent'));
  await expect(assertCurrentToolDispatch(call)).rejects.toThrow(/enabled/i);
});
