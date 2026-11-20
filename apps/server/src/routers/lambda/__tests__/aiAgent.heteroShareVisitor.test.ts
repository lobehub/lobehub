// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agentOperations, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveHeteroRunShareVisitor } from '@/server/services/heterogeneousAgent/shareVisitor';

import { aiAgentRouter } from '../aiAgent';
import { cleanupTestUser, createTestUser } from './integration/setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

const serviceCtor = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/heterogeneousAgent', () => ({
  HeterogeneousAgentService: vi.fn().mockImplementation(function (...args: unknown[]) {
    serviceCtor(...args);
    return { heteroFinish: vi.fn(), heteroIngest: vi.fn() };
  }),
}));
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));
vi.mock('@/server/services/aiChat', () => ({
  AiChatService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

describe('hetero run share visitor', () => {
  let db: LobeChatDatabase;
  let userId: string;

  // Ids are suffixed per test: operation rows outlive `cleanupTestUser`.
  let seq = 0;
  let suffix = '';
  const ids = (name: string) => ({ op: `op-${name}-${suffix}`, topic: `topic-${name}-${suffix}` });
  const insertRun = async (
    name: string,
    senderId: string | null,
    metadata?: Record<string, unknown>,
  ) => {
    const { op, topic } = ids(name);
    await db.insert(topics).values({ id: topic, senderId, title: topic, userId });
    await db
      .insert(agentOperations)
      .values({ id: op, metadata, status: 'running', topicId: topic, userId });
    return { operationId: op, topicId: topic };
  };

  beforeEach(async () => {
    db = await getTestDB();
    testDB = db;
    userId = await createTestUser(db);
    serviceCtor.mockClear();
    suffix = String(++seq);
  });

  afterEach(async () => {
    await cleanupTestUser(db, userId);
  });

  const marker = { shareId: 'share-1', visitorUserId: 'visitor-1' };

  describe('resolveHeteroRunShareVisitor', () => {
    it('returns the marker when it names the topic sender', async () => {
      const run = await insertRun('ok', 'visitor-1', { agentShareVisitor: marker });

      await expect(resolveHeteroRunShareVisitor({ db, ...run })).resolves.toEqual(marker);
    });

    it.each([
      ['has no marker', 'visitor-1', {}],
      [
        'names a different visitor than the topic sender',
        'visitor-1',
        { agentShareVisitor: { ...marker, visitorUserId: 'someone-else' } },
      ],
      ['has no shareId', 'visitor-1', { agentShareVisitor: { visitorUserId: 'visitor-1' } }],
      ['belongs to a topic without a sender', null, { agentShareVisitor: marker }],
    ])('returns undefined when the operation %s', async (_, senderId, metadata) => {
      const run = await insertRun('x', senderId, metadata);

      await expect(resolveHeteroRunShareVisitor({ db, ...run })).resolves.toBeUndefined();
    });

    it('returns undefined when the topic or operation does not exist', async () => {
      const run = await insertRun('y', 'visitor-1', { agentShareVisitor: marker });

      await expect(
        resolveHeteroRunShareVisitor({ db, ...run, topicId: 'missing-topic' }),
      ).resolves.toBeUndefined();
      await expect(
        resolveHeteroRunShareVisitor({ db, ...run, operationId: 'missing-op' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('heteroIngest / heteroFinish wiring', () => {
    const createCaller = () =>
      aiAgentRouter.createCaller({
        jwtPayload: { userId },
        oidcAuth: { sub: userId },
        userId,
      } as any);

    const serviceOptions = () => serviceCtor.mock.calls[0][2];
    const event = (operationId: string) => ({
      data: {},
      operationId,
      stepIndex: 0,
      timestamp: 1_700_000_000_000,
      type: 'stream_chunk' as const,
    });

    it('passes the resolved visitor into the service and starts no queued follow-up on finish', async () => {
      const run = await insertRun('share', 'visitor-1', { agentShareVisitor: marker });
      const params = { agentType: 'claude-code', ...run } as const;

      await createCaller().heteroIngest({ ...params, events: [event(run.operationId)] });
      expect(serviceOptions().shareVisitor).toEqual(marker);

      serviceCtor.mockClear();
      await createCaller().heteroFinish({ ...params, result: 'success' });
      expect(serviceOptions().shareVisitor).toEqual(marker);
      expect(serviceOptions().startQueuedFollowUp).toBeUndefined();
    });

    it('keeps the queued follow-up and no visitor for an ordinary run', async () => {
      const run = await insertRun('own', null);

      await createCaller().heteroFinish({ agentType: 'claude-code', ...run, result: 'success' });

      expect(serviceOptions().shareVisitor).toBeUndefined();
      expect(serviceOptions().startQueuedFollowUp).toEqual(expect.any(Function));
    });
  });
});
