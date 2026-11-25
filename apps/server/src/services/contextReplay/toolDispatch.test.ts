import { eq } from 'drizzle-orm';
import { afterEach, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { MessageModel } from '@/database/models/message';
import { agents, messages, topics, users } from '@/database/schemas';

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

it('compares explicit live pins with the invocation binding despite a stale running-device marker', async () => {
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ id: 'policy-agent', userId });
  await db.insert(topics).values({
    id: 'policy-topic',
    userId,
    agentId: 'policy-agent',
    metadata: {
      boundDeviceId: 'A',
      runningOperation: {
        operationId: 'op',
        assistantMessageId: 'device-assistant',
        deviceId: 'A',
        startedAt: new Date().toISOString(),
      },
    },
  });
  await db.insert(messages).values({
    id: 'device-assistant',
    role: 'assistant',
    userId,
    topicId: 'policy-topic',
    agentId: 'policy-agent',
  });
  await new MessageModel(db, userId).commitContextReplay('device-assistant', {
    invocationId: 'device-assistant',
    version: 1,
    changes: [],
    sourceIds: [],
    sessionKey: 'device',
    executionBinding: { topicDeviceId: 'A', agentDeviceId: null },
  });
  const call = {
    db,
    userId,
    agentId: 'policy-agent',
    topicId: 'policy-topic',
    assistantMessageId: 'device-assistant',
    identifier: 'lobe-local-system',
    apiName: 'runCommand',
    expectedDeviceId: 'A',
  };
  const topic = await db.query.topics.findFirst({ where: eq(topics.id, 'policy-topic') });
  for (const boundDeviceId of ['B', undefined]) {
    await db
      .update(topics)
      .set({ metadata: { ...topic?.metadata, boundDeviceId } })
      .where(eq(topics.id, 'policy-topic'));
    await expect(assertCurrentToolDispatch(call)).rejects.toThrow(/device/i);
    await expect(
      assertCurrentToolDispatch({ ...call, identifier: 'lobe-web-browsing', apiName: 'search' }),
    ).resolves.toBeUndefined();
  }
});
