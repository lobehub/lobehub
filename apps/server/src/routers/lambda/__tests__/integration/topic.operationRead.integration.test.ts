// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { messages, topics, users, workspaces } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import {
  __resetOperationStatesForTesting,
  HeterogeneousPersistenceHandler,
} from '@/server/services/heterogeneousAgent/HeterogeneousPersistenceHandler';
import { HeteroOperationPrincipalError } from '@/server/services/heterogeneousAgent/operationPrincipal';

import { topicRouter } from '../../topic';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

// Re-authorization against the operation row, membership and RBAC has its own
// suite; here it stands in for "the token's run is live", so everything after it
// — the conversation boundary and the topic read — runs for real.
const mockResolve = vi.fn();
vi.mock('@/server/services/heterogeneousAgent/operationPrincipal', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveActiveHeteroOperationPrincipal: (...args: unknown[]) => mockResolve(...args),
}));

const runUser = 'op-read-run-user';
const workspace = 'op-read-workspace';
const conversation = 'tpc_opReadConvo1';

/** A real `hetero-operation` claim set, classified by the real middleware. */
const operationClaims = {
  aud: 'urn:lobehub:hetero-operation',
  capabilities: ['hetero:ingest', 'hetero:finish', 'hetero:intervention:read'],
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
  iss: 'urn:lobehub:internal',
  jti: 'jti-op-read',
  operation_id: 'op_read_1',
  purpose: 'hetero-operation',
  sub: runUser,
  workspace_id: workspace,
};

const callerWith = (oidcAuth: Record<string, unknown>, workspaceId?: string) =>
  topicRouter.createCaller({
    jwtPayload: { userId: runUser },
    oidcAuth,
    userId: runUser,
    workspaceId,
  } as never);

describe('topic.getTopicTranscriptOperation', () => {
  beforeEach(async () => {
    testDB = await getTestDB();
    vi.clearAllMocks();
    __resetOperationStatesForTesting();
    mockResolve.mockResolvedValue({
      operationId: 'op_read_1',
      topicId: conversation,
      userId: runUser,
      workspaceId: workspace,
    });

    await testDB.insert(users).values({ id: runUser });
    await testDB.insert(workspaces).values({
      id: workspace,
      name: workspace,
      primaryOwnerId: runUser,
      slug: workspace,
    });
    await testDB.insert(topics).values([
      { id: conversation, title: 'This run', userId: runUser, workspaceId: workspace },
      { id: 'tpc_opReadNamed1', title: 'Referenced', userId: runUser, workspaceId: workspace },
      { id: 'tpc_opReadOther1', title: 'Never named', userId: runUser, workspaceId: workspace },
    ]);
    await testDB.insert(messages).values([
      {
        content: '参考这个对话，tpc_opReadNamed1，clone 3 个项目到当前目录',
        id: 'op-read-ask',
        role: 'user',
        topicId: conversation,
        userId: runUser,
        workspaceId: workspace,
      },
      {
        content: 'clone lobehub, lobehub-market and lobehub-cloud',
        id: 'op-read-named-body',
        role: 'user',
        topicId: 'tpc_opReadNamed1',
        userId: runUser,
        workspaceId: workspace,
      },
    ]);
  });

  afterEach(async () => {
    __resetOperationStatesForTesting();
    await testDB.delete(users).where(inArray(users.id, [runUser]));
    await testDB.delete(workspaces).where(inArray(workspaces.id, [workspace]));
  });

  it('refuses an ordinary user session — this is not a wider read', async () => {
    await expect(
      callerWith({ sub: runUser }).getTopicTranscriptOperation({ topicId: 'tpc_opReadNamed1' }),
    ).rejects.toThrow('An operation-bound token is required');
  });

  it("reads a conversation the user named, as the run's own principal", async () => {
    const result = await callerWith(operationClaims).getTopicTranscriptOperation({
      topicId: 'tpc_opReadNamed1',
    });

    expect(mockResolve).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'hetero:ingest', operationId: 'op_read_1' }),
    );
    expect(result.topic).toMatchObject({ id: 'tpc_opReadNamed1', title: 'Referenced' });
    expect(result.items).toEqual([
      expect.objectContaining({ content: 'clone lobehub, lobehub-market and lobehub-cloud' }),
    ]);
  });

  it('reads the run’s own conversation', async () => {
    const result = await callerWith(operationClaims).getTopicTranscriptOperation({
      includeMessages: false,
      topicId: conversation,
    });

    expect(result.topic).toMatchObject({ id: conversation });
  });

  it("takes the scope from the operation, not from the request's workspace header", async () => {
    const result = await callerWith(
      operationClaims,
      'some-other-workspace',
    ).getTopicTranscriptOperation({ topicId: 'tpc_opReadNamed1' });

    expect(result.topic).toMatchObject({ id: 'tpc_opReadNamed1' });
  });

  /**
   * The user could read this topic with their own session; the run's token may
   * not, because nothing in the run's conversation points at it.
   */
  it('refuses a topic the conversation never names, before looking it up', async () => {
    await expect(
      callerWith(operationClaims).getTopicTranscriptOperation({ topicId: 'tpc_opReadOther1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      callerWith(operationClaims).getTopicTranscriptOperation({ topicId: 'tpc_doesNotExist' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('does not grant topic access from an ingested subagent prompt', async () => {
    const topicId = 'tpc_opReadOther1';
    const caller = callerWith(operationClaims);
    await expect(caller.getTopicTranscriptOperation({ topicId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const topicModel = new TopicModel(testDB, runUser, workspace);
    await testDB.insert(messages).values({
      content: '',
      id: 'op-read-assistant',
      parentId: 'op-read-ask',
      role: 'assistant',
      topicId: conversation,
      userId: runUser,
      workspaceId: workspace,
    });
    await topicModel.updateMetadata(conversation, {
      runningOperation: {
        assistantMessageId: 'op-read-assistant',
        operationId: operationClaims.operation_id,
        startedAt: new Date().toISOString(),
        type: 'execAgent',
      },
    });
    const handler = new HeterogeneousPersistenceHandler({
      messageModel: new MessageModel(testDB, runUser, workspace),
      threadModel: new ThreadModel(testDB, runUser, workspace),
      topicModel,
      userId: runUser,
      workspaceId: workspace,
    });
    await handler.ingest({
      events: [
        {
          data: {
            chunkType: 'text',
            content: 'Starting the delegated task',
            subagent: {
              parentToolCallId: 'op-read-subagent-call',
              spawnMetadata: { prompt: `Read ${topicId}`, subagentType: 'Explore' },
              subagentMessageId: 'op-read-subagent-message',
            },
          },
          operationId: operationClaims.operation_id,
          stepIndex: 0,
          timestamp: Date.now(),
          type: 'stream_chunk',
        },
      ],
      operationId: operationClaims.operation_id,
      topicId: conversation,
    });

    // Prove the real ingest persistence path wrote the synthetic user message.
    expect(
      await testDB
        .select({ content: messages.content })
        .from(messages)
        .where(
          and(
            eq(messages.topicId, conversation),
            eq(messages.role, 'user'),
            isNotNull(messages.threadId),
          ),
        ),
    ).toEqual([{ content: `Read ${topicId}` }]);
    await expect(caller.getTopicTranscriptOperation({ topicId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    // A real user reference in the main conversation can still grant access.
    await testDB.insert(messages).values({
      content: `Please read ${topicId}`,
      id: 'op-read-user-authorizes',
      role: 'user',
      topicId: conversation,
      userId: runUser,
      workspaceId: workspace,
    });
    await expect(caller.getTopicTranscriptOperation({ topicId })).resolves.toMatchObject({
      topic: { id: topicId },
    });
  });

  it('refuses an operation that has no conversation', async () => {
    mockResolve.mockResolvedValue({
      operationId: 'op_read_1',
      userId: runUser,
      workspaceId: workspace,
    });

    await expect(
      callerWith(operationClaims).getTopicTranscriptOperation({ topicId: 'tpc_opReadNamed1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [409, 'CONFLICT'],
  ] as const)('maps a %i principal refusal to %s', async (status, code) => {
    mockResolve.mockRejectedValue(new HeteroOperationPrincipalError('refused', status));

    await expect(
      callerWith(operationClaims).getTopicTranscriptOperation({ topicId: 'tpc_opReadNamed1' }),
    ).rejects.toMatchObject({ code, message: 'refused' });
  });
});
