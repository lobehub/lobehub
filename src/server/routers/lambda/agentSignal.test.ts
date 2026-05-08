// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { type AuthContext } from '@/libs/trpc/lambda/context';
import { createContextInner } from '@/libs/trpc/lambda/context';
import { listAgentSignalReceipts } from '@/server/services/agentSignal/services/receiptService';

import { agentSignalRouter } from './agentSignal';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/server/services/agentSignal', () => ({
  enqueueAgentSignalSourceEvent: vi
    .fn()
    .mockResolvedValue({ accepted: true, scopeKey: 'topic:topic-1', workflowRunId: 'wfr_1' }),
}));

vi.mock('@/server/services/agentSignal/services/receiptService', () => ({
  listAgentSignalReceipts: vi.fn().mockResolvedValue({
    cursor: undefined,
    receipts: [
      {
        agentId: 'agent-1',
        anchorMessageId: 'assistant-1',
        createdAt: 1_700_000,
        detail: 'Saved this for future replies',
        id: 'receipt-1',
        kind: 'memory',
        sourceId: 'source-1',
        sourceType: 'client.gateway.runtime_end',
        status: 'applied',
        title: 'Memory saved',
        topicId: 'topic-1',
        userId: 'user-1',
      },
    ],
  }),
}));

const createCaller = createCallerFactory(agentSignalRouter);

describe('agentSignalRouter', () => {
  let ctx: AuthContext;
  let router: ReturnType<typeof createCaller>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ctx = await createContextInner({ userId: 'user-1' });
    router = createCaller(ctx);
  });

  it('accepts client runtime events', async () => {
    await expect(
      router.emitSourceEvent({
        payload: {
          agentId: 'agent-1',
          operationId: 'op-1',
          parentMessageId: 'msg-1',
          parentMessageType: 'user',
          threadId: 'thread-1',
          topicId: 'topic-1',
        },
        sourceId: 'op-1:client:start',
        sourceType: 'client.runtime.start',
      }),
    ).resolves.toEqual({ accepted: true, scopeKey: 'topic:topic-1', workflowRunId: 'wfr_1' });
  });

  it('rejects forged non-client source events', async () => {
    await expect(
      router.emitSourceEvent({
        payload: {
          message: 'remember this',
          messageId: 'msg-1',
          topicId: 'topic-1',
        },
        sourceId: 'msg-1',
        sourceType: 'agent.user.message' as never,
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('lists receipts for the current user topic', async () => {
    await expect(
      router.listReceipts({
        agentId: 'agent-1',
        limit: 20,
        sinceCreatedAt: 1_700_000,
        topicId: 'topic-1',
      }),
    ).resolves.toEqual({
      cursor: undefined,
      receipts: [
        expect.objectContaining({
          agentId: 'agent-1',
          id: 'receipt-1',
          kind: 'memory',
          topicId: 'topic-1',
        }),
      ],
    });

    expect(listAgentSignalReceipts).toHaveBeenCalledWith({
      agentId: 'agent-1',
      cursor: undefined,
      limit: 20,
      sinceCreatedAt: 1_700_000,
      topicId: 'topic-1',
      userId: 'user-1',
    });
  });
});
