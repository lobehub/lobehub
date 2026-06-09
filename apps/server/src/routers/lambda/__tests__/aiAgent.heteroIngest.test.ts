// @vitest-environment node
import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentRouter } from '../aiAgent';
import { cleanupTestUser, createTestUser } from './integration/setup';

// Mock getServerDB to return our test database instance
let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

const mockHeteroIngest = vi.fn();
const mockHeteroFinish = vi.fn();

// Stub the service so we can assert on procedure → service wiring without
// pulling in the real Redis-backed StreamEventManager.
vi.mock('@/server/services/heterogeneousAgent', () => ({
  HeterogeneousAgentService: vi.fn().mockImplementation(() => ({
    heteroFinish: mockHeteroFinish,
    heteroIngest: mockHeteroIngest,
  })),
}));

// AgentRuntimeService and AiChatService are constructed by the procedure
// middleware too — stub to keep the test isolated.
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@/server/services/aiChat', () => ({
  AiChatService: vi.fn().mockImplementation(() => ({})),
}));

const buildEvent = (type: AgentStreamEvent['type'], stepIndex: number): AgentStreamEvent => ({
  data: {},
  operationId: 'op-1',
  stepIndex,
  timestamp: 1_700_000_000_000,
  type,
});

describe('aiAgentRouter.heteroIngest / heteroFinish', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
    mockHeteroIngest.mockReset();
    mockHeteroFinish.mockReset();
    mockHeteroIngest.mockResolvedValue(undefined);
    mockHeteroFinish.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
    vi.clearAllMocks();
  });

  const createCaller = () =>
    aiAgentRouter.createCaller({
      jwtPayload: { userId },
      oidcAuth: { purpose: 'hetero-operation', sub: userId },
      userId,
    } as any);

  describe('heteroIngest', () => {
    it('delegates the batch to HeterogeneousAgentService and acks', async () => {
      const events = [
        buildEvent('stream_start', 0),
        buildEvent('stream_chunk', 1),
        buildEvent('agent_runtime_end', 2),
      ];

      const result = await createCaller().heteroIngest({
        agentType: 'claude-code',
        events,
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      expect(result).toEqual({ ack: true });
      expect(mockHeteroIngest).toHaveBeenCalledTimes(1);
      expect(mockHeteroIngest).toHaveBeenCalledWith({
        agentType: 'claude-code',
        events,
        operationId: 'op-1',
        topicId: 'topic-1',
      });
    });

    it('wraps service errors into INTERNAL_SERVER_ERROR so the CLI ingester retries', async () => {
      mockHeteroIngest.mockRejectedValueOnce(new Error('redis down'));

      await expect(
        createCaller().heteroIngest({
          agentType: 'claude-code',
          events: [buildEvent('stream_chunk', 0)],
          operationId: 'op-1',
          topicId: 'topic-1',
        }),
      ).rejects.toThrow(/redis down/);
    });

    it('rejects empty batches at the schema layer', async () => {
      await expect(
        createCaller().heteroIngest({
          agentType: 'claude-code',
          events: [],
          operationId: 'op-1',
          topicId: 'topic-1',
        }),
      ).rejects.toThrow();
    });

    it('rejects unknown agent types at the schema layer', async () => {
      await expect(
        createCaller().heteroIngest({
          // @ts-expect-error — verifying schema validation
          agentType: 'gemini',
          events: [buildEvent('stream_chunk', 0)],
          operationId: 'op-1',
          topicId: 'topic-1',
        }),
      ).rejects.toThrow();
    });
  });

  describe('heteroFinish', () => {
    it('forwards finish payload to the service and acks', async () => {
      const result = await createCaller().heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-1',
        result: 'success',
        sessionId: 'cc-session-abc',
        topicId: 'topic-1',
      });

      expect(result).toEqual({ ack: true });
      expect(mockHeteroFinish).toHaveBeenCalledWith({
        agentType: 'claude-code',
        error: undefined,
        operationId: 'op-1',
        result: 'success',
        sessionId: 'cc-session-abc',
        topicId: 'topic-1',
      });
    });

    it('passes through error classification', async () => {
      await createCaller().heteroFinish({
        agentType: 'codex',
        error: { message: 'auth required', type: 'AuthRequired' },
        operationId: 'op-2',
        result: 'error',
        topicId: 'topic-2',
      });

      expect(mockHeteroFinish).toHaveBeenCalledWith(
        expect.objectContaining({
          error: { message: 'auth required', type: 'AuthRequired' },
          result: 'error',
        }),
      );
    });

    it('rejects unknown result values at the schema layer', async () => {
      await expect(
        createCaller().heteroFinish({
          agentType: 'claude-code',
          // @ts-expect-error — verifying schema validation
          result: 'maybe',
          operationId: 'op-1',
          topicId: 'topic-1',
        }),
      ).rejects.toThrow();
    });
  });
});
