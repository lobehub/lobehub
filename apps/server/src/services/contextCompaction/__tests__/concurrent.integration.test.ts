// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { type LobeChatDatabase } from '@lobechat/database';
import { messageGroups, messages, topics, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextCompactionService } from '../index';

const mocks = vi.hoisted(() => ({
  bothRead: undefined as Promise<void> | undefined,
  chat: vi.fn(),
  getAgentConfigById: vi.fn(),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: class {
    getAgentConfigById = mocks.getAgentConfigById;
  },
}));
// The messages carry no files; only the URL resolver touches storage.
vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFileAccessUrl = vi.fn();
  },
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: async () => ({ chat: mocks.chat }),
}));
vi.mock('@lobechat/model-runtime', () => ({
  consumeStreamUntilDone: vi.fn(async () => {}),
  getModelPropertyWithFallback: vi.fn(async () => 128_000),
}));

/**
 * Two tabs run `/compact` on the same conversation. The agent lookup sits
 * between the history read and the first write, so holding it until both calls
 * arrive reproduces "both snapshot the same live ids before either writes".
 */
describe('ContextCompactionService — two concurrent compactions of one topic', () => {
  let db: LobeChatDatabase;
  let userId: string;
  let topicId: string;

  beforeEach(async () => {
    db = await getTestDB();
    userId = `user_${randomUUID()}`;
    topicId = `tpc_${randomUUID()}`;
    await db.insert(users).values({ id: userId });
    await db.insert(topics).values({ id: topicId, title: 'Two tabs', userId });
    await db.insert(messages).values([
      { content: 'Plan the migration', id: `msg_${randomUUID()}`, role: 'user', topicId, userId },
      {
        content: 'Here is the plan',
        id: `msg_${randomUUID()}`,
        role: 'assistant',
        topicId,
        userId,
      },
    ]);

    let arrived = 0;
    let release!: () => void;
    mocks.bothRead = new Promise<void>((resolve) => (release = resolve));
    mocks.getAgentConfigById.mockImplementation(async () => {
      arrived += 1;
      if (arrived === 2) release();
      await mocks.bothRead;
      return { model: 'gpt-5', provider: 'openai' };
    });
    let call = 0;
    mocks.chat.mockImplementation(async (_payload, options) => {
      call += 1;
      options.callback.onText(`Summary from tab ${call}`);
      return new Response('');
    });
  });

  it('persists exactly one compression group and reports the other call as in progress', async () => {
    const compact = () =>
      new ContextCompactionService(db, userId).compact({ agentId: 'agent-1', topicId });

    const results = await Promise.all([compact(), compact()]);

    const groups = await db.select().from(messageGroups).where(eq(messageGroups.topicId, topicId));
    const rows = await db.select().from(messages).where(eq(messages.topicId, topicId));

    // No orphan card: the only group holds every message.
    expect(groups).toHaveLength(1);
    expect(groups[0].content).toMatch(/^Summary from tab/);
    expect(rows.every((row) => row.messageGroupId === groups[0].id)).toBe(true);

    expect(results.filter((result) => !result.skipped)).toHaveLength(1);
    expect(results.find((result) => result.skipped)).toMatchObject({ inProgress: true });
  });
});
