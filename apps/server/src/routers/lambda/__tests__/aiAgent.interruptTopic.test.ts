// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentRouter } from '../aiAgent';
import { cleanupTestUser, createTestUser } from './integration/setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

const mocks = vi.hoisted(() => ({
  findOwnLiveRuns: vi.fn(),
  interruptOperation: vi.fn(),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return { interruptOperation: mocks.interruptOperation };
  }),
}));
vi.mock('@/server/services/aiChat', () => ({
  AiChatService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));
vi.mock('@/server/services/aiAgent/steerQueue/liveRuns', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findOwnLiveRuns: mocks.findOwnLiveRuns,
}));

describe('aiAgentRouter.interruptTask — by topic', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let topicId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
    mocks.interruptOperation.mockReset();
    mocks.interruptOperation.mockResolvedValue(true);
    mocks.findOwnLiveRuns.mockReset();

    const [agent] = await serverDB.insert(agents).values({ title: 'A', userId }).returning();
    const [topic] = await serverDB
      .insert(topics)
      .values({ agentId: agent.id, title: 'T', userId })
      .returning();
    topicId = topic.id;
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
    vi.clearAllMocks();
  });

  const caller = () => aiAgentRouter.createCaller({ jwtPayload: { userId }, userId } as any);

  it("stops every live run the caller owns on the topic's main line", async () => {
    mocks.findOwnLiveRuns.mockResolvedValue(['op-a', 'op-b']);

    const result = await caller().interruptTask({ topicId });

    expect(mocks.findOwnLiveRuns).toHaveBeenCalledWith(expect.anything(), {
      threadId: null,
      topicId,
      userId,
    });
    expect(mocks.interruptOperation).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ running: 2, stopped: 2, success: true });
  });

  it('reports nothing running as a successful no-op', async () => {
    mocks.findOwnLiveRuns.mockResolvedValue([]);

    expect(await caller().interruptTask({ topicId })).toMatchObject({
      running: 0,
      stopped: 0,
      success: true,
    });
    expect(mocks.interruptOperation).not.toHaveBeenCalled();
  });

  it('says so when a run could not be confirmed stopped', async () => {
    mocks.findOwnLiveRuns.mockResolvedValue(['op-a']);
    mocks.interruptOperation.mockResolvedValue(false);

    expect(await caller().interruptTask({ topicId })).toMatchObject({
      running: 1,
      stopped: 0,
      success: false,
    });
  });

  it('still requires one of thread, operation or topic', async () => {
    await expect(caller().interruptTask({} as any)).rejects.toThrow();
  });
});
