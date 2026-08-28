// @vitest-environment node
import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { type LobeChatDatabase } from '@lobechat/database';
import { topics, workspaceMembers, workspaces } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { LOCAL_HETEROGENEOUS_AGENT_TYPES } from '@lobechat/types';
import { eq } from 'drizzle-orm';
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
    await serverDB.insert(topics).values([
      { id: 'topic-1', title: 'Personal topic 1', userId },
      { id: 'topic-2', title: 'Personal topic 2', userId },
    ]);
    mockHeteroIngest.mockReset();
    mockHeteroFinish.mockReset();
    mockHeteroIngest.mockResolvedValue(undefined);
    mockHeteroFinish.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
    vi.clearAllMocks();
  });

  const createCaller = (
    params: { authKind?: 'operation' | 'user'; authUserId?: string; workspaceId?: string } = {},
  ) => {
    const authUserId = params.authUserId ?? userId;
    return aiAgentRouter.createCaller({
      jwtPayload: { userId: authUserId },
      oidcAuth: {
        ...(params.authKind === 'operation' ? { purpose: 'hetero-operation' } : {}),
        sub: authUserId,
      },
      userId: authUserId,
      workspaceId: params.workspaceId,
    } as any);
  };

  describe('heteroIngest', () => {
    it('delegates the batch to HeterogeneousAgentService and acks', async () => {
      const events = [
        buildEvent('stream_start', 0),
        buildEvent('stream_chunk', 1),
        buildEvent('stream_end', 2),
        buildEvent('visible_output_end', 2),
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

    it.each(LOCAL_HETEROGENEOUS_AGENT_TYPES)(
      'accepts %s event batches from a local CLI',
      async (agentType) => {
        const events = [buildEvent('stream_start', 0)];

        await createCaller().heteroIngest({
          agentType,
          events,
          operationId: `op-${agentType}`,
          topicId: 'topic-1',
        });

        expect(mockHeteroIngest).toHaveBeenCalledWith({
          agentType,
          events,
          operationId: `op-${agentType}`,
          topicId: 'topic-1',
        });
      },
    );

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

    it("accepts a device user ingesting and finishing another member's workspace topic", async () => {
      const creatorId = await createTestUser(serverDB);
      const [workspace] = await serverDB
        .insert(workspaces)
        .values({
          name: 'Hetero ingest workspace',
          primaryOwnerId: creatorId,
          slug: `hetero-ingest-${creatorId.slice(0, 8)}`,
        })
        .returning();

      try {
        await serverDB.insert(workspaceMembers).values([
          { role: 'owner', userId: creatorId, workspaceId: workspace.id },
          { role: 'member', userId, workspaceId: workspace.id },
        ]);
        await serverDB.insert(topics).values({
          id: 'workspace-topic',
          title: 'Created by another member',
          userId: creatorId,
          workspaceId: workspace.id,
        });

        const caller = createCaller({ authKind: 'user' });
        const ingestResult = await caller.heteroIngest({
          agentType: 'claude-code',
          events: [buildEvent('stream_chunk', 0)],
          operationId: 'op-workspace',
          topicId: 'workspace-topic',
        });
        const finishResult = await caller.heteroFinish({
          agentType: 'claude-code',
          operationId: 'op-workspace',
          result: 'success',
          topicId: 'workspace-topic',
        });

        expect(ingestResult).toEqual({ ack: true });
        expect(finishResult).toEqual({ ack: true });
        expect(mockHeteroIngest).toHaveBeenCalledWith(
          expect.objectContaining({ topicId: 'workspace-topic' }),
        );
        expect(mockHeteroFinish).toHaveBeenCalledWith(
          expect.objectContaining({ topicId: 'workspace-topic' }),
        );
      } finally {
        await serverDB.delete(workspaces).where(eq(workspaces.id, workspace.id));
        await cleanupTestUser(serverDB, creatorId);
      }
    });

    it('rejects a user who is not a member of the topic workspace', async () => {
      const creatorId = await createTestUser(serverDB);
      const [workspace] = await serverDB
        .insert(workspaces)
        .values({
          name: 'Foreign hetero workspace',
          primaryOwnerId: creatorId,
          slug: `foreign-hetero-${creatorId.slice(0, 8)}`,
        })
        .returning();

      try {
        await serverDB.insert(workspaceMembers).values({
          role: 'owner',
          userId: creatorId,
          workspaceId: workspace.id,
        });
        await serverDB.insert(topics).values({
          id: 'foreign-workspace-topic',
          title: 'Foreign workspace topic',
          userId: creatorId,
          workspaceId: workspace.id,
        });

        await expect(
          createCaller().heteroIngest({
            agentType: 'claude-code',
            events: [buildEvent('stream_chunk', 0)],
            operationId: 'op-foreign',
            topicId: 'foreign-workspace-topic',
          }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      } finally {
        await serverDB.delete(workspaces).where(eq(workspaces.id, workspace.id));
        await cleanupTestUser(serverDB, creatorId);
      }
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

    it.each(LOCAL_HETEROGENEOUS_AGENT_TYPES)(
      'accepts a %s session id for subsequent local CLI resume',
      async (agentType) => {
        await createCaller().heteroFinish({
          agentType,
          operationId: `op-${agentType}`,
          result: 'success',
          sessionId: `${agentType}-session-1`,
          topicId: 'topic-1',
        });

        expect(mockHeteroFinish).toHaveBeenCalledWith(
          expect.objectContaining({
            agentType,
            sessionId: `${agentType}-session-1`,
          }),
        );
      },
    );

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
