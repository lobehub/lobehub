// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agentOperations, agents, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '@/server/services/aiAgent';

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

  describe('a topic left running by a run that already ended', () => {
    const markTopicRunning = async (operationId: string) =>
      serverDB
        .update(topics)
        .set({
          metadata: {
            runningOperation: {
              assistantMessageId: 'msg-a',
              deviceId: 'dev-1',
              heteroType: 'devin',
              operationId,
            },
          },
          status: 'running',
        })
        .where(eq(topics.id, topicId));
    const readTopic = async () =>
      (await serverDB.select().from(topics).where(eq(topics.id, topicId)))[0];

    it('releases the dead marker so the stop actually ends it', async () => {
      // The run's row is terminal, but its terminal never cleared the marker:
      // every reader treats the topic as idle, yet it still shows `running`.
      await serverDB
        .insert(agentOperations)
        .values({ id: 'op-dead', status: 'abandoned', topicId, userId });
      await markTopicRunning('op-dead');
      mocks.findOwnLiveRuns.mockResolvedValue([]);

      expect(await caller().interruptTask({ topicId })).toMatchObject({
        running: 0,
        success: true,
      });

      const topic = await readTopic();
      expect(topic.metadata?.runningOperation).toBeFalsy();
      expect(topic.status).toBe('active');
    });

    it('leaves the marker of a live run alone', async () => {
      await serverDB
        .insert(agentOperations)
        .values({ id: 'op-live', status: 'running', topicId, userId });
      await markTopicRunning('op-live');
      mocks.findOwnLiveRuns.mockResolvedValue([]);

      await caller().interruptTask({ topicId });

      const topic = await readTopic();
      expect(topic.metadata?.runningOperation?.operationId).toBe('op-live');
      expect(topic.status).toBe('running');
    });
  });

  it('forwards force, and reports why a run could not be stopped or how it ended', async () => {
    mocks.findOwnLiveRuns.mockResolvedValue(['op-a', 'op-b']);
    const interrupt = vi
      .spyOn(AiAgentService.prototype, 'interruptTask')
      .mockResolvedValueOnce({ completionReason: 'runner_disconnected', success: true })
      .mockResolvedValueOnce({ failureReason: 'runner_unreachable', success: false });

    expect(await caller().interruptTask({ force: true, topicId })).toMatchObject({
      completionReason: 'runner_disconnected',
      failureReason: 'runner_unreachable',
      running: 2,
      stopped: 1,
      success: false,
    });
    expect(interrupt).toHaveBeenCalledWith({ force: true, operationId: 'op-a', topicId });
    interrupt.mockRestore();
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
